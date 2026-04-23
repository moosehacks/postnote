import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launchContext, type CapturedListener, type CapturedSinkHit } from './crawler/browser.js';
import { evaluate } from './rules/engine.js';
import { emitReport, emitListeners } from './report/emit.js';
import { createManifest, finalizeManifest, writeManifest } from './report/manifest.js';
import { deduplicateFindings } from './report/dedup.js';
import { resolveStack, resolveOriginalSource } from './report/sourcemap.js';
import { log } from './logger.js';
import type { Finding, PostMessageEvent } from './types.js';
import type { RuleInput } from './rules/types.js';

/**
 * Stable finding ID derived from rule + location + source.
 * Same finding on the same target always produces the same ID (rule 7).
 */
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
 * Runs a single-page scan against the target URL.
 * Launches a browser, injects the prelude hook, waits for network idle,
 * evaluates all captured hook events through the rule engine, and emits
 * a findings report to outDir.
 */
export async function scan({
  url,
  outDir,
  storageState,
}: {
  url: string;
  outDir: string;
  storageState?: string;
}): Promise<{ findingsCount: number }> {
  mkdirSync(outDir, { recursive: true });
  const tracesDir = join(outDir, 'traces');
  mkdirSync(tracesDir, { recursive: true });

  const runId = randomBytes(8).toString('hex');
  const manifest = createManifest({ runId, target: url, outDir, storageState });

  const ctx = await launchContext({ storageState, enableTracing: true });
  const capturedAt = new Date().toISOString();

  const listenerEvents: CapturedListener[] = [];
  const postmessageEvents: PostMessageEvent[] = [];
  const sinkHitEvents: CapturedSinkHit[] = [];

  ctx.onReport((ev) => {
    if (ev.t === 'listener') {
      listenerEvents.push(ev as CapturedListener);
    } else if (ev.t === 'postmessage') {
      postmessageEvents.push(ev as PostMessageEvent);
    } else if (ev.t === 'sink') {
      sinkHitEvents.push(ev as CapturedSinkHit);
    }
  });

  try {
    log.info({ url }, 'navigating to target');
    await ctx.page.goto(url, { waitUntil: 'networkidle' });
    log.info({ listeners: listenerEvents.length, postmessages: postmessageEvents.length }, 'page settled');
  } catch (err) {
    await ctx.stopTrace(null);
    await ctx.close();
    throw err;
  }

  const findings: Finding[] = [];

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
      findings.push({
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
      findings.push({
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

  for (const ev of sinkHitEvents) {
    const res = resolveStack(ev.stack);
    const orig = res.attribution === 'resolved'
      ? await resolveOriginalSource(res.scriptUrl, res.line, res.col)
      : null;
    const scriptUrlOriginal = orig?.source ?? null;
    const input: RuleInput = {
      eventType: 'sink',
      originCheck: 'none',
      listenerSource: '',
      sinkName: ev.sink,
      sinkSources: ev.sources,
      sinkValue: ev.value,
    };
    for (const m of evaluate(input)) {
      findings.push({
        id: findingId(m.ruleId, ev.scriptUrl, ev.value),
        ruleId: m.ruleId,
        severity: m.severity,
        title: m.title,
        description: m.description,
        remediationHint: m.match.remediationHint,
        scriptUrl: ev.scriptUrl,
        scriptUrlOriginal,
        pageUrl: ev.pageUrl,
        listenerSource: `${ev.sink} ← ${ev.sources.join(', ')} (value: ${ev.value.slice(0, 100)})`,
        stack: ev.stack,
        attribution: ev.scriptUrl ? 'resolved' : 'unresolved',
        capturedAt,
      });
    }
  }

  // Save the Playwright trace only when this page produced findings.
  const pageHash = createHash('sha256').update(url).digest('hex').slice(0, 16);
  const tracePath = findings.length > 0 ? join(tracesDir, `${pageHash}.zip`) : null;
  await ctx.stopTrace(tracePath);
  await ctx.close();

  log.info({ count: findings.length }, 'findings evaluated');

  const { newFindings, seenFindings } = deduplicateFindings(findings);
  const newFindingIds = new Set(newFindings.map((f) => f.id));
  log.info({ new: newFindings.length, seen: seenFindings.length }, 'dedup complete');

  emitReport(findings, outDir, newFindingIds);
  emitListeners(listenerEvents, outDir);

  const bySeverity: Record<string, number> = {};
  for (const f of findings) {
    bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
  }
  finalizeManifest(manifest, {
    pagesVisited: 1,
    listenersCaptured: listenerEvents.length,
    findingsTotal: findings.length,
    findingsNew: newFindings.length,
    findingsBySeverity: bySeverity,
  });
  writeManifest(manifest, outDir);
  log.info({ outDir, runId }, 'report written');

  return { findingsCount: findings.length };
}
