import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadYamlRules, mergeRules } from '../../src/rules/yaml-loader.js';
import { POSTMESSAGE_RULES } from '../../src/rules/packs/postmessage.js';

const TASK = 't5.3';
const tmpDir = join(tmpdir(), `bbcrawl-t5-3-${Date.now()}`);

try {
  mkdirSync(tmpDir);

  // Write a YAML rule that overrides the code-based 'pm-no-origin-check' rule
  // (different severity) and adds a brand-new rule.
  const yamlContent = `
- id: pm-no-origin-check
  severity: critical
  title: Override title from YAML
  description: Overridden description
  remediation_hint: Overridden hint
  match:
    event_type: listener
    origin_check: none

- id: yaml-custom-sink-rule
  severity: info
  title: Custom YAML sink rule
  description: Fires on any innerHTML sink
  remediation_hint: Sanitize before inserting
  match:
    event_type: sink
    sink_name: innerHTML
`;
  writeFileSync(join(tmpDir, 'custom.yaml'), yamlContent, 'utf8');

  const yamlRules = loadYamlRules(tmpDir);
  assert.equal(yamlRules.length, 2, `expected 2 YAML rules, got ${yamlRules.length}`);

  // YAML override: pm-no-origin-check severity should now be 'critical'
  const overrideRule = yamlRules.find((r) => r.id === 'pm-no-origin-check');
  assert.ok(overrideRule, 'override rule not loaded');
  assert.equal(overrideRule.severity, 'critical', 'YAML override severity must win');

  // mergeRules: code rules with same id are suppressed
  const merged = mergeRules(POSTMESSAGE_RULES, yamlRules);
  const pmNO = merged.find((r) => r.id === 'pm-no-origin-check');
  assert.ok(pmNO, 'pm-no-origin-check missing from merged');
  assert.equal(pmNO.severity, 'critical', 'YAML rule must win in merged set');

  // The code rules that are NOT overridden must still be present
  const pmWild = merged.find((r) => r.id === 'pm-targetorigin-wildcard');
  assert.ok(pmWild, 'pm-targetorigin-wildcard missing from merged set');

  // Custom rule fires on matching input
  const customRule = yamlRules.find((r) => r.id === 'yaml-custom-sink-rule');
  assert.ok(customRule);
  const hit = customRule!.match({
    eventType: 'sink',
    originCheck: 'none',
    listenerSource: '',
    sinkName: 'innerHTML',
    sinkSources: [],
  });
  assert.ok(hit !== null, 'custom rule should fire on innerHTML sink');
  const miss = customRule!.match({
    eventType: 'sink',
    originCheck: 'none',
    listenerSource: '',
    sinkName: 'eval',
    sinkSources: [],
  });
  assert.ok(miss === null, 'custom rule should not fire on eval sink');

  // Non-existent directory returns empty array (no crash)
  const empty = loadYamlRules(join(tmpDir, 'nonexistent'));
  assert.equal(empty.length, 0, 'missing dir should return empty');

  console.log(`SMOKE_OK: ${TASK}`);
  process.exit(0);
} catch (e) {
  console.error(`SMOKE_FAIL: ${TASK}: ${(e as Error).message}`);
  process.exit(1);
} finally {
  try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
}
