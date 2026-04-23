/**
 * Auth Tier 1: Selector-driven username+password form login.
 * Configuration is read from auth.yaml (see AuthFormConfig).
 *
 * Falls back to a Tier-0 error if login fails — the crawl never silently
 * continues unauthenticated (rule 9 / §4.1 principle 3).
 */

import type { BrowserContext } from 'playwright';
import { saveStorageState } from '../storage-state.js';
import type { AuthConfig } from '../detect.js';
import { isAuthenticated } from '../detect.js';
import { log } from '../../logger.js';

export interface AuthFormConfig {
  /** Full URL of the login page. */
  login_url: string;
  selectors: {
    username: string;
    password: string;
    submit: string;
  };
  /** Environment variable names for credentials: [usernameVar, passwordVar] */
  credentials_env: [string, string];
  /** Auth check to run after submit to confirm login succeeded. */
  success_check: AuthConfig;
  /** Milliseconds to wait for the success check after submit (default: 10000). */
  timeout_ms?: number;
}

export class FormLoginError extends Error {
  constructor(reason: string) {
    super(`Form login failed: ${reason}`);
    this.name = 'FormLoginError';
  }
}

/**
 * Performs a form-based login using the provided config.
 * On success, saves the session to `savePath` if provided.
 * Throws `FormLoginError` on any failure so the caller can halt and explain why.
 */
export async function formLogin(
  context: BrowserContext,
  config: AuthFormConfig,
  savePath?: string,
): Promise<void> {
  const [userVar, passVar] = config.credentials_env;
  const username = process.env[userVar];
  const password = process.env[passVar];

  if (!username) throw new FormLoginError(`env var ${userVar} is not set`);
  if (!password) throw new FormLoginError(`env var ${passVar} is not set`);

  const page = await context.newPage();
  try {
    log.info({ loginUrl: config.login_url }, 'form login: navigating to login page');
    await page.goto(config.login_url, { waitUntil: 'networkidle' });

    log.info({ selector: config.selectors.username }, 'form login: filling username');
    await page.fill(config.selectors.username, username);

    log.info({ selector: config.selectors.password }, 'form login: filling password');
    await page.fill(config.selectors.password, password);

    log.info({ selector: config.selectors.submit }, 'form login: clicking submit');
    await page.click(config.selectors.submit);

    const timeout = config.timeout_ms ?? 10_000;
    log.info({ timeout }, 'form login: waiting for page to settle after submit');
    // Wait for navigation/networkidle rather than a blind timeout so fast logins
    // don't pay the full timeout_ms penalty. Falls through on SPA navigations that
    // never fully idle.
    await page.waitForLoadState('networkidle', { timeout }).catch(() => { /* SPA fallback */ });

    const ok = await isAuthenticated(page, config.success_check);
    if (!ok) {
      throw new FormLoginError(
        'success_check did not pass after submit — wrong credentials or unexpected page state',
      );
    }

    log.info('form login: success check passed');

    if (savePath) {
      const state = await context.storageState();
      saveStorageState(savePath, state);
      log.info({ savePath }, 'form login: session saved');
    }
  } finally {
    await page.close();
  }
}
