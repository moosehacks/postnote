import type { Page } from 'playwright';

export type AuthCheck =
  | { kind: 'selector'; selector: string }
  | { kind: 'url_not_matches'; pattern: string }
  | { kind: 'cookie_present'; name: string }
  | { kind: 'js'; expression: string };

export interface AuthConfig {
  checks: AuthCheck[];
  /** If any_of is true (default), pass when at least one check passes. If false, all must pass. */
  any_of?: boolean;
}

/** Session-expired error — halts the crawl. */
export class SessionExpiredError extends Error {
  constructor(reason: string) {
    super(`Session expired: ${reason}`);
    this.name = 'SessionExpiredError';
  }
}

/**
 * Evaluates a set of auth checks against the current page state.
 * Returns true if the session appears valid, false otherwise.
 */
export async function isAuthenticated(page: Page, config: AuthConfig): Promise<boolean> {
  const { checks, any_of = true } = config;
  const results = await Promise.all(checks.map((c) => runCheck(page, c)));
  return any_of ? results.some(Boolean) : results.every(Boolean);
}

/**
 * Asserts the current session is valid.
 * Throws SessionExpiredError (exit-code 2) if authentication has lapsed.
 */
export async function assertAuthenticated(page: Page, config: AuthConfig): Promise<void> {
  const ok = await isAuthenticated(page, config);
  if (!ok) {
    throw new SessionExpiredError(
      `none of the configured checks passed on ${page.url()}`,
    );
  }
}

async function runCheck(page: Page, check: AuthCheck): Promise<boolean> {
  try {
    switch (check.kind) {
      case 'selector':
        return await page.locator(check.selector).count().then((n) => n > 0);

      case 'url_not_matches':
        return !new RegExp(check.pattern).test(page.url());

      case 'cookie_present': {
        const ctx = page.context();
        const cookies = await ctx.cookies();
        return cookies.some((c) => c.name === check.name);
      }

      case 'js': {
        const result = await page.evaluate(check.expression);
        return Boolean(result);
      }

      default: {
        const _exhaustive: never = check;
        return false;
      }
    }
  } catch {
    return false;
  }
}
