#!/usr/bin/env node
/**
 * Comprehensive demo target runner.
 *
 * Starts a local fixture server covering every detection rule and edge case,
 * runs bbcrawl scan against it, and prints the findings report.
 *
 * Usage:
 *   node --import tsx test/demo-target.ts          # run and clean up
 *   node --import tsx test/demo-target.ts --keep   # keep output dir for inspection
 *   node --import tsx test/demo-target.ts --serve  # start server only, no crawl (Ctrl-C to stop)
 *
 * What each page tests:
 *   /demo-index.html   — navigation hub, no listener
 *   /demo-noorigin     — pm-no-origin-check (HIGH)
 *   /demo-indexof      — pm-loose-origin-check via indexOf (MEDIUM)
 *   /demo-regex        — pm-regex-without-anchors (MEDIUM)
 *   /demo-wildcard     — pm-targetorigin-wildcard (HIGH)
 *   /demo-wrapped      — Sentry-wrapped listener, wrapper unwinding
 *   /demo-lazy         — listener behind button click, tests interact.ts
 *   /demo-safe         — strict-eq origin check, zero findings expected
 */
import { startFixtureServer } from './smoke/_server.js';
import { crawl } from '../src/crawler/crawl.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const keep = process.argv.includes('--keep');
const serveOnly = process.argv.includes('--serve');

console.log('Starting demo target server...');
const server = await startFixtureServer('demo-index.html');

if (serveOnly) {
  console.log(`\nDemo target : ${server.url}`);
  console.log('Press Ctrl-C to stop.\n');
  process.on('SIGINT', async () => { await server.close(); process.exit(0); });
  // Keep the process alive.
  await new Promise(() => {});
}

const outDir = mkdtempSync(join(tmpdir(), 'bbcrawl-demo-'));

console.log(`\nDemo target : ${server.url}`);
console.log(`Output dir  : ${outDir}`);
console.log('\nRunning crawl (depth=2, no rate delay)...\n');

let exitCode = 0;
try {
  const result = await crawl({
    url: server.url,
    outDir,
    maxDepth: 2,
    maxMs: 120_000,
    rateMs: 0,
  });

  const bar = '─'.repeat(60);
  console.log(`\n${bar}`);
  console.log(`Pages visited : ${result.pagesVisited}`);
  console.log(`Findings      : ${result.findingsCount}`);
  console.log(`${bar}\n`);

  const report = readFileSync(join(outDir, 'report.md'), 'utf8');
  console.log(report);

  // Sanity checks — the demo target must trigger all four rules.
  const findingsJsonl = readFileSync(join(outDir, 'findings.jsonl'), 'utf8');
  const findings = findingsJsonl.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

  const ruleIds = new Set(findings.map((f: { ruleId: string }) => f.ruleId));
  const required = [
    'pm-no-origin-check',
    'pm-loose-origin-check',
    'pm-regex-without-anchors',
    'pm-targetorigin-wildcard',
  ];

  const missing = required.filter((id) => !ruleIds.has(id));
  if (missing.length > 0) {
    console.error(`\nSANITY FAIL: missing expected rules: ${missing.join(', ')}`);
    exitCode = 1;
  } else {
    console.log('SANITY PASS: all four rules triggered.');
  }

  if (keep) {
    console.log(`\nOutput kept at: ${outDir}`);
  }
} catch (err) {
  console.error(`\nCrawl failed: ${(err as Error).message}`);
  exitCode = 1;
} finally {
  await server.close();
  if (!keep) {
    rmSync(outDir, { recursive: true, force: true });
  }
}

process.exit(exitCode);
