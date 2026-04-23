import { execSync } from 'node:child_process';

const TASK = 't1.1';

try {
  execSync('npx tsc --noEmit', { stdio: 'pipe' });
  const output = execSync('node dist/cli.js --version').toString().trim();
  if (!/^\d+\.\d+\.\d+$/.test(output)) {
    throw new Error(`unexpected version output: ${output}`);
  }
  console.log(`SMOKE_OK: ${TASK}`);
  process.exit(0);
} catch (e) {
  console.error(`SMOKE_FAIL: ${TASK}: ${(e as Error).message}`);
  process.exit(1);
}
