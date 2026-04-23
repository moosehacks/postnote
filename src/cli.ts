#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    version: { type: 'boolean', short: 'v' },
    help:    { type: 'boolean', short: 'h' },
    target: { type: 'string' },
    out: { type: 'string' },
    'storage-state': { type: 'string' },
    save: { type: 'string' },
    depth: { type: 'string' },
    'max-time': { type: 'string' },
    'rate-ms': { type: 'string' },
  },
  strict: true,
  allowPositionals: true,
});

const flag = values as {
  version?: boolean;
  help?: boolean;
  target?: string;
  out?: string;
  'storage-state'?: string;
  save?: string;
  depth?: string;
  'max-time'?: string;
  'rate-ms'?: string;
};

const HELP_SCAN = `\
USAGE
  bbcrawl scan --target <url> [OPTIONS]

DESCRIPTION
  Crawl a web target with a headless Chromium browser, inject the postMessage
  hook into every page, evaluate findings against the rule engine, and write
  a structured report to the output directory.

OPTIONS
  --target <url>          Required. The seed URL to crawl (must be http/https).
  --out <dir>             Output directory for this run.  Default: ./out
  --storage-state <path>  Path to a Playwright storageState JSON produced by
                          "bbcrawl auth capture".  Loads cookies/localStorage
                          so the crawl starts authenticated.
  --depth <N>             Maximum BFS depth from the seed URL.  Default: 3
  --max-time <seconds>    Hard wall-clock cap for the entire crawl.
                          Default: 300 (5 minutes)
  --rate-ms <ms>          Minimum milliseconds between page requests per origin
                          (rate-limiting / politeness delay).  Default: 500
  -h, --help              Show this help text and exit.

OUTPUT
  <out>/manifest.json     Run metadata: target, timings, counts, versions.
  <out>/findings.jsonl    One JSON object per finding, sorted by severity.
  <out>/report.md         Human-readable markdown report.
  <out>/listeners.ndjson  Raw listener capture stream.
  <out>/trace-*.zip       Playwright trace bundles (one per finding page).

EXIT CODES
  0   Scan completed (findings may or may not be present).
  1   Fatal error (bad arguments, browser crash, unhandled exception).
  2   Session expired mid-crawl (re-run auth capture, then retry).

EXAMPLES
  bbcrawl scan --target https://app.example.com --out ./runs/example
  bbcrawl scan --target https://app.example.com \\
               --storage-state ~/.bbcrawl/sessions/example.json \\
               --depth 5 --max-time 600 --out ./runs/example
`;

const HELP_AUTH_CAPTURE = `\
USAGE
  bbcrawl auth capture --target <url> --save <path>
  bbcrawl auth capture <url> --save <path>

DESCRIPTION
  Open a headed Chromium window and wait for you to log in manually.
  When you press Enter in the terminal, the browser's cookies and
  localStorage are saved as a Playwright storageState file.  Pass that
  file to "bbcrawl scan --storage-state" to crawl as the authenticated user.

  This approach handles every auth scheme: OAuth, SSO, MFA, CAPTCHA,
  WebAuthn, enterprise redirect chains — anything a human can do in a
  browser.

OPTIONS
  --target <url>    Required. The URL to open in the browser.
  --save <path>     Required. Where to write the storageState JSON.
                    Parent directories are created automatically.
                    File permissions are set to 0600 (owner-read only).
  -h, --help        Show this help text and exit.

EXAMPLES
  bbcrawl auth capture --target https://app.example.com \\
                       --save ~/.bbcrawl/sessions/example.json
  bbcrawl auth capture https://app.example.com \\
                       --save ~/.bbcrawl/sessions/example.json
`;

const HELP_INIT_DB = `\
USAGE
  bbcrawl init-db --out <dir>

DESCRIPTION
  Create (or verify) the SQLite database used to persist run state.
  The database is created at <dir>/bb.sqlite with tables:
    runs, pages, listeners, findings.

  Under normal use "bbcrawl scan" creates the database automatically.
  Use this command to pre-create it or to inspect the schema.

OPTIONS
  --out <dir>   Required. Directory that will contain bb.sqlite.
  -h, --help    Show this help text and exit.

EXAMPLES
  bbcrawl init-db --out ./out
  sqlite3 ./out/bb.sqlite '.schema'
`;

const HELP_GLOBAL = `\
bbcrawl ${pkg.version} — client-side vulnerability crawler for bug bounty automation

USAGE
  bbcrawl <command> [OPTIONS]

COMMANDS
  scan            Crawl a target and emit a findings report.
  auth capture    Capture an authenticated session via a headed browser.
  init-db         Initialise the SQLite run database.

GLOBAL OPTIONS
  -v, --version   Print version and exit.
  -h, --help      Show this help text and exit.
                  Append --help to any subcommand for its own reference:
                    bbcrawl scan --help
                    bbcrawl auth capture --help
                    bbcrawl init-db --help

QUICK START
  # 1. Capture a session (handles MFA, SSO, CAPTCHA — anything)
  bbcrawl auth capture --target https://app.example.com \\
                       --save ~/.bbcrawl/sessions/example.json

  # 2. Run an authenticated scan
  bbcrawl scan --target https://app.example.com \\
               --storage-state ~/.bbcrawl/sessions/example.json \\
               --out ./out/example

  # 3. Review the report
  cat ./out/example/report.md

DOCUMENTATION
  DESIGN.md   Full architecture, phased roadmap, and design rules.
  README.md   Install, quickstart, and auth-capture walkthrough.
`;

if (flag.version) {
  console.log(pkg.version);
  process.exit(0);
}

const [subcommand] = positionals;

// Per-subcommand --help must be checked before the global --help so that
// "bbcrawl scan --help" shows scan docs rather than the global summary.
if (flag.help) {
  if (subcommand === 'scan') {
    process.stdout.write(HELP_SCAN);
  } else if (subcommand === 'auth' && positionals[1] === 'capture') {
    process.stdout.write(HELP_AUTH_CAPTURE);
  } else if (subcommand === 'init-db') {
    process.stdout.write(HELP_INIT_DB);
  } else {
    process.stdout.write(HELP_GLOBAL);
  }
  process.exit(0);
}

if (subcommand === 'auth' && positionals[1] === 'capture') {
  const { captureSession } = await import('./auth/storage-state.js');

  const targetUrl = flag.target ?? positionals[2];
  if (!targetUrl) {
    console.error('auth capture requires --target <url> or: auth capture <url>');
    process.exit(1);
  }
  const savePath = flag.save;
  if (!savePath) {
    console.error('auth capture requires --save <path>');
    process.exit(1);
  }

  try {
    await captureSession(targetUrl, resolve(savePath));
    process.exit(0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`auth capture failed: ${msg}`);
    process.exit(1);
  }
}

if (subcommand === 'init-db') {
  const { initDb } = await import('./db.js');
  const { log } = await import('./logger.js');

  if (!flag.out) {
    console.error('init-db requires --out <dir>');
    process.exit(1);
  }
  const outDir = resolve(flag.out);
  mkdirSync(outDir, { recursive: true });
  initDb(outDir);
  log.info({ dbPath: join(outDir, 'bb.sqlite') }, 'database initialized');
  process.exit(0);
}

if (subcommand === 'scan') {
  const { log } = await import('./logger.js');
  const { crawl } = await import('./crawler/crawl.js');

  if (!flag.target) {
    console.error('scan requires --target <url>');
    process.exit(1);
  }

  const outDir = resolve(flag.out ?? './out');
  const maxDepth = flag.depth !== undefined ? parseInt(flag.depth, 10) : 3;
  const maxMs = flag['max-time'] !== undefined ? parseInt(flag['max-time'], 10) * 1000 : 5 * 60 * 1000;
  const rateMs = flag['rate-ms'] !== undefined ? parseInt(flag['rate-ms'], 10) : 500;

  if (isNaN(maxDepth) || maxDepth < 0) {
    console.error('--depth must be a non-negative integer');
    process.exit(1);
  }
  if (isNaN(maxMs) || maxMs <= 0) {
    console.error('--max-time must be a positive integer (seconds)');
    process.exit(1);
  }
  if (isNaN(rateMs) || rateMs < 0) {
    console.error('--rate-ms must be a non-negative integer');
    process.exit(1);
  }

  try {
    const { pagesVisited, findingsCount } = await crawl({
      url: flag.target,
      outDir,
      storageState: flag['storage-state'] ? resolve(flag['storage-state']) : undefined,
      maxDepth,
      maxMs,
      rateMs,
    });
    log.info({ findingsCount, pagesVisited, outDir }, 'scan complete');
    process.exit(0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`scan failed: ${msg}`);
    process.exit(1);
  }
}

if (flag.target) {
  const { loadConfig } = await import('./config.js');
  const { log } = await import('./logger.js');

  const config = loadConfig({ target: flag.target, out: flag.out, storageState: flag['storage-state'] });
  log.info(config, 'parsed config');
  process.exit(0);
}

process.stderr.write(HELP_GLOBAL);
process.exit(1);
