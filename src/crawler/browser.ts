import { chromium as chromiumExtra } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, BrowserContext, Page, CDPSession } from 'playwright';

// Patch all known bot-detection vectors (navigator.webdriver, Chrome runtime shape,
// plugins, canvas/audio noise, etc.) so Cloudflare Bot Management passes headless through.
chromiumExtra.use(StealthPlugin());
import { PRELUDE_SOURCE } from '../hooks/prelude.js';
import { resolveStack } from '../report/sourcemap.js';
import type { HookEvent, ListenerEvent, SinkHitEvent } from '../types.js';

/** Launches a bare Chromium browser with no context attached. */
export async function launchBrowser(): Promise<Browser> {
  return chromiumExtra.launch({ headless: true });
}

/** A listener event enriched with host-side attribution fields. */
export interface CapturedListener extends ListenerEvent {
  /** Best-effort script URL resolved from the V8 stack trace. */
  scriptUrl: string | null;
  /** Top-level page URL at time of capture (alias for topUrl). */
  pageUrl: string;
}

/** A sink hit enriched with host-side attribution. */
export interface CapturedSinkHit extends SinkHitEvent {
  scriptUrl: string | null;
  pageUrl: string;
}

export type CapturedEvent = CapturedListener | CapturedSinkHit | HookEvent;

export interface LaunchContextResult {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  cdp: CDPSession;
  /** Register a callback for every event emitted by the in-page hook. */
  onReport: (cb: (event: CapturedEvent) => void) => void;
  /**
   * Stops an active Playwright trace and either saves it to `savePath`
   * (when non-null) or discards it. No-ops if tracing was never started.
   */
  stopTrace: (savePath: string | null) => Promise<void>;
  close: () => Promise<void>;
}

/**
 * Creates a fresh BrowserContext + Page on an existing browser.
 * `close()` tears down only the context, not the browser — the caller is
 * responsible for closing the browser when the crawl ends.
 *
 * Use this in the crawl loop so one Chromium process serves all pages.
 * Pass `enableTracing: true` to start a Playwright trace on the context
 * (screenshots, snapshots, sources).  Call `stopTrace(path)` to save or
 * `stopTrace(null)` to discard.
 */
export async function createPageContext(
  browser: Browser,
  { storageState, enableTracing }: { storageState?: string; enableTracing?: boolean } = {},
): Promise<LaunchContextResult> {
  return buildContext(browser, storageState, enableTracing ?? false, async (ctx) => { await ctx.close(); });
}

/**
 * Launches a Chromium browser + context + page with the prelude hook installed.
 * `close()` closes the entire browser (suitable for one-shot scans).
 *
 * @param storageState - path to a saved Playwright storageState JSON, if any
 * @param enableTracing - if true, starts a Playwright trace (screenshots, snapshots, sources)
 */
export async function launchContext({
  storageState,
  enableTracing,
}: { storageState?: string; enableTracing?: boolean } = {}): Promise<LaunchContextResult> {
  const browser = await chromiumExtra.launch({ headless: true });
  return buildContext(browser, storageState, enableTracing ?? false, async () => { await browser.close(); });
}

/**
 * Shared context-setup logic: new context, init script, CDP binding, event wiring.
 * The `onClose` callback lets the caller control whether to close just the context
 * or the whole browser.
 */
async function buildContext(
  browser: Browser,
  storageState: string | undefined,
  enableTracing: boolean,
  onClose: (ctx: BrowserContext) => Promise<void>,
): Promise<LaunchContextResult> {
  const context = await browser.newContext(
    storageState ? { storageState } : {},
  );
  await context.addInitScript(PRELUDE_SOURCE);

  if (enableTracing) {
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  }

  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);

  await cdp.send('Runtime.enable');
  await cdp.send('Runtime.addBinding', { name: '__bbReport' });

  const callbacks: Array<(event: CapturedEvent) => void> = [];

  cdp.on('Runtime.bindingCalled', (raw: { name: string; payload: string }) => {
    if (raw.name !== '__bbReport') return;
    let ev: HookEvent;
    try {
      // JSON.parse returns unknown; we validate the t discriminant before trusting
      // the shape — hook payloads are trusted but malformed ones must fail loud (rule 9).
      const parsed: unknown = JSON.parse(raw.payload);
      const VALID_TYPES = new Set(['listener', 'postmessage', 'sink']);
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('t' in parsed) ||
        !VALID_TYPES.has((parsed as { t: unknown }).t as string)
      ) {
        return;
      }
      ev = parsed as HookEvent;
    } catch {
      return;
    }

    let enriched: CapturedEvent;
    if (ev.t === 'listener') {
      enriched = {
        ...ev,
        scriptUrl: resolveStack(ev.stack).scriptUrl,
        pageUrl: ev.topUrl,
      } satisfies CapturedListener;
    } else if (ev.t === 'sink') {
      enriched = {
        ...ev,
        scriptUrl: resolveStack(ev.stack).scriptUrl,
        pageUrl: ev.topUrl,
      } satisfies CapturedSinkHit;
    } else {
      enriched = ev;
    }

    for (const cb of callbacks) {
      cb(enriched);
    }
  });

  return {
    browser,
    context,
    page,
    cdp,
    onReport: (cb) => {
      callbacks.push(cb);
    },
    stopTrace: async (savePath: string | null) => {
      if (!enableTracing) return;
      if (savePath) {
        await context.tracing.stop({ path: savePath });
      } else {
        await context.tracing.stop();
      }
    },
    close: async () => {
      try { await cdp.detach(); } catch { /* ignore if already detached */ }
      await onClose(context);
    },
  };
}
