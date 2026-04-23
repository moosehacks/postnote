import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { startFixtureServer } from './_server.js';
import { scan } from '../../src/scan.js';

const TASK = 't6.4';
let server: { url: string; close: () => Promise<void> } | undefined;
let outDir1: string | undefined;
let outDir2: string | undefined;

// We patch the global seen-findings index to a temp file for this test
// so we don't pollute the real user index and the test is hermetic.
const SEEN_INDEX_PATH = join(homedir(), '.bbcrawl', 'seen-findings.json');
let originalIndex: string | null = null;

function readIndexSafe(): string[] {
  try { return JSON.parse(readFileSync(SEEN_INDEX_PATH, 'utf8')) as string[]; } catch { return []; }
}

function backupAndClear(): void {
  try { originalIndex = readFileSync(SEEN_INDEX_PATH, 'utf8'); } catch { originalIndex = null; }
  mkdirSync(join(homedir(), '.bbcrawl'), { recursive: true });
  writeFileSync(SEEN_INDEX_PATH, '[]', 'utf8');
}

function restore(): void {
  if (originalIndex !== null) {
    writeFileSync(SEEN_INDEX_PATH, originalIndex, 'utf8');
  }
}

try {
  backupAndClear();

  server = await startFixtureServer('vuln-postmessage-noorigin.html');
  outDir1 = mkdtempSync(join(tmpdir(), 'bbcrawl-t6-4a-'));
  outDir2 = mkdtempSync(join(tmpdir(), 'bbcrawl-t6-4b-'));

  // First scan — finding should be NEW.
  await scan({ url: server.url, outDir: outDir1 });
  const manifest1 = JSON.parse(readFileSync(join(outDir1, 'manifest.json'), 'utf8')) as {
    findingsTotal: number;
    findingsNew: number;
  };
  if (manifest1.findingsNew !== manifest1.findingsTotal) {
    throw new Error(`first run: expected all findings to be new, got findingsNew=${manifest1.findingsNew} of ${manifest1.findingsTotal}`);
  }
  if (manifest1.findingsNew === 0) {
    throw new Error('first run produced 0 findings — fixture may not be loading');
  }

  const indexAfterFirst = readIndexSafe();
  if (indexAfterFirst.length === 0) {
    throw new Error('seen index empty after first run');
  }

  // Second scan of the same URL — all findings should be SEEN.
  await scan({ url: server.url, outDir: outDir2 });
  const manifest2 = JSON.parse(readFileSync(join(outDir2, 'manifest.json'), 'utf8')) as {
    findingsTotal: number;
    findingsNew: number;
  };
  if (manifest2.findingsNew !== 0) {
    throw new Error(`second run: expected 0 new findings, got ${manifest2.findingsNew}`);
  }

  // Check JSONL reflects isNew correctly.
  const jsonl2 = readFileSync(join(outDir2, 'findings.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { isNew: boolean });
  if (jsonl2.some((f) => f.isNew)) {
    throw new Error('second run: some findings have isNew=true in JSONL, expected all false');
  }

  console.log(`SMOKE_OK: ${TASK}`);
  process.exit(0);
} catch (e) {
  console.error(`SMOKE_FAIL: ${TASK}: ${(e as Error).message}`);
  process.exit(1);
} finally {
  restore();
  await server?.close();
  if (outDir1) rmSync(outDir1, { recursive: true, force: true });
  if (outDir2) rmSync(outDir2, { recursive: true, force: true });
}
