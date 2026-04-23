/**
 * Smoke test for task 4.4: storage-state save/load round-trip.
 *
 * The headful capture flow (captureSession) is intentionally manual — the
 * DESIGN.md smoke note says "manual — capture a session against ... then scan".
 * This automated portion verifies the save/load plumbing works correctly so
 * the manual step can be trusted.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveStorageState, loadStorageState } from '../../src/auth/storage-state.js';

const TASK = 't4.4';
const tmpDir = mkdtempSync(join(tmpdir(), 'bbcrawl-t4_4-'));

try {
  const savePath = join(tmpDir, 'session.json');

  const state = {
    cookies: [{ name: 'session', value: 'abc123', domain: 'example.com', path: '/', httpOnly: true, secure: true, sameSite: 'Strict' as const, expires: -1 }],
    origins: [],
  };

  saveStorageState(savePath, state);
  const loaded = loadStorageState(savePath);

  assert.deepEqual(loaded, state, 'loaded storageState does not match saved state');

  // Non-existent path returns null.
  const missing = loadStorageState(join(tmpDir, 'nonexistent.json'));
  assert.equal(missing, null, 'missing file should return null');

  // File permissions: owner-read only (0o600 = 384 decimal).
  const { statSync } = await import('node:fs');
  const mode = statSync(savePath).mode & 0o777;
  assert.equal(mode, 0o600, `expected 0o600 permissions, got 0o${mode.toString(8)}`);

  console.log(`SMOKE_OK: ${TASK}`);
  process.exit(0);
} catch (e) {
  console.error(`SMOKE_FAIL: ${TASK}: ${(e as Error).message}`);
  process.exit(1);
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
