/**
 * Smoke test for Auth Tier 1: form-based login.
 * Spins up a tiny HTTP server that validates credentials and sets a session
 * cookie on success, then verifies formLogin() gets through it.
 */
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, rmSync } from 'node:fs';
import { chromium } from 'playwright';
import { formLogin, type AuthFormConfig } from '../../src/auth/strategies/form.js';
import { loadAuthConfig } from '../../src/auth/auth-config.js';
import { writeFileSync } from 'node:fs';

const TASK = 't5.5';
const TEST_USER = 'testuser';
const TEST_PASS = 'secret123';

/** Mini HTTP server: GET / → login form; POST /login → validate → set cookie → redirect /dashboard */
async function startLoginServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const LOGIN_HTML = `<!DOCTYPE html><html><body>
    <form method="POST" action="/login">
      <input id="username" name="username" type="text" />
      <input id="password" name="password" type="password" />
      <button id="submit" type="submit">Login</button>
    </form></body></html>`;
  const DASHBOARD_HTML = `<!DOCTYPE html><html><body>
    <div data-testid="account-menu">Logged in</div>
    </body></html>`;

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = req.url ?? '/';

      if (req.method === 'GET' && (url === '/' || url === '/login')) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(LOGIN_HTML);
        return;
      }

      if (req.method === 'GET' && url === '/dashboard') {
        res.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': 'session=valid; Path=/' });
        res.end(DASHBOARD_HTML);
        return;
      }

      if (req.method === 'POST' && url === '/login') {
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
          const params = new URLSearchParams(body);
          const user = params.get('username');
          const pass = params.get('password');
          if (user === TEST_USER && pass === TEST_PASS) {
            res.writeHead(302, {
              'Location': '/dashboard',
              'Set-Cookie': 'session=valid; Path=/',
            });
            res.end();
          } else {
            res.writeHead(401, { 'Content-Type': 'text/plain' });
            res.end('Unauthorized');
          }
        });
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res()))),
      });
    });
    server.once('error', reject);
  });
}

let loginServer: { url: string; close: () => Promise<void> } | undefined;
let browser: import('playwright').Browser | undefined;
const tmpSessionPath = join(tmpdir(), `bbcrawl-t5-5-session-${Date.now()}.json`);
const tmpAuthYaml = join(tmpdir(), `bbcrawl-t5-5-auth-${Date.now()}.yaml`);

try {
  loginServer = await startLoginServer();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  const formConfig: AuthFormConfig = {
    login_url: `${loginServer.url}/login`,
    selectors: {
      username: '#username',
      password: '#password',
      submit: '#submit',
    },
    credentials_env: ['T5_TEST_USER', 'T5_TEST_PASS'],
    success_check: {
      any_of: true,
      checks: [{ kind: 'selector', selector: '[data-testid=account-menu]' }],
    },
    timeout_ms: 3000,
  };

  // Set env vars for the test
  process.env['T5_TEST_USER'] = TEST_USER;
  process.env['T5_TEST_PASS'] = TEST_PASS;

  await formLogin(context, formConfig, tmpSessionPath);

  if (!existsSync(tmpSessionPath)) {
    throw new Error('Session file was not saved after successful form login');
  }

  // Also test the YAML config loader with a synthetic auth.yaml
  const yamlContent = `
type: form
login_url: ${loginServer.url}/login
selectors:
  username: "#username"
  password: "#password"
  submit: "#submit"
credentials_env: T5_TEST_USER, T5_TEST_PASS
success_check:
  kind: selector
  selector: "[data-testid=account-menu]"
timeout_ms: 3000
`;
  writeFileSync(tmpAuthYaml, yamlContent, 'utf8');
  const loaded = loadAuthConfig(tmpAuthYaml);
  if (loaded.type !== 'form') throw new Error(`Expected type=form from YAML, got ${loaded.type}`);
  if (loaded.config.login_url !== `${loginServer.url}/login`) {
    throw new Error(`login_url mismatch: ${loaded.config.login_url}`);
  }

  await context.close();

  console.log(`SMOKE_OK: ${TASK}`);
  process.exit(0);
} catch (e) {
  console.error(`SMOKE_FAIL: ${TASK}: ${(e as Error).message}`);
  process.exit(1);
} finally {
  await browser?.close();
  await loginServer?.close();
  try { if (existsSync(tmpSessionPath)) rmSync(tmpSessionPath); } catch { /* ignore */ }
  try { if (existsSync(tmpAuthYaml)) rmSync(tmpAuthYaml); } catch { /* ignore */ }
}
