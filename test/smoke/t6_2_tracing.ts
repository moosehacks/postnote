import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFixtureServer } from './_server.js';
import { scan } from '../../src/scan.js';

const TASK = 't6.2';
let server: { url: string; close: () => Promise<void> } | undefined;
let outDir: string | undefined;

try {
  server = await startFixtureServer('vuln-postmessage-noorigin.html');
  outDir = mkdtempSync(join(tmpdir(), 'bbcrawl-t6-2-'));

  await scan({ url: server.url, outDir });

  const tracesDir = join(outDir, 'traces');
  if (!existsSync(tracesDir)) throw new Error('traces/ directory not created');

  const traceFiles = readdirSync(tracesDir).filter((f) => f.endsWith('.zip'));
  if (traceFiles.length === 0) {
    throw new Error('no trace file saved — expected one for the finding page');
  }
  if (traceFiles.length > 1) {
    throw new Error(`expected exactly 1 trace file, got ${traceFiles.length}`);
  }

  console.log(`SMOKE_OK: ${TASK}`);
  process.exit(0);
} catch (e) {
  console.error(`SMOKE_FAIL: ${TASK}: ${(e as Error).message}`);
  process.exit(1);
} finally {
  await server?.close();
  if (outDir) rmSync(outDir, { recursive: true, force: true });
}
