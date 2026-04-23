import { writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { chromium } from 'playwright';
import { log } from '../logger.js';

/**
 * Saves a Playwright storageState (cookies + localStorage) to disk.
 * File permissions are set to 0o600 — owner-read only.
 */
export function saveStorageState(path: string, state: object): void {
  const dir = dirname(resolve(path));
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2), 'utf8');
  chmodSync(path, 0o600);
}

/**
 * Loads a stored storageState from disk.
 * Returns null if the file does not exist.
 */
export function loadStorageState(path: string): object | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as object;
  } catch (err) {
    throw new Error(`Failed to parse storageState at ${path}: ${(err as Error).message}`);
  }
}

/**
 * Opens a headful Chromium at targetUrl, waits for the user to press Enter,
 * then captures and saves the full session state to savePath.
 *
 * This is the Tier-0 auth capture — works for any auth scheme the user can
 * complete manually (OAuth, MFA, SSO, CAPTCHA, WebAuthn, etc.).
 */
export async function captureSession(targetUrl: string, savePath: string): Promise<void> {
  log.info({ targetUrl, savePath }, 'launching headful browser for auth capture');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(targetUrl);

  log.info('Browser is open. Log in, then press Enter here to save the session.');

  await waitForEnter();

  const state = await context.storageState();
  await browser.close();

  saveStorageState(savePath, state);
  log.info({ savePath }, 'session saved');
}

function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin });
    process.stdout.write('Press Enter when you are logged in... ');
    rl.once('line', () => {
      rl.close();
      resolve();
    });
  });
}
