import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emitReport } from '../../src/report/emit.js';
import type { Finding } from '../../src/types.js';

const TASK = 't3.2';

const tmp = mkdtempSync(join(tmpdir(), 'bbcrawl-t3_2-'));

try {
  const findingA: Finding = {
    id: 'aaa',
    ruleId: 'pm-no-origin-check',
    severity: 'high',
    title: 'postMessage listener with no origin check',
    description: 'Test description A',
    remediationHint: 'Fix A',
    scriptUrl: 'https://example.com/app.js',
    pageUrl: 'https://example.com/',
    listenerSource: 'function(e){ document.body.innerHTML = e.data; }',
    stack: 'Error\n  at https://example.com/app.js:10:5',
    attribution: 'resolved',
    capturedAt: '2026-04-22T00:00:00.000Z',
  };

  const findingB: Finding = {
    id: 'bbb',
    ruleId: 'pm-loose-origin-check',
    severity: 'medium',
    title: 'postMessage listener with loose origin check',
    description: 'Test description B',
    remediationHint: 'Fix B',
    scriptUrl: 'https://example.com/other.js',
    pageUrl: 'https://example.com/page',
    listenerSource: 'function(e){ if(event.origin.indexOf("trusted") > -1) {} }',
    stack: 'Error\n  at https://example.com/other.js:5:1',
    attribution: 'resolved',
    capturedAt: '2026-04-22T00:00:01.000Z',
  };

  // Emit in reversed severity order; result must be sorted (high before medium)
  emitReport([findingB, findingA], tmp);

  // Check JSONL
  const jsonlRaw = readFileSync(join(tmp, 'findings.jsonl'), 'utf8');
  const lines = jsonlRaw.trim().split('\n');
  assert.equal(lines.length, 2, 'should have 2 JSONL lines');

  const first = JSON.parse(lines[0]!) as Finding;
  const second = JSON.parse(lines[1]!) as Finding;

  assert.equal(first.ruleId, 'pm-no-origin-check', 'high severity should come first');
  assert.equal(second.ruleId, 'pm-loose-origin-check', 'medium severity should come second');

  // Stable: calling again with same input must produce identical files (both JSONL and markdown)
  emitReport([findingB, findingA], tmp);
  const jsonlRaw2 = readFileSync(join(tmp, 'findings.jsonl'), 'utf8');
  assert.equal(jsonlRaw, jsonlRaw2, 'JSONL output must be stable across identical calls');
  const md2 = readFileSync(join(tmp, 'report.md'), 'utf8');

  // Check markdown content
  const md = md2;
  assert.ok(md.includes('# Vulnerability Report'), 'markdown should have header');
  assert.ok(md.includes('pm-no-origin-check'), 'markdown should contain first rule id');
  assert.ok(md.includes('pm-loose-origin-check'), 'markdown should contain second rule id');
  assert.ok(md.includes('https://example.com/app.js'), 'markdown should contain scriptUrl');

  // Markdown stability: a third call must produce byte-identical output (rule 7)
  emitReport([findingB, findingA], tmp);
  const md3 = readFileSync(join(tmp, 'report.md'), 'utf8');
  assert.equal(md2, md3, 'markdown output must be stable across identical calls');

  console.log(`SMOKE_OK: ${TASK}`);
  process.exit(0);
} catch (e) {
  console.error(`SMOKE_FAIL: ${TASK}: ${(e as Error).message}`);
  process.exit(1);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
