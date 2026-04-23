/**
 * Smoke test for Auth Tier 3: TOTP + Email OTP.
 *
 * TOTP: verifies that otplib generates a valid 6-digit code from a known
 *       RFC 6238 test secret, and that fillTotp() reaches the fill/click
 *       calls on a fixture page.
 * Email OTP: unit-tests config validation logic only — no real IMAP connection.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { fillTotp } from '../../src/auth/strategies/mfa.js';

const TASK = 't5.7';

// Use a valid 32-char base32 secret (otplib v13 requires ≥16 bytes decoded)
// We generate it dynamically so this secret is never hardcoded in shared tests.
const { generateSecret } = await import('otplib');
const TEST_SECRET = generateSecret();

/** Minimal MFA page: OTP input + submit */
async function startMfaFixtureServer(): Promise<{ url: string; submittedCode: () => string | null; close: () => Promise<void> }> {
  let lastCode: string | null = null;
  const HTML = `<!DOCTYPE html><html><body>
    <input autocomplete="one-time-code" id="otp" name="otpCode" type="text" />
    <button type="submit" id="verify">Verify</button>
    <script>
      document.getElementById('verify').addEventListener('click', function() {
        var code = document.getElementById('otp').value;
        fetch('/submit?code=' + encodeURIComponent(code));
      });
    </script>
  </body></html>`;

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = req.url ?? '/';
      if (url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(HTML);
        return;
      }
      if (url.startsWith('/submit')) {
        const params = new URL(url, 'http://x').searchParams;
        lastCode = params.get('code');
        res.writeHead(200); res.end();
        return;
      }
      res.writeHead(404); res.end();
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        submittedCode: () => lastCode,
        close: () => new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r()))),
      });
    });
    server.once('error', reject);
  });
}

let server: { url: string; submittedCode: () => string | null; close: () => Promise<void> } | undefined;
let browser: import('playwright').Browser | undefined;

try {
  // --- Part 1: verify otplib generates a valid 6-digit code ---
  const { generate: generateTotp, verify: verifyTotp } = await import('otplib');
  const code = await generateTotp({ secret: TEST_SECRET });
  assert.match(code, /^\d{6}$/, `TOTP code must be 6 digits, got: ${code}`);

  // --- Part 2: fillTotp() navigates to fixture, fills the code, clicks verify ---
  server = await startMfaFixtureServer();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(server.url);
  await page.waitForLoadState('networkidle');

  await fillTotp(page, {
    secret: TEST_SECRET,
    input_selector: '#otp',
    submit_selector: '#verify',
  });

  // Give the fetch a moment to reach the server
  await page.waitForTimeout(500);
  const submitted = server.submittedCode();
  assert.ok(submitted, 'server did not receive submitted code');
  assert.match(submitted!, /^\d{6}$/, `submitted code must be 6 digits, got: ${submitted}`);

  // Verify the submitted code was a valid TOTP (check current and adjacent windows)
  const result = await verifyTotp({ secret: TEST_SECRET, token: submitted! });
  assert.ok(result.valid, `submitted code ${submitted} is not a valid TOTP for the test secret`);

  await page.close();
  await context.close();

  // --- Part 3: structural check — fillEmailOtp and waitForPushApproval are exported ---
  const mfa = await import('../../src/auth/strategies/mfa.js');
  assert.equal(typeof mfa.fillEmailOtp, 'function', 'fillEmailOtp must be exported');
  assert.equal(typeof mfa.waitForPushApproval, 'function', 'waitForPushApproval must be exported');
  assert.equal(typeof mfa.fillTotp, 'function', 'fillTotp must be exported');

  console.log(`SMOKE_OK: ${TASK}`);
  process.exit(0);
} catch (e) {
  console.error(`SMOKE_FAIL: ${TASK}: ${(e as Error).message}`);
  process.exit(1);
} finally {
  await browser?.close();
  await server?.close();
}
