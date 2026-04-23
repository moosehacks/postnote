import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { Finding } from '../types.js';

/** Path to the global seen-findings index, shared across all runs. */
const SEEN_INDEX_PATH = join(homedir(), '.bbcrawl', 'seen-findings.json');

/**
 * Computes a stable dedup hash for a finding.
 * Uses (rule_id, scriptUrlOriginal ?? scriptUrl, sha256(listenerSource)) so
 * the same vulnerability in the same original source file is always the same
 * hash — even if the minified bundle URL changes between deployments.
 */
export function dedupHash(finding: Finding): string {
  const sourceHash = createHash('sha256').update(finding.listenerSource).digest('hex');
  return createHash('sha256')
    .update(finding.ruleId)
    .update('\x00')
    .update(finding.scriptUrlOriginal ?? finding.scriptUrl ?? '')
    .update('\x00')
    .update(sourceHash)
    .digest('hex')
    .slice(0, 32);
}

/** Loads the persisted seen-findings index from disk. Returns an empty set if not yet created. */
function loadSeenIndex(): Set<string> {
  if (!existsSync(SEEN_INDEX_PATH)) return new Set();
  try {
    const raw = readFileSync(SEEN_INDEX_PATH, 'utf8');
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === 'string'));
  } catch {
    return new Set();
  }
}

/** Persists the seen-findings index to disk (creates parent dirs as needed). */
function saveSeenIndex(index: Set<string>): void {
  mkdirSync(dirname(SEEN_INDEX_PATH), { recursive: true });
  writeFileSync(SEEN_INDEX_PATH, JSON.stringify([...index].sort()), 'utf8');
}

export interface DeduplicatedFindings {
  /** Findings not seen in any previous run — true positives to triage. */
  newFindings: Finding[];
  /** Findings whose dedup hash already existed in the seen index. */
  seenFindings: Finding[];
}

/**
 * Splits `findings` into new vs previously-seen, then persists the updated
 * index so future runs can detect already-seen findings.
 *
 * Modifies nothing on `findings` — callers receive separate arrays.
 * Safe to call with zero findings (no-op write).
 */
export function deduplicateFindings(findings: Finding[]): DeduplicatedFindings {
  const seenIndex = loadSeenIndex();
  const newFindings: Finding[] = [];
  const seenFindings: Finding[] = [];

  for (const f of findings) {
    const h = dedupHash(f);
    if (seenIndex.has(h)) {
      seenFindings.push(f);
    } else {
      newFindings.push(f);
      seenIndex.add(h);
    }
  }

  // Persist the updated index even if no new findings — clears nothing.
  if (newFindings.length > 0) {
    saveSeenIndex(seenIndex);
  }

  return { newFindings, seenFindings };
}
