import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFixtureServer } from './_server.js';
import { scan } from '../../src/scan.js';

const TASK = 't6.1';
let server: { url: string; close: () => Promise<void> } | undefined;
let outDir: string | undefined;

try {
  server = await startFixtureServer('vuln-postmessage-noorigin.html');
  outDir = mkdtempSync(join(tmpdir(), 'bbcrawl-t6-1-'));

  await scan({ url: server.url, outDir });

  const manifestPath = join(outDir, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error('manifest.json not found');

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;

  if (typeof manifest['runId'] !== 'string' || manifest['runId'].length === 0)
    throw new Error('runId missing or empty');
  if (manifest['target'] !== server.url)
    throw new Error(`target mismatch: ${manifest['target']}`);
  if (typeof manifest['startedAt'] !== 'string')
    throw new Error('startedAt missing');
  if (typeof manifest['finishedAt'] !== 'string')
    throw new Error('finishedAt missing');
  if (typeof manifest['durationMs'] !== 'number' || manifest['durationMs'] < 0)
    throw new Error('durationMs invalid');
  if (typeof manifest['version'] !== 'string')
    throw new Error('version missing');
  if (typeof manifest['findingsTotal'] !== 'number')
    throw new Error('findingsTotal missing');
  if (typeof manifest['pagesVisited'] !== 'number')
    throw new Error('pagesVisited missing');

  console.log(`SMOKE_OK: ${TASK}`);
  process.exit(0);
} catch (e) {
  console.error(`SMOKE_FAIL: ${TASK}: ${(e as Error).message}`);
  process.exit(1);
} finally {
  await server?.close();
  if (outDir) rmSync(outDir, { recursive: true, force: true });
}
