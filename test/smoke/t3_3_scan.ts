import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFixtureServer } from './_server.js';
import { scan } from '../../src/scan.js';
import type { Finding } from '../../src/types.js';

const TASK = 't3.3';

const outDir = mkdtempSync(join(tmpdir(), 'bbcrawl-t3_3-'));
let server: Awaited<ReturnType<typeof startFixtureServer>> | undefined;

try {
  server = await startFixtureServer('vuln-postmessage-noorigin.html');

  const { findingsCount } = await scan({ url: server.url, outDir });

  if (findingsCount < 1) {
    throw new Error(`expected ≥1 finding, got ${findingsCount}`);
  }

  const jsonlPath = join(outDir, 'findings.jsonl');
  const lines = readFileSync(jsonlPath, 'utf8').trim().split('\n');
  const findings = lines.map((l) => JSON.parse(l) as Finding);

  const noOrigin = findings.find((f) => f.ruleId === 'pm-no-origin-check');
  if (!noOrigin) throw new Error('pm-no-origin-check finding missing from findings.jsonl');
  if (!noOrigin.pageUrl) throw new Error('pageUrl missing from finding');
  // scriptUrl is null for unresolved frames — that's allowed, but attribution must match
  if (!('scriptUrl' in noOrigin)) throw new Error('scriptUrl field missing from finding');
  if (noOrigin.scriptUrl === null && noOrigin.attribution !== 'unresolved') {
    throw new Error('null scriptUrl must have attribution=unresolved');
  }
  if (noOrigin.scriptUrl !== null && noOrigin.attribution !== 'resolved') {
    throw new Error('non-null scriptUrl must have attribution=resolved');
  }

  console.log(`SMOKE_OK: ${TASK} (findings=${findingsCount}, pageUrl=${noOrigin.pageUrl}, scriptUrl=${noOrigin.scriptUrl ?? '(unresolved)'})`);
  process.exit(0);
} catch (e) {
  console.error(`SMOKE_FAIL: ${TASK}: ${(e as Error).message}`);
  process.exit(1);
} finally {
  await server?.close();
  rmSync(outDir, { recursive: true, force: true });
}
