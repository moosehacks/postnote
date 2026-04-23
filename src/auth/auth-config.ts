/**
 * Loader for per-target auth.yaml configuration files.
 * Parses the YAML and validates the shape before returning a typed config.
 *
 * Supported strategies:
 *   type: form     — Tier 1: selector-driven form login
 *   type: manual   — Tier 0: headful capture (no automation needed)
 */

import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import type { AuthFormConfig } from './strategies/form.js';
import type { AuthConfig } from './detect.js';

export type AuthStrategy =
  | { type: 'manual' }
  | { type: 'form'; config: AuthFormConfig };

interface RawAuthYaml {
  type: string;
  login_url?: string;
  selectors?: {
    username?: string;
    password?: string;
    submit?: string;
  };
  credentials_env?: string;
  success_check?: {
    kind: string;
    selector?: string;
    pattern?: string;
    name?: string;
    expression?: string;
    timeout_ms?: number;
    checks?: Array<{ kind: string; selector?: string; pattern?: string; name?: string; expression?: string }>;
    any_of?: boolean;
  };
  timeout_ms?: number;
}

/**
 * Parses an auth.yaml file and returns a typed AuthStrategy.
 * Throws a descriptive error on validation failure — callers should halt the scan.
 */
export function loadAuthConfig(path: string): AuthStrategy {
  let raw: unknown;
  try {
    raw = load(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to load auth config at ${path}: ${(err as Error).message}`);
  }

  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`auth.yaml at ${path} must be a YAML object`);
  }

  const yaml = raw as RawAuthYaml;

  if (yaml.type === 'manual') {
    return { type: 'manual' };
  }

  if (yaml.type === 'form') {
    if (!yaml.login_url) throw new Error(`auth.yaml: login_url is required for type=form`);
    if (!yaml.selectors?.username) throw new Error(`auth.yaml: selectors.username is required`);
    if (!yaml.selectors?.password) throw new Error(`auth.yaml: selectors.password is required`);
    if (!yaml.selectors?.submit) throw new Error(`auth.yaml: selectors.submit is required`);
    if (!yaml.credentials_env) throw new Error(`auth.yaml: credentials_env is required`);

    const envParts = yaml.credentials_env.split(/[\s,]+/).filter(Boolean);
    if (envParts.length < 2) {
      throw new Error(`auth.yaml: credentials_env must list two env var names separated by comma or space`);
    }

    const successCheck = parseSuccessCheck(yaml.success_check, path);

    const config: AuthFormConfig = {
      login_url: yaml.login_url,
      selectors: {
        username: yaml.selectors.username,
        password: yaml.selectors.password,
        submit: yaml.selectors.submit,
      },
      credentials_env: [envParts[0]!, envParts[1]!],
      success_check: successCheck,
      timeout_ms: yaml.timeout_ms,
    };
    return { type: 'form', config };
  }

  throw new Error(`auth.yaml: unknown type "${yaml.type}". Supported: manual, form`);
}

function parseSuccessCheck(
  raw: RawAuthYaml['success_check'],
  path: string,
): AuthConfig {
  if (!raw) {
    throw new Error(`auth.yaml at ${path}: success_check is required for type=form`);
  }

  // Support both a single check object or a multi-check { kind: any_of, checks: [...] } wrapper
  if (raw.kind === 'any_of' && Array.isArray(raw.checks)) {
    return {
      any_of: raw.any_of !== false,
      checks: raw.checks.map((c) => parseSingleCheck(c, path)),
    };
  }

  return {
    any_of: true,
    checks: [parseSingleCheck(raw as { kind: string; selector?: string; pattern?: string; name?: string; expression?: string }, path)],
  };
}

function parseSingleCheck(
  raw: { kind: string; selector?: string; pattern?: string; name?: string; expression?: string },
  path: string,
): AuthConfig['checks'][number] {
  switch (raw.kind) {
    case 'selector':
      if (!raw.selector) throw new Error(`auth.yaml at ${path}: selector check requires selector`);
      return { kind: 'selector', selector: raw.selector };
    case 'url_not_matches':
      if (!raw.pattern) throw new Error(`auth.yaml at ${path}: url_not_matches check requires pattern`);
      return { kind: 'url_not_matches', pattern: raw.pattern };
    case 'cookie_present':
      if (!raw.name) throw new Error(`auth.yaml at ${path}: cookie_present check requires name`);
      return { kind: 'cookie_present', name: raw.name };
    case 'js':
      if (!raw.expression) throw new Error(`auth.yaml at ${path}: js check requires expression`);
      return { kind: 'js', expression: raw.expression };
    default:
      throw new Error(`auth.yaml at ${path}: unknown check kind "${raw.kind}"`);
  }
}
