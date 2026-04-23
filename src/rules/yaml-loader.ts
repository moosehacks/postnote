/**
 * YAML rule loader — phase 5.3
 * Reads `rules/*.yaml` from the project root and returns Rule objects.
 * YAML rules take precedence over code-based rules in the engine (engine
 * loads these first and skips code rules with the same id).
 *
 * Justified dep: js-yaml — the only mature YAML parser in the Node ecosystem
 * that is synchronous, has full spec coverage, and ships as a single package.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import type { Rule, RuleInput, RuleMatch } from './types.js';
import type { Severity, TaintSource, SinkName, OriginCheckClassification } from '../types.js';

/** Shape of a rule defined in YAML. */
interface YamlRuleDefinition {
  id: string;
  severity: Severity;
  title: string;
  description: string;
  remediation_hint: string;
  /**
   * Simple match block: all specified fields must match (AND logic).
   * Omitted fields are wildcards.
   */
  match: {
    event_type?: 'listener' | 'postmessage' | 'sink';
    origin_check?: OriginCheckClassification | OriginCheckClassification[];
    sink_sources?: TaintSource[];      // rule fires when ANY listed source is present
    sink_name?: SinkName | SinkName[];
    target_origin?: string;            // exact match for postmessage events
  };
}

const SEVERITIES = new Set<string>(['info', 'low', 'medium', 'high', 'critical']);
const EVENT_TYPES = new Set<string>(['listener', 'postmessage', 'sink']);

function validateDef(def: unknown, file: string): YamlRuleDefinition {
  if (typeof def !== 'object' || def === null) throw new Error(`${file}: rule must be an object`);
  const d = def as Record<string, unknown>;
  if (typeof d.id !== 'string' || !d.id) throw new Error(`${file}: rule.id must be a non-empty string`);
  if (!SEVERITIES.has(d.severity as string)) throw new Error(`${file}: rule.severity invalid: ${d.severity}`);
  if (typeof d.title !== 'string') throw new Error(`${file}: rule.title required`);
  if (typeof d.description !== 'string') throw new Error(`${file}: rule.description required`);
  if (typeof d.remediation_hint !== 'string') throw new Error(`${file}: rule.remediation_hint required`);
  if (typeof d.match !== 'object' || d.match === null) throw new Error(`${file}: rule.match required`);
  const m = d.match as Record<string, unknown>;
  if (m.event_type !== undefined && !EVENT_TYPES.has(m.event_type as string)) {
    throw new Error(`${file}: rule.match.event_type invalid: ${m.event_type}`);
  }
  return def as YamlRuleDefinition;
}

function buildRule(def: YamlRuleDefinition): Rule {
  return {
    id: def.id,
    severity: def.severity,
    title: def.title,
    description: def.description,
    match(input: RuleInput): RuleMatch | null {
      const m = def.match;

      if (m.event_type && input.eventType !== m.event_type) return null;

      if (m.origin_check !== undefined) {
        const allowed = Array.isArray(m.origin_check) ? m.origin_check : [m.origin_check];
        if (!allowed.includes(input.originCheck)) return null;
      }

      if (m.sink_name !== undefined) {
        const allowed = Array.isArray(m.sink_name) ? m.sink_name : [m.sink_name];
        if (!input.sinkName || !allowed.includes(input.sinkName)) return null;
      }

      if (m.sink_sources !== undefined && m.sink_sources.length > 0) {
        const sinkSrcs = input.sinkSources ?? [];
        const hasAny = m.sink_sources.some((s) => sinkSrcs.includes(s));
        if (!hasAny) return null;
      }

      if (m.target_origin !== undefined) {
        if (input.targetOrigin !== m.target_origin) return null;
      }

      return { matchReason: `YAML rule "${def.id}" matched`, remediationHint: def.remediation_hint };
    },
  };
}

/**
 * Loads all `*.yaml` files from `rulesDir` and returns compiled Rule objects.
 * Silently skips unparseable files after logging a warning (rule 9 — no silent
 * failures for hook install, but a bad rule file should not crash the scan).
 *
 * @param rulesDir - directory containing YAML rule files (default: `<cwd>/rules`)
 */
export function loadYamlRules(rulesDir: string): Rule[] {
  let files: string[];
  try {
    files = readdirSync(rulesDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
  } catch {
    return []; // directory absent — no YAML rules, that's fine
  }

  const rules: Rule[] = [];
  for (const file of files.sort()) {
    const full = join(rulesDir, file);
    try {
      const raw = readFileSync(full, 'utf8');
      const parsed = load(raw);
      // Support both a single rule object and an array of rules per file.
      const defs = Array.isArray(parsed) ? parsed : [parsed];
      for (const def of defs) {
        const validated = validateDef(def, file);
        rules.push(buildRule(validated));
      }
    } catch (err) {
      // Loud log — rule 9. We don't import logger here to keep this module
      // free of circular deps; write directly to stderr.
      process.stderr.write(`[bbcrawl] WARN: failed to load YAML rule ${file}: ${(err as Error).message}\n`);
    }
  }
  return rules;
}

/**
 * Merges YAML rules with code-based rules. YAML rules win on id collision.
 */
export function mergeRules(codeRules: Rule[], yamlRules: Rule[]): Rule[] {
  const yamlIds = new Set(yamlRules.map((r) => r.id));
  const filtered = codeRules.filter((r) => !yamlIds.has(r.id));
  return [...yamlRules, ...filtered];
}
