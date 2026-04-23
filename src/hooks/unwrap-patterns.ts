/**
 * Host-side definitions of the wrapper-unwinding patterns embedded in hook.js.
 * Each pattern detects a monitoring-framework wrapper and extracts the inner function.
 * The hook.js has its own copy of this logic (no imports allowed there).
 */
export interface UnwrapPattern {
  name: string;
  /** Regex that, when matched against the wrapper's toString(), identifies the framework. */
  detect: RegExp;
  /** Attempt to extract the real handler from the wrapper function object. */
  extract: (fn: Function) => Function | null;
}

export const UNWRAP_PATTERNS: UnwrapPattern[] = [
  {
    name: 'newrelic',
    detect: /newrelic|nrWrapper|__NR_/,
    extract: (fn: Function) => {
      const f = fn as unknown as Record<string, unknown>;
      const inner = f['__NR_original'] ?? f['__nr_original'] ?? f['original'];
      return typeof inner === 'function' ? inner : null;
    },
  },
  {
    name: 'sentry',
    detect: /raven|sentry|Sentry|__sentry/i,
    extract: (fn: Function) => {
      const f = fn as unknown as Record<string, unknown>;
      const inner = f['__sentry_original__'] ?? f['__sentry_wrapped__'] ?? f['original'];
      return typeof inner === 'function' ? inner : null;
    },
  },
  {
    name: 'rollbar',
    detect: /rollbar|Rollbar/,
    extract: (fn: Function) => {
      const f = fn as unknown as Record<string, unknown>;
      const inner = f['_rollbar_original'] ?? f['original'];
      return typeof inner === 'function' ? inner : null;
    },
  },
  {
    name: 'bugsnag',
    detect: /bugsnag|Bugsnag/,
    extract: (fn: Function) => {
      const f = fn as unknown as Record<string, unknown>;
      const inner = f['_bugsnag_original'] ?? f['original'];
      return typeof inner === 'function' ? inner : null;
    },
  },
  {
    name: 'jquery',
    detect: /jQuery|\$\.event/,
    extract: (fn: Function) => {
      const f = fn as unknown as Record<string, unknown>;
      const inner = f['handler'];
      return typeof inner === 'function' && inner !== fn ? inner : null;
    },
  },
];
