import assert from 'node:assert/strict';
import { startFixtureServer } from './_server.js';
import { launchContext } from '../../src/crawler/browser.js';
import { interact } from '../../src/crawler/interact.js';
import type { CapturedListener } from '../../src/crawler/browser.js';

const TASK = 't4.2';
let server: Awaited<ReturnType<typeof startFixtureServer>> | undefined;
let ctx: Awaited<ReturnType<typeof launchContext>> | undefined;

try {
  server = await startFixtureServer('lazy-listener.html');
  ctx = await launchContext({});

  const listeners: CapturedListener[] = [];
  ctx.onReport((ev) => {
    if (ev.t === 'listener') listeners.push(ev as CapturedListener);
  });

  await ctx.page.goto(server.url, { waitUntil: 'networkidle' });

  // Before interaction: no listeners expected (handler is behind the button click).
  assert.equal(listeners.length, 0, `expected 0 listeners before interact, got ${listeners.length}`);

  await interact(ctx.page);

  // Wait a moment for the binding events to flush through CDP.
  await ctx.page.waitForTimeout(200);

  assert.equal(listeners.length, 1, `expected 1 listener after interact, got ${listeners.length}`);
  assert.ok(
    listeners[0].source.includes('__LAZY_HANDLER__') || listeners[0].source.includes('lazyLoadedHandler'),
    `captured source should reference the lazy handler, got: ${listeners[0].source.slice(0, 120)}`,
  );

  console.log(`SMOKE_OK: ${TASK}`);
  process.exit(0);
} catch (e) {
  console.error(`SMOKE_FAIL: ${TASK}: ${(e as Error).message}`);
  process.exit(1);
} finally {
  await ctx?.close();
  await server?.close();
}
