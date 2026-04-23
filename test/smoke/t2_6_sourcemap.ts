import { startFixtureServer } from './_server.js';
import { launchContext, type CapturedListener } from '../../src/crawler/browser.js';

const TASK = 't2.6';
let server: Awaited<ReturnType<typeof startFixtureServer>> | undefined;
let ctx: Awaited<ReturnType<typeof launchContext>> | undefined;

try {
  server = await startFixtureServer('app-from-script.html');
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

  if (!l.scriptUrl?.endsWith('/static/app.js')) {
    throw new Error(`scriptUrl should end in /static/app.js, got: ${l.scriptUrl}`);
  }
  if (!l.pageUrl.startsWith('http://127.0.0.1')) {
    throw new Error(`pageUrl should match fixture URL, got: ${l.pageUrl}`);
  }

  console.log(`SMOKE_OK: ${TASK} (scriptUrl=${l.scriptUrl})`);
  process.exit(0);
} catch (e) {
  console.error(`SMOKE_FAIL: ${TASK}: ${(e as Error).message}`);
  process.exit(1);
} finally {
  await ctx?.close();
  await server?.close();
}
