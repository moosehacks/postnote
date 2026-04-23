import { startFixtureServer } from './_server.js';
import { launchContext, type CapturedListener } from '../../src/crawler/browser.js';

const TASK = 't2.4';
let server: Awaited<ReturnType<typeof startFixtureServer>> | undefined;
let ctx: Awaited<ReturnType<typeof launchContext>> | undefined;

try {
  server = await startFixtureServer('vuln-postmessage-noorigin.html');
  ctx = await launchContext({});

  const listeners: CapturedListener[] = [];
  ctx.onReport((ev) => {
    if (ev.t === 'listener') listeners.push(ev as CapturedListener);
  });

  await ctx.page.goto(server.url);
  await ctx.page.waitForLoadState('networkidle');

  if (listeners.length !== 1) throw new Error(`expected 1 listener, got ${listeners.length}`);
  const [l] = listeners;
  if (!l) throw new Error('no listener captured');
  if (l.originCheck !== 'none') throw new Error(`expected originCheck=none, got ${l.originCheck}`);
  if (!l.scriptUrl) throw new Error(`scriptUrl missing (stack: ${l.stack.slice(0, 200)})`);
  if (!l.pageUrl) throw new Error('pageUrl missing');

  console.log(`SMOKE_OK: ${TASK}`);
  process.exit(0);
} catch (e) {
  console.error(`SMOKE_FAIL: ${TASK}: ${(e as Error).message}`);
  process.exit(1);
} finally {
  await ctx?.close();
  await server?.close();
}
