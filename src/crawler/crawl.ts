import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launchBrowser, createPageContext, type CapturedListener } from './browser.js';
import { Frontier } from './frontier.js';
import { interact } from './interact.js';
import { evaluate } from '../rules/engine.js';
import { emitReport, emitListeners } from '../report/emit.js';
import { createManifest, finalizeManifest, writeManifest } from '../report/manifest.js';
import { deduplicateFindings } from '../report/dedup.js';
import { resolveStack, resolveOriginalSource } from '../report/sourcemap.js';
import { log } from '../logger.js';
import { assertAuthenticated, SessionExpiredError, type AuthConfig } from '../auth/detect.js';
import type { Finding, PostMessageEvent } from '../types.js';
import type { RuleInput } from '../rules/types.js';

export interface CrawlOptions {
  /** Seed URL — must be http/https. */
  url: string;
  /** Output directory for findings report. */
  outDir: string;
  /** Path to a Playwright storageState JSON, if auth'd. */
  storageState?: string;
  /** Maximum BFS depth from seed (default 3). */
  maxDepth?: number;
  /** Maximum total crawl time in ms (default 5 minutes). */
  maxMs?: number;
  /** Minimum delay between requests to the same origin in ms (token bucket, default 500). */
  rateMs?: number;
  /**
   * Auth config for mid-crawl session freshness checks (§4.3).
   * If provided, isAuthenticated is checked every `sessionCheckEvery` pages.
   * On failure the crawl halts with SessionExpiredError.
   */
  authConfig?: AuthConfig;
  /** How often (in pages) to run the session freshness check (default 10). */
  sessionCheckEvery?: number;
}

export interface CrawlResult {
  pagesVisited: number;
  findingsCount: number;
}

/** Token bucket per origin — enforces minimum inter-request delay. */
class RateLimiter {
  private readonly lastSent = new Map<string, number>();

  constructor(private readonly minGapMs: number) {}

  async wait(origin: string): Promise<void> {
    const last = this.lastSent.get(origin) ?? 0;
    const elapsed = Date.now() - last;
    if (elapsed < this.minGapMs) {
      await sleep(this.minGapMs - elapsed);
    }
    this.lastSent.set(origin, Date.now());
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function findingId(ruleId: string, scriptUrl: string | null, source: string): string {
  return createHash('sha256')
    .update(ruleId)
    .update('\x00')
    .update(scriptUrl ?? '')
    .update('\x00')
    .update(source)
    .digest('hex')
    .slice(0, 16);
}

/**
 * BFS crawler: visits all same-origin pages discoverable from the seed URL,
 * runs the prelude hook on each, and collects postMessage findings.
 *
 * One Chromium process is launched for the full crawl; each page gets a fresh
 * BrowserContext for isolation (per DESIGN.md §3.1).
 */
export async function crawl(opts: CrawlOptions): Promise<CrawlResult> {
  const {
    url: seedUrl,
    outDir,
    storageState,
    maxDepth = 3,
    maxMs = 5 * 60 * 1000,
    rateMs = 500,
    authConfig,
    sessionCheckEvery = 10,
  } = opts;

  mkdirSync(outDir, { recursive: true });
  const tracesDir = join(outDir, 'traces');
  mkdirSync(tracesDir, { recursive: true });

  const runId = randomBytes(8).toString('hex');
  const manifest = createManifest({ runId, target: seedUrl, outDir, storageState });

  const seedOrigin = new URL(seedUrl).origin;
  const frontier = new Frontier();
  frontier.enqueue(seedUrl, 0);

  const rateLimiter = new RateLimiter(rateMs);
  const allFindings: Finding[] = [];
  const allListeners: CapturedListener[] = [];
  const capturedAt = new Date().toISOString();
  const deadline = Date.now() + maxMs;
  let pagesVisited = 0;

  // Single browser process for the entire crawl.
  const browser = await launchBrowser();

  try {
    while (frontier.size > 0 && Date.now() < deadline) {
      const entry = frontier.dequeue();
      if (!entry) break;

      const { url, depth } = entry;
      if (depth > maxDepth) continue;

      const origin = (() => {
        try { return new URL(url).origin; } catch { return ''; }
      })();
      if (origin !== seedOrigin) continue;

      await rateLimiter.wait(origin);

      log.info({ url, depth }, 'crawling page');

      const listenerEvents: CapturedListener[] = [];
      const postmessageEvents: PostMessageEvent[] = [];

      // Fresh BrowserContext per page — isolated cookies/storage, but shared process.
      const ctx = await createPageContext(browser, { storageState, enableTracing: true });
      ctx.onReport((ev) => {
        if (ev.t === 'listener') listenerEvents.push(ev as CapturedListener);
        else if (ev.t === 'postmessage') postmessageEvents.push(ev as PostMessageEvent);
      });

      // Collect same-origin links discovered via redirect headers or SPA navigation.
      const discoveredUrls: string[] = [];
      ctx.page.on('response', (response) => {
        const loc = response.headers()['location'];
        if (loc) {
          try {
            const absolute = new URL(loc, url).href;
            if (new URL(absolute).origin === seedOrigin) discoveredUrls.push(absolute);
          } catch { /* ignore */ }
        }
      });
      // Capture URLs produced by history.pushState/replaceState (SPA navigation).
      // framenavigated fires for both pushState and full page navigations, so this
      // also picks up URLs reached by clicking <a> links in interact().
      ctx.page.on('framenavigated', (frame) => {
        if (frame !== ctx.page.mainFrame()) return;
        const href = frame.url();
        try {
          if (new URL(href).origin === seedOrigin) discoveredUrls.push(href);
        } catch { /* ignore */ }
      });

      let pageOk = true;
      try {
        await ctx.page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });

        // Mid-crawl session freshness check (§4.3): every sessionCheckEvery pages.
        if (authConfig && pagesVisited > 0 && pagesVisited % sessionCheckEvery === 0) {
          await assertAuthenticated(ctx.page, authConfig);
        }

        // Interact to trigger lazy-loaded code and SPA route transitions.
        // <a> link scraping happens after interact() so routes revealed by
        // SPA navigation during interaction are also captured.
        if (depth < maxDepth) {
          await interact(ctx.page);
        }

        // Collect <a href> links from the rendered DOM (post-interaction so SPA
        // routes that only render after navigation are included).
        const hrefs = await ctx.page.$$eval('a[href]', (els) =>
          (els as HTMLAnchorElement[]).map((a) => a.href),
        );
        for (const href of hrefs) {
          try {
            if (new URL(href).origin === seedOrigin) discoveredUrls.push(href);
          } catch { /* ignore */ }
        }
      } catch (err) {
        if (err instanceof SessionExpiredError) {
          log.error({ url, reason: err.message }, 'session expired — halting crawl');
          await ctx.stopTrace(null);
          await ctx.close();
          throw err;
        }
        log.warn({ url, err: (err as Error).message }, 'page load failed, skipping');
        pageOk = false;
      }

      // Evaluate rules before closing so we can decide whether to keep the trace.
      const pageFindings: Finding[] = [];
      if (pageOk) {
        for (const ev of listenerEvents) {
          const res = resolveStack(ev.stack);
          const orig = res.attribution === 'resolved'
            ? await resolveOriginalSource(res.scriptUrl, res.line, res.col)
            : null;
          const scriptUrlOriginal = orig?.source ?? null;
          const input: RuleInput = {
            eventType: 'listener',
            originCheck: ev.originCheck,
            listenerSource: ev.source,
          };
          for (const m of evaluate(input)) {
            pageFindings.push({
              id: findingId(m.ruleId, ev.scriptUrl, ev.source),
              ruleId: m.ruleId,
              severity: m.severity,
              title: m.title,
              description: m.description,
              remediationHint: m.match.remediationHint,
              scriptUrl: ev.scriptUrl,
              scriptUrlOriginal,
              pageUrl: ev.pageUrl,
              listenerSource: ev.source,
              stack: ev.stack,
              attribution: ev.scriptUrl ? 'resolved' : 'unresolved',
              capturedAt,
            });
          }
        }

        for (const ev of postmessageEvents) {
          const res = resolveStack(ev.stack);
          const orig = res.attribution === 'resolved'
            ? await resolveOriginalSource(res.scriptUrl, res.line, res.col)
            : null;
          const scriptUrlOriginal = orig?.source ?? null;
          const input: RuleInput = {
            eventType: 'postmessage',
            originCheck: 'none',
            listenerSource: '',
            targetOrigin: ev.targetOrigin,
          };
          for (const m of evaluate(input)) {
            pageFindings.push({
              id: findingId(m.ruleId, res.scriptUrl, ev.targetOrigin),
              ruleId: m.ruleId,
              severity: m.severity,
              title: m.title,
              description: m.description,
              remediationHint: m.match.remediationHint,
              scriptUrl: res.scriptUrl,
              scriptUrlOriginal,
              pageUrl: ev.topUrl,
              listenerSource: `postMessage(..., "${ev.targetOrigin}")`,
              stack: ev.stack,
              attribution: res.attribution,
              capturedAt,
            });
          }
        }
      }

      // Save trace only for pages that produced findings.
      const pageHash = createHash('sha256').update(url).digest('hex').slice(0, 16);
      const tracePath = pageFindings.length > 0 ? join(tracesDir, `${pageHash}.zip`) : null;
      await ctx.stopTrace(tracePath);
      await ctx.close();

      allFindings.push(...pageFindings);
      pagesVisited++;
      allListeners.push(...listenerEvents);
      log.info({ url, listeners: listenerEvents.length, postmessages: postmessageEvents.length, findings: pageFindings.length }, 'page done');

      // Enqueue discovered links.
      for (const href of discoveredUrls) {
        frontier.enqueue(href, depth + 1);
      }
    }
  } finally {
    await browser.close();
  }

  log.info({ pagesVisited, findings: allFindings.length, listeners: allListeners.length }, 'crawl complete');

  const { newFindings, seenFindings } = deduplicateFindings(allFindings);
  const newFindingIds = new Set(newFindings.map((f) => f.id));
  log.info({ new: newFindings.length, seen: seenFindings.length }, 'dedup complete');

  emitReport(allFindings, outDir, newFindingIds);
  emitListeners(allListeners, outDir);

  const bySeverity: Record<string, number> = {};
  for (const f of allFindings) {
    bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
  }
  finalizeManifest(manifest, {
    pagesVisited,
    listenersCaptured: allListeners.length,
    findingsTotal: allFindings.length,
    findingsNew: newFindings.length,
    findingsBySeverity: bySeverity,
  });
  writeManifest(manifest, outDir);
  log.info({ outDir, runId }, 'manifest written');

  return { pagesVisited, findingsCount: allFindings.length };
}
