import assert from 'node:assert/strict';
import { startFixtureServer } from './_server.js';
import { launchContext } from '../../src/crawler/browser.js';
import type { CapturedSinkHit } from '../../src/crawler/browser.js';
import { resolveStack, resolveOriginalSource } from '../../src/report/sourcemap.js';

const TASK = 't5.4';
let server: { url: string; close: () => Promise<void> } | undefined;
let ctx: Awaited<ReturnType<typeof launchContext>> | undefined;

try {
  server = await startFixtureServer('vuln-sourcemap.html');
  ctx = await launchContext({});

  const sinks: CapturedSinkHit[] = [];
  ctx.onReport((ev) => {
    if (ev.t === 'sink') sinks.push(ev as CapturedSinkHit);
  });

  await ctx.page.goto(`${server.url}#POSTNOTE_SM_TOKEN`);
  await ctx.page.waitForLoadState('networkidle');

  const innerHtmlHit = sinks.find((s) => s.sink === 'innerHTML');
  if (!innerHtmlHit) throw new Error(`expected innerHTML sink hit, got: ${JSON.stringify(sinks.map(s => s.sink))}`);

  // The stack must resolve to the minified script URL
  const res = resolveStack(innerHtmlHit.stack);
  if (res.attribution !== 'resolved') throw new Error('stack did not resolve to a script URL');
  if (!res.scriptUrl.includes('app.min.js')) {
    throw new Error(`expected script URL to include app.min.js, got: ${res.scriptUrl}`);
  }

  // Source-map resolution must map back to src/app.ts
  const orig = await resolveOriginalSource(res.scriptUrl, res.line, res.col);
  if (!orig) throw new Error('resolveOriginalSource returned null — source map not resolved');
  if (!orig.source.includes('app.ts')) {
    throw new Error(`expected original source to include app.ts, got: ${orig.source}`);
  }

  console.log(`SMOKE_OK: ${TASK}`);
  process.exit(0);
} catch (e) {
  console.error(`SMOKE_FAIL: ${TASK}: ${(e as Error).message}`);
  process.exit(1);
} finally {
  await ctx?.close();
  await server?.close();
}
