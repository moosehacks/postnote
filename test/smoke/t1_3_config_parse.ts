import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const TASK = 't1.3';
const TMP = '/tmp/bbout-t1_3';

try {
  const output = execSync(
    `node dist/cli.js --target https://example.com --out ${TMP}`,
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  );

  // pino-pretty writes to stdout; raw pino writes JSON to stdout
  const combined = output;
  if (!combined.includes('parsed config') || !combined.includes('https://example.com')) {
    throw new Error(`unexpected output: ${combined}`);
  }

  // Invalid URL should fail
  let threw = false;
  try {
    execSync(`node dist/cli.js --target not-a-url --out ${TMP}`, { stdio: 'pipe' });
  } catch {
    threw = true;
  }
  if (!threw) throw new Error('expected error for invalid URL but none thrown');

  console.log(`SMOKE_OK: ${TASK}`);
  process.exit(0);
} catch (e) {
  console.error(`SMOKE_FAIL: ${TASK}: ${(e as Error).message}`);
  process.exit(1);
} finally {
  try { rmSync(TMP, { recursive: true }); } catch { /* ignore */ }
}
