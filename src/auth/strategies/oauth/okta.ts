/**
 * Okta IdP handler for OAuth Tier 2 auth.
 * Handles the standard Okta username+password flow.
 * MFA (Okta Verify push / TOTP) is handled separately by the Tier 3 strategy.
 */

import type { OAuthHandlerInput, OAuthHandlerResult } from './types.js';
import { isAuthenticated } from '../../detect.js';
import { log } from '../../../logger.js';

const OKTA_USERNAME_SELECTOR = '#okta-signin-username, input[name="identifier"], input[name="username"]';
const OKTA_PASSWORD_SELECTOR = '#okta-signin-password, input[name="credentials.passcode"], input[name="password"]';
const OKTA_SUBMIT_SELECTOR = 'input[type="submit"], button[type="submit"]';

export async function handleOkta(input: OAuthHandlerInput): Promise<OAuthHandlerResult> {
  const { page, username, password, timeoutMs, successCheck } = input;
  log.info({ url: page.url() }, 'oauth/okta: filling credentials');
  try {
    await page.fill(OKTA_USERNAME_SELECTOR, username);
    // Some Okta flows split username and password onto separate pages.
    // Click the labelled "Next" button (not the final submit) and wait for the
    // password field to appear. Avoid matching the final submit button here.
    const nextButton = page.locator('input[value="Next"], button:has-text("Next")').first();
    if (await nextButton.count() > 0) {
      await nextButton.click();
      await page.waitForLoadState('networkidle').catch(() => { /* ignore timeout */ });
    }
    await page.fill(OKTA_PASSWORD_SELECTOR, password);
    await page.click(OKTA_SUBMIT_SELECTOR);
    await page.waitForTimeout(timeoutMs);

    const ok = await isAuthenticated(page, successCheck);
    if (!ok) {
      return { ok: false, error: 'Okta login: success check did not pass — check credentials or MFA requirement' };
    }
    log.info('oauth/okta: login succeeded');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Okta handler threw: ${(err as Error).message}` };
  }
}
