import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Finding, Severity } from '../types.js';
import type { CapturedListener } from '../crawler/browser.js';

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

/**
 * Sorts findings deterministically: by severity (critical first), then by
 * ruleId, then by scriptUrl, then by pageUrl.
 * Stable ordering guarantees identical files for identical inputs (rule 7).
 */
function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const sev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sev !== 0) return sev;
    const rid = a.ruleId.localeCompare(b.ruleId);
    if (rid !== 0) return rid;
    const su = (a.scriptUrl ?? '').localeCompare(b.scriptUrl ?? '');
    if (su !== 0) return su;
    return a.pageUrl.localeCompare(b.pageUrl);
  });
}

function markdownSection(f: Finding, index: number, isNew: boolean): string {
  const scriptUrl = f.scriptUrl ?? '(unresolved)';
  const source = f.listenerSource.slice(0, 2000);
  const badge = isNew ? '🆕 NEW' : '♻️ SEEN';
  return [
    `## Finding ${index + 1}: ${f.title} [${badge}]`,
    '',
    `**Rule:** \`${f.ruleId}\`  `,
    `**Severity:** ${f.severity}  `,
    `**Attribution:** ${f.attribution}  `,
    `**Status:** ${isNew ? 'New (first seen this run)' : 'Previously seen'}`,
    '',
    `**Page URL:** ${f.pageUrl}  `,
    `**Script URL:** ${scriptUrl}`,
    '',
    `### Description`,
    '',
    f.description,
    '',
    `### Remediation`,
    '',
    f.remediationHint,
    '',
    `### Captured source`,
    '',
    '```js',
    source,
    '```',
    '',
    `### Stack trace`,
    '',
    '```',
    f.stack,
    '```',
    '',
  ].join('\n');
}

/**
 * Writes all captured listeners to `<outDir>/listeners.ndjson` unconditionally —
 * regardless of whether any rule fired. This lets analysts review listeners that
 * the rule engine classified as safe (ref-only, strict-eq) but that may still be
 * bypassable through logic the hook cannot evaluate statically.
 *
 * Sorted by scriptUrl then pageUrl for deterministic output (rule 7).
 */
export function emitListeners(listeners: CapturedListener[], outDir: string): void {
  const sorted = [...listeners].sort((a, b) => {
    const su = (a.scriptUrl ?? '').localeCompare(b.scriptUrl ?? '');
    if (su !== 0) return su;
    return a.pageUrl.localeCompare(b.pageUrl);
  });

  const path = join(outDir, 'listeners.ndjson');
  const content = sorted.map((l) => JSON.stringify(l)).join('\n') + (sorted.length ? '\n' : '');
  writeFileSync(path, content, 'utf8');
}

/**
 * Writes findings to `<outDir>/findings.jsonl` (one JSON object per line,
 * sorted) and `<outDir>/report.md` (human-readable markdown).
 *
 * `newFindingIds` is the set of finding IDs that are new this run (vs previously seen).
 * All findings are written to JSONL; the markdown distinguishes new vs seen.
 *
 * Overwrites any existing files in outDir.
 * Throws if the write fails — callers handle the error.
 */
export function emitReport(findings: Finding[], outDir: string, newFindingIds?: Set<string>): void {
  const sorted = sortFindings(findings);
  const isNew = (f: Finding): boolean => newFindingIds === undefined || newFindingIds.has(f.id);

  const jsonlPath = join(outDir, 'findings.jsonl');
  const jsonlContent = sorted
    .map((f) => JSON.stringify({ ...f, isNew: isNew(f) }))
    .join('\n') + (sorted.length ? '\n' : '');
  writeFileSync(jsonlPath, jsonlContent, 'utf8');

  const newCount = newFindingIds !== undefined ? sorted.filter((f) => isNew(f)).length : sorted.length;
  const mdPath = join(outDir, 'report.md');
  const header = [
    '# Vulnerability Report',
    '',
    `Generated: ${sorted[0]?.capturedAt ?? ''}  `,
    `Findings: ${sorted.length} total, ${newCount} new`,
    '',
  ].join('\n');
  const body = sorted.map((f, i) => markdownSection(f, i, isNew(f))).join('\n---\n\n');
  writeFileSync(mdPath, header + body, 'utf8');
}
