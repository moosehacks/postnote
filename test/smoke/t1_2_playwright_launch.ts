import { chromium, type Browser } from 'playwright';

const TASK = 't1.2';

let browser: Browser | undefined;
try {
  browser = await chromium.launch();
  await browser.close();
  browser = undefined;
  console.log(`SMOKE_OK: ${TASK}`);
  process.exit(0);
} catch (e) {
  console.error(`SMOKE_FAIL: ${TASK}: ${(e as Error).message}`);
  process.exit(1);
} finally {
  await browser?.close();
}
