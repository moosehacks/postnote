import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launchBrowser, createPageContext, type CapturedListener } from './browser.js';
import { Frontier } from './frontier.js';
import { interact } from './interact.js';
import { evaluate } from '../rules/engine.js';
import { emitReport, emitListeners, emitSenders } from '../report/emit.js';
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
   * Extra ms to wait after the load event before interacting (default 500).
   * Gives React/Vue/Angular init scripts time to register listeners before we
   * start clicking. Keep low — this compounds across every page.
   */
  settleMs?: number;
  /**
   * Auth config for mid-crawl session freshness checks (§4.3).
   * If provided, isAuthenticated is checked every `sessionCheckEvery` pages.
   * On failure the crawl halts with SessionExpiredError.
   */
  authConfig?: AuthConfig;
  /** How often (in pages) to run the session freshness check (default 10). */
  sessionCheckEvery?: number;
  /**
   * Additional origins to include in crawl scope beyond the seed origin.
   * Useful when the target redirects to a different origin (e.g. example.com →
   * www.example.com) or has content on related origins (e.g. api.example.com).
   * Each entry must be an absolute origin string: "https://www.example.com".
   */
  allowOrigins?: string[];
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

/**
 * Returns true if `pattern` (a wildcard entry from --allow-origins) matches `origin`.
 *
 * Two forms are supported:
 *   "*.foo.com"            — any subdomain of foo.com, any scheme
 *   "https://*.foo.com"    — any subdomain of foo.com, https only
 *
 * The apex itself (foo.com) is NOT matched by *.foo.com — add it explicitly if needed.
 */
function wildcardMatches(origin: string, pattern: string): boolean {
  try {
    const { hostname, protocol, port } = new URL(origin);
    if (pattern.startsWith('*.')) {
      return hostname.endsWith('.' + pattern.slice(2));
    }
    // scheme-qualified: "https://*.foo.com" — parse by substituting * temporarily
    const p = new URL(pattern.replace('*.', '_w_.'));
    if (protocol !== p.protocol || port !== p.port) return false;
    return hostname.endsWith('.' + p.hostname.slice('_w_.'.length));
  } catch { return false; }
}

/** Returns true if `origin` is covered by the exact allow-set or any wildcard pattern. */
function isInScope(origin: string, exact: Set<string>, wildcards: string[]): boolean {
  if (exact.has(origin)) return true;
  return wildcards.some((pat) => wildcardMatches(origin, pat));
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
    settleMs = 500,
    authConfig,
    sessionCheckEvery = 10,
    allowOrigins = [],
  } = opts;

  mkdirSync(outDir, { recursive: true });
  const tracesDir = join(outDir, 'traces');
  mkdirSync(tracesDir, { recursive: true });

  const runId = randomBytes(8).toString('hex');
  const manifest = createManifest({ runId, target: seedUrl, outDir, storageState });

  // Split explicit overrides into exact origins and wildcard patterns.
  const wildcardPatterns: string[] = [];
  const explicitOrigins: string[] = [];
  for (const entry of allowOrigins) {
    (entry.includes('*') ? wildcardPatterns : explicitOrigins).push(entry);
  }

  // Mutable scope set: starts with the seed origin + any explicit overrides.
  // May be expanded after the seed page loads if it redirects (e.g. apex → www).
  const allowedOrigins = new Set<string>([
    new URL(seedUrl).origin,
    ...explicitOrigins,
  ]);
  const frontier = new Frontier();
  frontier.enqueue(seedUrl, 0);

  const rateLimiter = new RateLimiter(rateMs);
  const allFindings: Finding[] = [];
  const allListeners: CapturedListener[] = [];
  const allSenders: PostMessageEvent[] = [];
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
      if (!isInScope(origin, allowedOrigins, wildcardPatterns)) continue;

      await rateLimiter.wait(origin);

      log.info({ url, depth }, 'crawling page');

      const listenerEvents: CapturedListener[] = [];
      const postmessageEvents: PostMessageEvent[] = [];

      // Fresh BrowserContext per page — isolated cookies/storage, but shared process.
      const ctx = await createPageContext(browser, { storageState, enableTracing: true });
      // tracePath is set once findings are known; the finally always calls stopTrace with it.
      let tracePath: string | null = null;
      try {
        ctx.onReport((ev) => {
          if (ev.t === 'listener') listenerEvents.push(ev as CapturedListener);
          else if (ev.t === 'postmessage') postmessageEvents.push(ev as PostMessageEvent);
        });

        // Collect in-scope links discovered via redirect headers.
        const discoveredUrls: string[] = [];
        // Buffer without scope-checking because allowedOrigins isn't fully populated
        // until after goto() resolves (www-variant detection runs then).
        const redirectBuffer: string[] = [];
        ctx.page.on('response', (response) => {
          const loc = response.headers()['location'];
          if (loc) {
            try { redirectBuffer.push(new URL(loc, url).href); } catch { /* ignore */ }
          }
        });

        try {
          // Use 'load' instead of 'networkidle': sites with analytics, CF challenges,
          // or long-polling never reach networkidle and would always time out.
          await ctx.page.goto(url, { waitUntil: 'load', timeout: 30_000 });

          // On the seed page, detect apex ↔ www redirects and expand scope automatically.
          // This covers the common pattern where example.com redirects to www.example.com
          // (or vice versa): without this, every discovered link would fail the origin filter.
          if (depth === 0 && pagesVisited === 0) {
            const finalOrigin = (() => { try { return new URL(ctx.page.url()).origin; } catch { return ''; } })();
            if (finalOrigin && !isInScope(finalOrigin, allowedOrigins, wildcardPatterns)) {
              const seedHost = new URL(seedUrl).hostname;
              const finalHost = new URL(ctx.page.url()).hostname;
              const isWwwVariant = `www.${seedHost}` === finalHost || seedHost === `www.${finalHost}`;
              if (isWwwVariant) {
                log.info({ from: new URL(seedUrl).origin, to: finalOrigin }, 'seed redirected to www-variant — expanding scope');
                allowedOrigins.add(finalOrigin);
              } else {
                log.warn(
                  { from: new URL(seedUrl).origin, to: finalOrigin },
                  'seed redirected to unrelated origin — scope NOT expanded; use --allow-origins to include it',
                );
              }
            }
          }

          // Flush redirect buffer now that allowedOrigins is fully populated.
          for (const href of redirectBuffer) {
            try {
              if (isInScope(new URL(href).origin, allowedOrigins, wildcardPatterns)) discoveredUrls.push(href);
            } catch { /* ignore */ }
          }

          // Brief settle so SPA init scripts (React, Vue, etc.) can register listeners
          // before we start interacting.
          await ctx.page.waitForTimeout(settleMs);

          // Mid-crawl session freshness check (§4.3): every sessionCheckEvery pages.
          if (authConfig && pagesVisited > 0 && pagesVisited % sessionCheckEvery === 0) {
            await assertAuthenticated(ctx.page, authConfig);
          }

          // Wire framenavigated AFTER goto() so the initial navigation (including any
          // CF-challenge redirects) doesn't pollute the frontier. Only SPA pushState
          // calls and full-page navigations triggered by interact() are captured.
          ctx.page.on('framenavigated', (frame) => {
            if (frame !== ctx.page.mainFrame()) return;
            const href = frame.url();
            try {
              if (isInScope(new URL(href).origin, allowedOrigins, wildcardPatterns)) discoveredUrls.push(href);
            } catch { /* ignore */ }
          });

          // Scrape links before interact() so they're preserved if interact() navigates away.
          const preInteractHrefs = await ctx.page.$$eval('a[href]', (els) =>
            (els as HTMLAnchorElement[]).map((a) => a.href),
          );

          if (depth < maxDepth) {
            await interact(ctx.page);
          }

          // Check if interact() left us on an in-scope page.
          const postInteractOrigin = (() => {
            try { return new URL(ctx.page.url()).origin; } catch { return ''; }
          })();

          if (isInScope(postInteractOrigin, allowedOrigins, wildcardPatterns)) {
            // Still in scope: union both snapshots to capture links from SPA routes
            // visited during interact().
            const postInteractHrefs = await ctx.page.$$eval('a[href]', (els) =>
              (els as HTMLAnchorElement[]).map((a) => a.href),
            );
            for (const href of [...preInteractHrefs, ...postInteractHrefs]) {
              try {
                if (isInScope(new URL(href).origin, allowedOrigins, wildcardPatterns)) discoveredUrls.push(href);
              } catch { /* ignore */ }
            }
          } else {
            log.warn({ url, navigatedTo: ctx.page.url() }, 'interact() navigated out of scope — using pre-interact link snapshot');
            for (const href of preInteractHrefs) {
              try {
                if (isInScope(new URL(href).origin, allowedOrigins, wildcardPatterns)) discoveredUrls.push(href);
              } catch { /* ignore */ }
            }
          }
        } catch (err) {
          if (err instanceof SessionExpiredError) {
            // Re-throw; the outer finally closes ctx before it propagates.
            log.error({ url, reason: err.message }, 'session expired — halting crawl');
            throw err;
          }
          // Log but don't bail — the hook fires at load time so listeners captured
          // before the timeout are still valid and worth evaluating.
          log.warn({ url, err: (err as Error).message }, 'page load error (partial results kept)');
        }

        // Always evaluate captured listeners. A load timeout does not mean the hook
        // didn't fire — it just means the page never fully settled.
        const pageFindings: Finding[] = [];
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
          const preview = ev.message.length > 80 ? ev.message.slice(0, 80) + '…' : ev.message;
          const input: RuleInput = {
            eventType: 'postmessage',
            originCheck: 'none',
            listenerSource: '',
            targetOrigin: ev.targetOrigin,
            messagePayload: ev.message,
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
              listenerSource: `postMessage(${preview}, "${ev.targetOrigin}")`,
              stack: ev.stack,
              attribution: res.attribution,
              capturedAt,
            });
          }
        }

        // Persist trace only for pages that produced findings.
        const pageHash = createHash('sha256').update(url).digest('hex').slice(0, 16);
        tracePath = pageFindings.length > 0 ? join(tracesDir, `${pageHash}.zip`) : null;

        allFindings.push(...pageFindings);
        pagesVisited++;
        allListeners.push(...listenerEvents);
        allSenders.push(...postmessageEvents);
        log.info({ url, finalUrl: ctx.page.url(), listeners: listenerEvents.length, postmessages: postmessageEvents.length, findings: pageFindings.length, linksDiscovered: discoveredUrls.length }, 'page done');

        for (const href of discoveredUrls) {
          frontier.enqueue(href, depth + 1);
        }
      } finally {
        // Always close ctx — guards against leaks if rule evaluation or sourcemap
        // resolution throws. tracePath is null when set before any exception.
        await ctx.stopTrace(tracePath);
        await ctx.close();
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
  emitSenders(allSenders, outDir);

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
