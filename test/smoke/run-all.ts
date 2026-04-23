import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));

const files = readdirSync(here)
  .filter((f) => f.startsWith('t') && f.endsWith('.ts'))
  .sort();

let failed = false;

for (const file of files) {
  const fullPath = join(here, file);
  try {
    const out = execFileSync('node', ['--import', 'tsx', fullPath], { encoding: 'utf8' });
    process.stdout.write(out);
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message: string };
    process.stdout.write(err.stdout ?? '');
    process.stderr.write(err.stderr ?? '');
    failed = true;
    break;
  }
}

process.exit(failed ? 1 : 0);
