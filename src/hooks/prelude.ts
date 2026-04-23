import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/** Raw JS source injected into every page frame before application JavaScript runs. */
export const PRELUDE_SOURCE = readFileSync(join(here, 'hook.js'), 'utf8');
