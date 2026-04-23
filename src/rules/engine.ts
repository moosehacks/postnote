import { join } from 'node:path';
import type { Rule, RuleInput, RuleMatch } from './types.js';
import { POSTMESSAGE_RULES } from './packs/postmessage.js';
import { DOM_XSS_RULES } from './packs/dom-xss.js';
import { loadYamlRules, mergeRules } from './yaml-loader.js';

/** A rule firing with its parent rule metadata attached. */
export interface EngineMatch {
  ruleId: string;
  severity: Rule['severity'];
  title: string;
  description: string;
  match: RuleMatch;
}

// YAML rules are loaded once at module initialisation. They override code rules
// with the same id. The `rules/` directory is resolved from the process cwd so
// that both `bbcrawl scan` and smoke tests find the same directory.
const CODE_RULES: Rule[] = [...POSTMESSAGE_RULES, ...DOM_XSS_RULES];
const YAML_RULES: Rule[] = loadYamlRules(join(process.cwd(), 'rules'));
const RULES: Rule[] = mergeRules(CODE_RULES, YAML_RULES);

/**
 * Evaluates all loaded rules against a single RuleInput.
 * Returns every rule that fired (typically 0 or 1, but can be multiple).
 */
export function evaluate(input: RuleInput): EngineMatch[] {
  const hits: EngineMatch[] = [];
  for (const rule of RULES) {
    const m = rule.match(input);
    if (m) {
      hits.push({
        ruleId: rule.id,
        severity: rule.severity,
        title: rule.title,
        description: rule.description,
        match: m,
      });
    }
  }
  return hits;
}

/** Exposed for tests: returns the merged rule list in evaluation order. */
export function getRules(): Rule[] { return RULES; }
