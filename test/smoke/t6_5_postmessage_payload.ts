import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFixtureServer } from './_server.js';
import { crawl } from '../../src/crawler/crawl.js';
import type { Finding } from '../../src/types.js';

const TASK = 't6.5';
const outDir = mkdtempSync(join(tmpdir(), 'bbcrawl-t6_5-'));
let server: Awaited<ReturnType<typeof startFixtureServer>> | undefined;

try {
  server = await startFixtureServer('vuln-postmessage-payload.html');

  await crawl({ url: server.url, outDir, maxDepth: 0, maxMs: 30_000, rateMs: 0 });

  const jsonlPath = join(outDir, 'findings.jsonl');
  const lines = readFileSync(jsonlPath, 'utf8').trim().split('\n').filter(Boolean);
  const findings = lines.map((l) => JSON.parse(l) as Finding);

  // Must find pm-wildcard-sensitive-payload
  const sensitive = findings.find((f) => f.ruleId === 'pm-wildcard-sensitive-payload');
  assert.ok(sensitive, 'expected pm-wildcard-sensitive-payload finding');

  // listenerSource must contain a payload preview with recognizable content
  assert.ok(
    sensitive!.listenerSource.includes('eyJ') || sensitive!.listenerSource.includes('token'),
    `expected payload preview in listenerSource, got: ${sensitive!.listenerSource}`,
  );

  // Safe send to specific origin must not produce pm-wildcard-sensitive-payload for that call
  const wildcardFindings = findings.filter((f) => f.ruleId === 'pm-wildcard-sensitive-payload');
  assert.equal(wildcardFindings.length, 1, `expected exactly 1 sensitive-payload finding, got ${wildcardFindings.length}`);

  console.log(`SMOKE_OK: ${TASK} (findings=${findings.length}, sensitive=${wildcardFindings.length})`);
  process.exit(0);
} catch (e) {
  console.error(`SMOKE_FAIL: ${TASK}: ${(e as Error).message}`);
  process.exit(1);
} finally {
  await server?.close();
  rmSync(outDir, { recursive: true, force: true });
}
