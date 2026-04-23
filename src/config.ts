import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CrawlTarget } from './types.js';

export interface RawArgs {
  target: string;
  out?: string;
  storageState?: string;
}

/**
 * Validates and normalizes raw CLI arguments into a CrawlTarget.
 * Throws a descriptive Error if required args are missing or invalid.
 */
export function loadConfig(args: RawArgs): CrawlTarget {
  const { target, out, storageState } = args;

  if (target && !isValidUrl(target)) {
    throw new Error(`--target must be a valid http/https URL, got: ${target}`);
  }

  const outDir = resolve(out ?? './out');
  mkdirSync(outDir, { recursive: true });

  return {
    url: target,
    out: outDir,
    storageState: storageState ? resolve(storageState) : undefined,
  };
}

function isValidUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
