// test/stealth-poc.mjs
// Proof-of-concept: compare bare headless vs playwright-extra+stealth against
// a Cloudflare Bot Management-protected site. Run with: node test/stealth-poc.mjs
import { chromium as chromiumBase } from 'playwright';
import { chromium as chromiumExtra } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromiumExtra.use(StealthPlugin());

const SESSION = '/tmp/23.json';
const TARGET  = 'https://23andme.com/';

async function probe(label, launcher, contextOpts = {}) {
  let browser;
  try {
    browser = await launcher.launch({ headless: true });
    const ctx  = await browser.newContext(contextOpts);
    const page = await ctx.newPage();
    await page.goto(TARGET, { waitUntil: 'load', timeout: 20_000 });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => ({
      finalUrl:  location.href,
      title:     document.title.slice(0, 50),
      aCount:    document.querySelectorAll('a[href]').length,
      webdriver: navigator.webdriver,
    }));
    const pass = r.aCount > 10;
    console.log(`[${pass ? 'PASS' : 'FAIL'}] ${label}`, r);
  } catch (e) {
    console.log(`[ERROR] ${label}:`, e.message.slice(0, 100));
  } finally {
    await browser?.close();
  }
}

await probe('bare           ', chromiumBase);
await probe('stealth        ', chromiumExtra);
await probe('stealth+session', chromiumExtra, { storageState: SESSION });
