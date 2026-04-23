/**
 * Google IdP handler for OAuth Tier 2 auth.
 * Handles the standard Google OAuth consent + Sign In With Google flow.
 * MFA (Google Authenticator / push) falls back to Tier 0.
 */

import type { OAuthHandlerInput, OAuthHandlerResult } from './types.js';
import { isAuthenticated } from '../../detect.js';
import { log } from '../../../logger.js';

const EMAIL_SELECTOR = 'input[type="email"]';
const PASSWORD_SELECTOR = 'input[type="password"]';
const NEXT_SELECTOR = '#identifierNext, #passwordNext, button:has-text("Next")';

export async function handleGoogle(input: OAuthHandlerInput): Promise<OAuthHandlerResult> {
  const { page, username, password, timeoutMs, successCheck } = input;
  log.info({ url: page.url() }, 'oauth/google: filling email');
  try {
    await page.fill(EMAIL_SELECTOR, username);
    await page.click(NEXT_SELECTOR);
    await page.waitForLoadState('networkidle').catch(() => { /* ignore */ });

    log.info('oauth/google: filling password');
    await page.fill(PASSWORD_SELECTOR, password);
    await page.click(NEXT_SELECTOR);
    await page.waitForTimeout(timeoutMs);

    const ok = await isAuthenticated(page, successCheck);
    if (!ok) {
      return { ok: false, error: 'Google login: success check did not pass — MFA or 2SV may be required (use Tier 0)' };
    }
    log.info('oauth/google: login succeeded');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Google handler threw: ${(err as Error).message}` };
  }
}
