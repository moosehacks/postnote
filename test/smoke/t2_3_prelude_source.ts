import { PRELUDE_SOURCE } from '../../src/hooks/prelude.js';

const TASK = 't2.3';

try {
  if (typeof PRELUDE_SOURCE !== 'string') throw new Error('PRELUDE_SOURCE is not a string');
  if (PRELUDE_SOURCE.length === 0) throw new Error('PRELUDE_SOURCE is empty');
  if (!PRELUDE_SOURCE.includes('addEventListener')) {
    throw new Error('PRELUDE_SOURCE missing expected hook code');
  }

  console.log(`SMOKE_OK: ${TASK} (${PRELUDE_SOURCE.length} bytes)`);
  process.exit(0);
} catch (e) {
  console.error(`SMOKE_FAIL: ${TASK}: ${(e as Error).message}`);
  process.exit(1);
}
