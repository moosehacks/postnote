/**
 * Microsoft (Azure AD / Entra ID) IdP handler for OAuth Tier 2 auth.
 * Handles the standard Microsoft MSAL login page.
 * MFA (Authenticator app push / TOTP) falls back to Tier 0.
 */

import type { OAuthHandlerInput, OAuthHandlerResult } from './types.js';
import { isAuthenticated } from '../../detect.js';
import { log } from '../../../logger.js';

const EMAIL_SELECTOR = 'input[type="email"], input[name="loginfmt"]';
const PASSWORD_SELECTOR = 'input[type="password"], input[name="passwd"]';
const NEXT_SELECTOR = 'input[type="submit"]';
// Microsoft sometimes shows a "Stay signed in?" prompt — dismiss it
const STAY_SIGNED_IN_NO = '#idBtn_Back';

export async function handleMicrosoft(input: OAuthHandlerInput): Promise<OAuthHandlerResult> {
  const { page, username, password, timeoutMs, successCheck } = input;
  log.info({ url: page.url() }, 'oauth/microsoft: filling email');
  try {
    await page.fill(EMAIL_SELECTOR, username);
    await page.click(NEXT_SELECTOR);
    await page.waitForLoadState('networkidle').catch(() => { /* ignore */ });

    log.info('oauth/microsoft: filling password');
    await page.fill(PASSWORD_SELECTOR, password);
    await page.click(NEXT_SELECTOR);
    await page.waitForTimeout(Math.min(timeoutMs, 5000));

    // Dismiss "Stay signed in?" if present
    const stayBtn = page.locator(STAY_SIGNED_IN_NO);
    if (await stayBtn.count() > 0) {
      log.info('oauth/microsoft: dismissing "Stay signed in?" prompt');
      await stayBtn.click();
      await page.waitForTimeout(timeoutMs);
    }

    const ok = await isAuthenticated(page, successCheck);
    if (!ok) {
      return { ok: false, error: 'Microsoft login: success check did not pass — MFA may be required (use Tier 0)' };
    }
    log.info('oauth/microsoft: login succeeded');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Microsoft handler threw: ${(err as Error).message}` };
  }
}
