import { startFixtureServer } from './_server.js';
import { launchContext, type CapturedListener } from '../../src/crawler/browser.js';

const TASK = 't2.5';
let server: Awaited<ReturnType<typeof startFixtureServer>> | undefined;
let ctx: Awaited<ReturnType<typeof launchContext>> | undefined;

const INNER_DISTINCTIVE = 'REAL_HANDLER_DISTINCTIVE_STRING';
const WRAPPER_TELLTALE = 'nrWrapper';

try {
  server = await startFixtureServer('wrapped-newrelic.html');
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

  if (!l.source.includes(INNER_DISTINCTIVE)) {
    throw new Error(
      `captured source should contain inner handler's distinctive string '${INNER_DISTINCTIVE}', ` +
      `but got: ${l.source.slice(0, 200)}`,
    );
  }
  if (l.source.includes(WRAPPER_TELLTALE)) {
    throw new Error(
      `captured source should NOT contain wrapper telltale '${WRAPPER_TELLTALE}' — unwinding failed`,
    );
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
