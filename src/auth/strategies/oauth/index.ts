/**
 * OAuth/SSO dispatcher — phase 5.6.
 *
 * After navigating to a protected URL, if the page redirects to a known IdP,
 * this module detects which IdP it landed on and delegates to the per-IdP handler.
 * Each IdP handler is isolated in its own file so adding a new IdP = new file only.
 */

import type { BrowserContext } from 'playwright';
import type { AuthConfig } from '../../detect.js';
import { saveStorageState } from '../../storage-state.js';
import { log } from '../../../logger.js';
import { handleOkta } from './okta.js';
import { handleAuth0 } from './auth0.js';
import { handleGoogle } from './google.js';
import { handleMicrosoft } from './microsoft.js';

export interface OAuthLoginConfig {
  /** The application URL to navigate to (will trigger the redirect to IdP). */
  app_url: string;
  /** Environment variable names for credentials: [usernameVar, passwordVar] */
  credentials_env: [string, string];
  /** Auth check to run on the app origin after the OAuth dance completes. */
  success_check: AuthConfig;
  /** Milliseconds to wait for the success check after submit (default: 10000). */
  timeout_ms?: number;
}

export class OAuthLoginError extends Error {
  constructor(reason: string) {
    super(`OAuth login failed: ${reason}`);
    this.name = 'OAuthLoginError';
  }
}

/** All known IdP names. Adding a new IdP requires updating this union AND the switch. */
type IdpName = 'okta' | 'auth0' | 'google' | 'microsoft';

/** Hostname patterns mapped to IdP names. */
const IDP_PATTERNS: Array<{ pattern: RegExp; name: IdpName }> = [
  { pattern: /\.okta\.com|\.okta-emea\.com|\.oktapreview\.com/, name: 'okta' },
  { pattern: /auth0\.com|\.eu\.auth0\.com/, name: 'auth0' },
  { pattern: /accounts\.google\.com/, name: 'google' },
  { pattern: /login\.microsoftonline\.com|login\.live\.com/, name: 'microsoft' },
];

function detectIdp(url: string): IdpName | null {
  try {
    const hostname = new URL(url).hostname;
    for (const { pattern, name } of IDP_PATTERNS) {
      if (pattern.test(hostname)) return name;
    }
  } catch {
    /* ignore malformed URLs */
  }
  return null;
}

/**
 * Performs OAuth login by:
 * 1. Navigating to `config.app_url`.
 * 2. Waiting for a redirect to a known IdP.
 * 3. Delegating to the per-IdP handler.
 * 4. Optionally saving the session to `savePath`.
 *
 * Throws `OAuthLoginError` on any failure.
 */
export async function oauthLogin(
  context: BrowserContext,
  config: OAuthLoginConfig,
  savePath?: string,
): Promise<void> {
  const [userVar, passVar] = config.credentials_env;
  const username = process.env[userVar];
  const password = process.env[passVar];
  if (!username) throw new OAuthLoginError(`env var ${userVar} is not set`);
  if (!password) throw new OAuthLoginError(`env var ${passVar} is not set`);

  const page = await context.newPage();
  try {
    log.info({ appUrl: config.app_url }, 'oauth: navigating to app URL');
    await page.goto(config.app_url, { waitUntil: 'networkidle' }).catch(() => { /* ignore timeout on redirect */ });

    const currentUrl = page.url();
    const idp = detectIdp(currentUrl);
    if (!idp) {
      throw new OAuthLoginError(
        `page did not redirect to a known IdP — landed at ${currentUrl}. Use Tier 0 (manual capture) for unknown IdPs.`,
      );
    }
    log.info({ idp, url: currentUrl }, 'oauth: IdP detected');

    const handlerInput = {
      page,
      username,
      password,
      timeoutMs: config.timeout_ms ?? 10_000,
      appUrl: config.app_url,
      successCheck: config.success_check,
    };

    let result: { ok: boolean; error?: string };
    switch (idp) {
      case 'okta':      result = await handleOkta(handlerInput); break;
      case 'auth0':     result = await handleAuth0(handlerInput); break;
      case 'google':    result = await handleGoogle(handlerInput); break;
      case 'microsoft': result = await handleMicrosoft(handlerInput); break;
      default: {
        // `idp` is now typed as IdpName (a union), so this check is real:
        // TypeScript will emit an error here if a new IdpName is added to the
        // union without a corresponding case above.
        const _exhaustive: never = idp;
        throw new OAuthLoginError(`no handler for IdP: ${_exhaustive}`);
      }
    }

    if (!result.ok) {
      throw new OAuthLoginError(result.error ?? 'unknown error');
    }

    if (savePath) {
      const state = await context.storageState();
      saveStorageState(savePath, state);
      log.info({ savePath }, 'oauth: session saved');
    }
  } finally {
    await page.close();
  }
}
