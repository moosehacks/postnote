/**
 * Auth Tier 3: MFA handling — phase 5.7
 *
 * Supported strategies:
 *   - TOTP: generates a time-based OTP from a shared secret via `otplib`.
 *     Justified dep: otplib — the de-facto TOTP library for Node, RFC 6238 compliant.
 *   - Email OTP: polls an IMAP inbox for a code via `imapflow`.
 *     Justified dep: imapflow — modern IMAP client with async iterator API.
 *     Only activated with `--mfa-email-imap` flag; never automatic.
 *
 * Strategies NOT automated (falls back to Tier 0):
 *   - SMS OTP: requires a real phone; no automation.
 *   - Push notification (Okta Verify, Duo Push): tool prompts user to approve.
 *   - WebAuthn / passkey: not automatable headlessly.
 */

import type { Page } from 'playwright';
import { log } from '../../logger.js';

// ---- TOTP ----

export interface TotpConfig {
  /** Base32-encoded TOTP secret (NOT the 6-digit code — the underlying secret). */
  secret: string;
  /**
   * CSS selector for the OTP input field on the MFA page.
   * Defaults to common selectors used by Okta, Duo, Google, Microsoft.
   */
  input_selector?: string;
  /**
   * CSS selector for the submit/verify button.
   * Defaults to common selectors.
   */
  submit_selector?: string;
}

const DEFAULT_OTP_INPUT = [
  'input[name="answer"]',           // Okta
  'input[name="totpCode"]',         // Duo
  'input[name="otpCode"]',
  'input[autocomplete="one-time-code"]',
  'input[type="tel"]',
  'input[placeholder*="code" i]',
].join(', ');

const DEFAULT_OTP_SUBMIT = [
  'input[type="submit"]',
  'button[type="submit"]',
  'button:has-text("Verify")',
  'button:has-text("Submit")',
].join(', ');

/**
 * Generates the current TOTP code from a shared secret and fills it into the
 * MFA input field on the given page. Lazy-loads `otplib` to avoid startup cost
 * on non-MFA flows.
 *
 * Uses the otplib v13 functional API: `generate({ secret })`.
 * The secret must be a base32-encoded string of at least 16 bytes.
 */
export async function fillTotp(page: Page, config: TotpConfig): Promise<void> {
  // Lazy import: only pay for otplib when MFA is actually needed.
  const { generate } = await import('otplib');
  const code = await generate({ secret: config.secret });
  log.info({ selector: config.input_selector ?? 'default' }, 'mfa/totp: filling OTP code');

  const inputSel = config.input_selector ?? DEFAULT_OTP_INPUT;
  const submitSel = config.submit_selector ?? DEFAULT_OTP_SUBMIT;

  await page.fill(inputSel, code);
  await page.click(submitSel);
}

// ---- Email OTP ----

export interface ImapConfig {
  /** IMAP server hostname. */
  host: string;
  /** IMAP port (typically 993 for TLS). */
  port: number;
  /** IMAP account username (email address). */
  user: string;
  /** IMAP account password (use an app-password, never the primary password). */
  password: string;
  /** Whether to use TLS (default: true). */
  tls?: boolean;
  /**
   * Per-provider regex to extract the OTP code from the email body.
   * Must have exactly one capture group containing the numeric code.
   */
  code_pattern: string;
  /** Maximum milliseconds to wait for the code email to arrive (default: 60000). */
  timeout_ms?: number;
  /** CSS selector for the OTP input field. Defaults to common selectors. */
  input_selector?: string;
  /** CSS selector for the submit button. Defaults to common selectors. */
  submit_selector?: string;
}

/**
 * Polls an IMAP inbox for a new email matching `config.code_pattern`, extracts
 * the OTP code, and fills it into the MFA input on the given page.
 *
 * Only activated via explicit `--mfa-email-imap` flag — never runs automatically.
 * `imapflow` is lazy-loaded to avoid startup cost on non-email-MFA flows.
 */
export async function fillEmailOtp(page: Page, config: ImapConfig): Promise<void> {
  const { ImapFlow } = await import('imapflow');
  const timeout = config.timeout_ms ?? 60_000;
  const codeRe = new RegExp(config.code_pattern);

  log.info({ host: config.host }, 'mfa/email-otp: connecting to IMAP');

  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.tls !== false,
    auth: { user: config.user, pass: config.password },
    logger: false, // suppress imapflow's internal logs; we use pino
  });

  await client.connect();
  let code: string | null = null;
  const deadline = Date.now() + timeout;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const imapClient: any = client;
  try {
    await imapClient.mailboxOpen('INBOX');
    while (!code && Date.now() < deadline) {
      // `seen: false` searches for unseen messages (imapflow SearchObject type)
      const uids = await imapClient.search({ seen: false }, { uid: true });
      for (const uid of (uids as number[])) {
        const msg = await imapClient.fetchOne(String(uid), { source: true }, { uid: true });
        if (!msg || !msg.source) continue;
        const body = (msg.source as Buffer).toString('utf8');
        const m = codeRe.exec(body);
        if (m?.[1]) {
          code = m[1];
          // Mark as seen so subsequent calls don't re-read the same email
          await imapClient.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
          break;
        }
      }
      if (!code) await new Promise<void>((r) => setTimeout(r, 3000));
    }
  } finally {
    await imapClient.logout();
  }

  if (!code) {
    throw new Error(`mfa/email-otp: no OTP code found within ${timeout}ms — check IMAP config and code_pattern`);
  }

  log.info({ selector: config.input_selector ?? 'default' }, 'mfa/email-otp: filling OTP code');
  const inputSel = config.input_selector ?? DEFAULT_OTP_INPUT;
  const submitSel = config.submit_selector ?? DEFAULT_OTP_SUBMIT;
  await page.fill(inputSel, code);
  await page.click(submitSel);
}

// ---- Push notification / SMS fallback ----

/**
 * Prompts the user to approve a push notification and waits up to `timeoutMs`.
 * Returns true if the page passes `successCheck` after the wait, false on timeout.
 * Does NOT automate the push — the user must approve on their device.
 */
export async function waitForPushApproval(
  page: Page,
  timeoutMs: number,
): Promise<boolean> {
  log.info({ timeoutMs }, 'mfa/push: waiting for push notification approval on your device');
  process.stderr.write(
    `[bbcrawl] ACTION REQUIRED: Approve the push notification on your device within ${Math.round(timeoutMs / 1000)}s...\n`,
  );
  await page.waitForTimeout(timeoutMs);
  // Caller is responsible for checking isAuthenticated after this returns.
  return true;
}
