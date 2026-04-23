import { startFixtureServer } from './_server.js';
import { launchContext } from '../../src/crawler/browser.js';
import type { CapturedSinkHit } from '../../src/crawler/browser.js';

const TASK = 't5.1';
let server: { url: string; close: () => Promise<void> } | undefined;
let ctx: Awaited<ReturnType<typeof launchContext>> | undefined;

try {
  server = await startFixtureServer('vuln-dom-xss-hash.html');
  ctx = await launchContext({});

  const sinks: CapturedSinkHit[] = [];
  ctx.onReport((ev) => {
    if (ev.t === 'sink') sinks.push(ev as CapturedSinkHit);
  });

  // Navigate with a hash value so the page reads location.hash → innerHTML
  const url = `${server.url}#POSTNOTE_TEST_TOKEN`;
  await ctx.page.goto(url);
  await ctx.page.waitForLoadState('networkidle');

  const innerHtmlHit = sinks.find((s) => s.sink === 'innerHTML');
  if (!innerHtmlHit) throw new Error(`expected an innerHTML sink hit, got: ${JSON.stringify(sinks.map(s => s.sink))}`);
  if (!innerHtmlHit.sources.includes('hash')) {
    throw new Error(`expected 'hash' in sources, got: ${JSON.stringify(innerHtmlHit.sources)}`);
  }
  if (!innerHtmlHit.value.includes('POSTNOTE_TEST_TOKEN')) {
    throw new Error(`expected token in sink value, got: ${innerHtmlHit.value}`);
  }
  if (!innerHtmlHit.pageUrl) throw new Error('pageUrl missing');

  console.log(`SMOKE_OK: ${TASK}`);
  process.exit(0);
} catch (e) {
  console.error(`SMOKE_FAIL: ${TASK}: ${(e as Error).message}`);
  process.exit(1);
} finally {
  await ctx?.close();
  await server?.close();
}
