/**
 * Smoke test for C2 / DESIGN §3.2: MessagePort and BroadcastChannel listeners
 * are captured by the EventTarget.prototype.addEventListener wrap.
 */
import { startFixtureServer } from './_server.js';
import { launchContext, type CapturedListener } from '../../src/crawler/browser.js';

const TASK = 't2.2b';
let server: Awaited<ReturnType<typeof startFixtureServer>> | undefined;
let ctx: Awaited<ReturnType<typeof launchContext>> | undefined;

try {
  server = await startFixtureServer('messageport-broadcast.html');
  ctx = await launchContext({});

  const listeners: CapturedListener[] = [];
  ctx.onReport((ev) => {
    if (ev.t === 'listener') listeners.push(ev as CapturedListener);
  });

  await ctx.page.goto(server.url);
  await ctx.page.waitForLoadState('networkidle');

  if (listeners.length !== 2) {
    throw new Error(
      `expected 2 listeners (MessagePort + BroadcastChannel), got ${listeners.length}: ` +
      listeners.map((l) => l.source.slice(0, 60)).join(' | '),
    );
  }

  const sources = listeners.map((l) => l.source);
  if (!sources.some((s) => s.includes('portHandler'))) {
    throw new Error('MessagePort listener not captured');
  }
  if (!sources.some((s) => s.includes('broadcastHandler'))) {
    throw new Error('BroadcastChannel listener not captured');
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
