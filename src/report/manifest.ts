import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string; name: string };

export interface RunManifest {
  runId: string;
  tool: string;
  version: string;
  target: string;
  outDir: string;
  storageState: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  pagesVisited: number;
  listenersCaptured: number;
  findingsTotal: number;
  findingsNew: number;
  findingsBySeverity: Record<string, number>;
}

/**
 * Creates an in-progress manifest at the start of a run.
 * Call `finalizeManifest` when the run completes.
 */
export function createManifest({
  runId,
  target,
  outDir,
  storageState,
}: {
  runId: string;
  target: string;
  outDir: string;
  storageState?: string;
}): RunManifest {
  return {
    runId,
    tool: pkg.name,
    version: pkg.version,
    target,
    outDir,
    storageState: storageState ?? null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    durationMs: null,
    pagesVisited: 0,
    listenersCaptured: 0,
    findingsTotal: 0,
    findingsNew: 0,
    findingsBySeverity: {},
  };
}

/**
 * Fills in timing and count fields on a manifest returned by `createManifest`.
 * Returns the mutated manifest (same reference).
 */
export function finalizeManifest(
  manifest: RunManifest,
  counts: {
    pagesVisited: number;
    listenersCaptured: number;
    findingsTotal: number;
    findingsNew: number;
    findingsBySeverity: Record<string, number>;
  },
): RunManifest {
  const now = new Date();
  manifest.finishedAt = now.toISOString();
  manifest.durationMs = now.getTime() - new Date(manifest.startedAt).getTime();
  manifest.pagesVisited = counts.pagesVisited;
  manifest.listenersCaptured = counts.listenersCaptured;
  manifest.findingsTotal = counts.findingsTotal;
  manifest.findingsNew = counts.findingsNew;
  manifest.findingsBySeverity = counts.findingsBySeverity;
  return manifest;
}

/** Writes the manifest to `<outDir>/manifest.json`. */
export function writeManifest(manifest: RunManifest, outDir: string): void {
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
}
