/**
 * Verifies that crawl() halts with SessionExpiredError when the mid-crawl
 * auth check fails on the first page (sessionCheckEvery=1 forces it every page).
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFixtureServer } from './_server.js';
import { crawl } from '../../src/crawler/crawl.js';
import { SessionExpiredError } from '../../src/auth/detect.js';

const TASK = 't4.5b';
const outDir = mkdtempSync(join(tmpdir(), 'bbcrawl-t4_5b-'));
let server: Awaited<ReturnType<typeof startFixtureServer>> | undefined;

try {
  server = await startFixtureServer('crawl-page1.html');

  // Demand a cookie that will never be present — every page visit should fail.
  const authConfig = {
    checks: [{ kind: 'cookie_present' as const, name: '__must_not_exist__' }],
  };

  let threw = false;
  try {
    await crawl({
      url: server.url,
      outDir,
      maxDepth: 3,
      maxMs: 30_000,
      rateMs: 0,
      authConfig,
      sessionCheckEvery: 1,  // check every page
    });
  } catch (err) {
    if (err instanceof SessionExpiredError) {
      threw = true;
    } else {
      throw err;
    }
  }

  assert.ok(threw, 'crawl should have thrown SessionExpiredError');

  console.log(`SMOKE_OK: ${TASK}`);
  process.exit(0);
} catch (e) {
  console.error(`SMOKE_FAIL: ${TASK}: ${(e as Error).message}`);
  process.exit(1);
} finally {
  await server?.close();
  rmSync(outDir, { recursive: true, force: true });
}
