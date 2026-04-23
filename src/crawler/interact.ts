import type { Page } from 'playwright';

/**
 * Accessible-name fragments that indicate a dangerous action.
 * We never click elements whose accessible name matches any of these (case-insensitive).
 */
const DANGER_PATTERNS = /\b(log.?out|sign.?out|sign.?off|log.?off|delete|remove|deactivate|unsubscribe|cancel.?account|destroy)\b/i;

/**
 * Performs safe interactions on a page to trigger lazy-loaded JS:
 *   1. Scrolls to the bottom.
 *   2. Clicks all visible, non-dangerous buttons, inputs, and same-origin links.
 *   3. Fires hashchange and popstate to trigger hash-router code paths.
 *
 * <a> links are included so SPA nav links (which call pushState on click)
 * fire their route-transition handlers. If a click causes a full page
 * navigation the stale-handle error is caught and remaining handles are skipped.
 *
 * Errors from individual interactions are swallowed — if a click navigates away
 * we do not want to abort the whole interaction pass. Each click is isolated.
 *
 * @param page - already-navigated Playwright page
 * @param settleMsAfterClick - ms to wait after each click for lazy chunks to register
 */
export async function interact(page: Page, settleMsAfterClick: number = 300): Promise<void> {
  await scrollToBottom(page);
  await clickInteractiveElements(page, settleMsAfterClick);
  await fireNavigationEvents(page);
}

async function scrollToBottom(page: Page): Promise<void> {
  try {
    await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
    // Scroll back to top so viewport-triggered handlers see the full range.
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  } catch {
    // Page may have navigated; ignore.
  }
}

/** URL schemes that are never safe to click programmatically. */
const SKIP_SCHEMES = /^(javascript|mailto|tel|blob|data):/i;

async function clickInteractiveElements(page: Page, settleMsAfterClick: number): Promise<void> {
  const pageOrigin = (() => {
    try { return new URL(page.url()).origin; } catch { return ''; }
  })();

  // Buttons + same-origin <a> links. Links trigger SPA pushState handlers that
  // buttons alone would miss; full-page navigations are caught via stale-handle errors.
  const handles = await page.$$(
    'button, [role="button"], input[type="button"], input[type="submit"], a[href]',
  );

  for (const handle of handles) {
    try {
      const meta = await handle.evaluate((el, origin) => {
        const label =
          el.getAttribute('aria-label') ??
          el.getAttribute('title') ??
          el.textContent ??
          '';
        const href = el.tagName === 'A' ? (el as HTMLAnchorElement).href : null;
        return { label: label.trim(), href, origin };
      }, pageOrigin);

      if (DANGER_PATTERNS.test(meta.label)) continue;

      if (meta.href !== null) {
        // Skip non-http/https schemes (javascript:, mailto:, tel:, blob:, data:).
        if (SKIP_SCHEMES.test(meta.href)) continue;
        // Skip external origins — we only want same-origin SPA nav.
        try {
          if (new URL(meta.href).origin !== pageOrigin) continue;
        } catch { continue; }
        // Skip bare fragment anchors (#section) — fireNavigationEvents covers hashchange.
        // Keep /#/route style fragments since those are hash-router SPA routes.
        const u = new URL(meta.href);
        if (u.pathname === new URL(page.url()).pathname && u.hash && !u.hash.includes('/')) continue;
      }

      const visible = await handle.isVisible();
      if (!visible) continue;

      await handle.click({ timeout: 1000 }).catch(() => { /* click may navigate */ });
      await page.waitForTimeout(settleMsAfterClick);
    } catch {
      // Element became stale or page navigated — skip.
    }
  }
}

async function fireNavigationEvents(page: Page): Promise<void> {
  try {
    await page.evaluate(() => {
      window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL: location.href, newURL: location.href + '#__bb' }));
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    });
  } catch {
    // Page may have navigated; ignore.
  }
}
