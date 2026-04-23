/**
 * Auth0 IdP handler for OAuth Tier 2 auth.
 * Covers the standard Auth0 Universal Login (new and classic UX).
 */

import type { OAuthHandlerInput, OAuthHandlerResult } from './types.js';
import { isAuthenticated } from '../../detect.js';
import { log } from '../../../logger.js';

// Note: Auth0 classic UX uses element ids like "1-email" which start with a digit.
// CSS id selectors (#1-email) are invalid per spec for digit-leading ids; use
// attribute selectors instead to avoid silent failures in strict browsers.
const EMAIL_SELECTOR = 'input[name="email"], input[name="username"], [id="1-email"]';
const PASSWORD_SELECTOR = 'input[name="password"], [id="1-password"]';
const CONTINUE_SELECTOR = 'button[name="action"], button[type="submit"]';

export async function handleAuth0(input: OAuthHandlerInput): Promise<OAuthHandlerResult> {
  const { page, username, password, timeoutMs, successCheck } = input;
  log.info({ url: page.url() }, 'oauth/auth0: filling credentials');
  try {
    await page.fill(EMAIL_SELECTOR, username);
    // Auth0 Universal Login may show a "Continue" button before the password field.
    const continueBtn = page.locator(CONTINUE_SELECTOR).first();
    if (await continueBtn.count() > 0) {
      await continueBtn.click();
      await page.waitForLoadState('networkidle').catch(() => { /* ignore */ });
    }
    await page.fill(PASSWORD_SELECTOR, password);
    await page.click(CONTINUE_SELECTOR);
    await page.waitForTimeout(timeoutMs);

    const ok = await isAuthenticated(page, successCheck);
    if (!ok) {
      return { ok: false, error: 'Auth0 login: success check did not pass' };
    }
    log.info('oauth/auth0: login succeeded');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Auth0 handler threw: ${(err as Error).message}` };
  }
}
