import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFixtureServer } from './_server.js';
import { crawl } from '../../src/crawler/crawl.js';
import type { Finding } from '../../src/types.js';

const TASK = 't4.3';
const outDir = mkdtempSync(join(tmpdir(), 'bbcrawl-t4_3-'));
let server: Awaited<ReturnType<typeof startFixtureServer>> | undefined;

try {
  server = await startFixtureServer('crawl-page1.html');

  const { pagesVisited, findingsCount } = await crawl({
    url: server.url,
    outDir,
    maxDepth: 3,
    maxMs: 60_000,
    rateMs: 0,
  });

  assert.equal(pagesVisited, 3, `expected 3 pages visited, got ${pagesVisited}`);

  // Each of the 3 pages has a listener with no origin check → 3 findings minimum.
  assert.ok(findingsCount >= 3, `expected ≥3 findings, got ${findingsCount}`);

  const jsonlPath = join(outDir, 'findings.jsonl');
  const lines = readFileSync(jsonlPath, 'utf8').trim().split('\n');
  const findings = lines.map((l) => JSON.parse(l) as Finding);

  // All three pages should appear in the findings pageUrls.
  const pages = new Set(findings.map((f) => f.pageUrl));
  assert.ok(pages.size >= 3, `expected findings from ≥3 distinct pages, got ${pages.size}`);

  console.log(`SMOKE_OK: ${TASK} (pages=${pagesVisited}, findings=${findingsCount})`);
  process.exit(0);
} catch (e) {
  console.error(`SMOKE_FAIL: ${TASK}: ${(e as Error).message}`);
  process.exit(1);
} finally {
  await server?.close();
  rmSync(outDir, { recursive: true, force: true });
}
