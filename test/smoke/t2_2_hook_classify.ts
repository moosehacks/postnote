/**
 * Smoke test for t2.2: the hook's origin-check classification logic.
 * Exercises 'none', 'indexOf', and 'strict-eq' classifications via real fixtures.
 */
import { startFixtureServer } from './_server.js';
import { launchContext, type CapturedListener } from '../../src/crawler/browser.js';

const TASK = 't2.2';
let server: Awaited<ReturnType<typeof startFixtureServer>> | undefined;
let ctx: Awaited<ReturnType<typeof launchContext>> | undefined;

// Single callback with a reset slot — avoids registering multiple callbacks
// across fixture navigations (which would accumulate and write to orphaned arrays).
let latestListeners: CapturedListener[] = [];

function captureClassification(fixtureFile: string): Promise<string> {
  latestListeners = [];
  return ctx!.page.goto(`${server!.url}/${fixtureFile}`)
    .then(() => ctx!.page.waitForLoadState('networkidle'))
    .then(() => {
      if (latestListeners.length === 0) throw new Error(`no listener captured for ${fixtureFile}`);
      return latestListeners[latestListeners.length - 1]!.originCheck;
    });
}

try {
  server = await startFixtureServer();
  ctx = await launchContext({});
  ctx.onReport((ev) => {
    if (ev.t === 'listener') latestListeners.push(ev as CapturedListener);
  });

  const cases: Array<[string, string]> = [
    ['vuln-postmessage-noorigin.html', 'none'],
    ['vuln-postmessage-indexof.html', 'indexOf'],
    ['safe-postmessage-stricteq.html', 'strict-eq'],
  ];

  for (const [fixture, expected] of cases) {
    const got = await captureClassification(fixture);
    if (got !== expected) {
      throw new Error(`${fixture}: expected originCheck=${expected}, got ${got}`);
    }
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
