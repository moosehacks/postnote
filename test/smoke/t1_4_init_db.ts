import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const TASK = 't1.4';
const TMP = '/tmp/bbout-t1_4';

try {
  execSync(`node dist/cli.js init-db --out ${TMP}`, { stdio: 'pipe' });

  const dbPath = join(TMP, 'bb.sqlite');
  if (!existsSync(dbPath)) throw new Error(`db file not created at ${dbPath}`);

  const schema = execSync(`sqlite3 ${dbPath} '.schema'`).toString();
  for (const table of ['runs', 'pages', 'listeners', 'findings']) {
    if (!schema.includes(`CREATE TABLE ${table}`)) {
      throw new Error(`table '${table}' missing from schema`);
    }
  }

  console.log(`SMOKE_OK: ${TASK}`);
  process.exit(0);
} catch (e) {
  console.error(`SMOKE_FAIL: ${TASK}: ${(e as Error).message}`);
  process.exit(1);
} finally {
  try { rmSync(TMP, { recursive: true }); } catch { /* ignore */ }
}
