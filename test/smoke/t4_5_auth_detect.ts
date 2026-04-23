/**
 * Smoke test for task 4.5: isAuthenticated checks and SessionExpiredError.
 *
 * Uses a fixture that redirects to /login.html when no "session" cookie is set.
 * With a stale storageState (no valid session cookie), assertAuthenticated must
 * throw SessionExpiredError with exit code 2.
 */
import assert from 'node:assert/strict';
import { startFixtureServer } from './_server.js';
import { launchContext } from '../../src/crawler/browser.js';
import { isAuthenticated, assertAuthenticated, SessionExpiredError } from '../../src/auth/detect.js';

const TASK = 't4.5';
let server: Awaited<ReturnType<typeof startFixtureServer>> | undefined;
let ctx: Awaited<ReturnType<typeof launchContext>> | undefined;

try {
  server = await startFixtureServer();
  ctx = await launchContext({});  // No storageState → no session cookie.

  // Navigate to the protected page — it will redirect to /login.html.
  await ctx.page.goto(`${server.url}/protected.html`, { waitUntil: 'load' });

  // 1. url_not_matches: current URL contains "login" → check fails → not authenticated.
  const authConfig = {
    checks: [
      { kind: 'url_not_matches' as const, pattern: 'login' },
      { kind: 'selector' as const, selector: '[data-testid="account-menu"]' },
      { kind: 'cookie_present' as const, name: 'session' },
    ],
    any_of: true,
  };

  const authenticated = await isAuthenticated(ctx.page, authConfig);
  assert.equal(authenticated, false, 'should not be authenticated with stale/no session');

  // 2. assertAuthenticated must throw SessionExpiredError.
  let threw = false;
  try {
    await assertAuthenticated(ctx.page, authConfig);
  } catch (err) {
    if (err instanceof SessionExpiredError) {
      threw = true;
    } else {
      throw err;
    }
  }
  assert.ok(threw, 'assertAuthenticated did not throw SessionExpiredError');

  // 3. js check — positive case: evaluate a truthy expression.
  const jsConfig = {
    checks: [{ kind: 'js' as const, expression: '1 + 1 === 2' }],
  };
  const jsOk = await isAuthenticated(ctx.page, jsConfig);
  assert.equal(jsOk, true, 'js check with truthy expression should pass');

  console.log(`SMOKE_OK: ${TASK}`);
  process.exit(0);
} catch (e) {
  console.error(`SMOKE_FAIL: ${TASK}: ${(e as Error).message}`);
  process.exit(1);
} finally {
  await ctx?.close();
  await server?.close();
}
