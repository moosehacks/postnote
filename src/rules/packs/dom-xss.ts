import type { Rule } from '../types.js';

/**
 * DOM-XSS rule pack (phase 5).
 * Each rule fires when a tracked taint source flowed into a dangerous DOM sink.
 * Source attribution is produced by the in-page hook's `detectSources()` function.
 */

const SINK_LABEL: Record<string, string> = {
  innerHTML: 'innerHTML',
  outerHTML: 'outerHTML',
  insertAdjacentHTML: 'insertAdjacentHTML',
  eval: 'eval()',
  'document.write': 'document.write()',
  'document.writeln': 'document.writeln()',
  'location.href': 'location.href',
};

function sinkLabel(name: string): string {
  return SINK_LABEL[name] ?? name;
}

export const domHashToSink: Rule = {
  id: 'dom-hash-to-sink',
  severity: 'high',
  title: 'DOM XSS: location.hash flows into a dangerous sink',
  description:
    'The page reads location.hash and passes the value to a dangerous DOM sink without sanitization.',
  match(input) {
    if (input.eventType !== 'sink') return null;
    if (!input.sinkSources?.includes('hash')) return null;
    return {
      matchReason: `location.hash value appeared in ${sinkLabel(input.sinkName ?? 'unknown sink')}`,
      remediationHint:
        'Sanitize location.hash before passing it to DOM sinks. Use DOMPurify or textContent instead of innerHTML.',
    };
  },
};

export const domSearchToSink: Rule = {
  id: 'dom-search-to-sink',
  severity: 'high',
  title: 'DOM XSS: URL query parameter flows into a dangerous sink',
  description:
    'The page reads a URL search parameter and passes the value to a dangerous DOM sink without sanitization.',
  match(input) {
    if (input.eventType !== 'sink') return null;
    if (!input.sinkSources?.includes('search')) return null;
    return {
      matchReason: `URL query-parameter value appeared in ${sinkLabel(input.sinkName ?? 'unknown sink')}`,
      remediationHint:
        'Sanitize URL query parameters before using them in DOM sinks. Use DOMPurify or encode output.',
    };
  },
};

export const domStorageToSink: Rule = {
  id: 'dom-storage-to-sink',
  severity: 'medium',
  title: 'DOM XSS: localStorage/sessionStorage value flows into a dangerous sink',
  description:
    'The page reads a value from localStorage or sessionStorage and passes it to a dangerous DOM sink. Storage values are attacker-controlled if an XSS exists elsewhere on the origin.',
  match(input) {
    if (input.eventType !== 'sink') return null;
    const storageSources = input.sinkSources?.filter(
      (s) => s === 'localStorage' || s === 'sessionStorage',
    );
    if (!storageSources || storageSources.length === 0) return null;
    return {
      matchReason: `${storageSources.join('/')} value appeared in ${sinkLabel(input.sinkName ?? 'unknown sink')}`,
      remediationHint:
        'Treat storage values as untrusted. Sanitize before inserting into the DOM.',
    };
  },
};

export const domReferrerToSink: Rule = {
  id: 'dom-referrer-to-sink',
  severity: 'medium',
  title: 'DOM XSS: document.referrer flows into a dangerous sink',
  description:
    'The page reads document.referrer and passes the value to a dangerous DOM sink. Referrer values are attacker-controlled via a crafted link.',
  match(input) {
    if (input.eventType !== 'sink') return null;
    if (!input.sinkSources?.includes('referrer')) return null;
    return {
      matchReason: `document.referrer value appeared in ${sinkLabel(input.sinkName ?? 'unknown sink')}`,
      remediationHint:
        'Sanitize document.referrer before using it in DOM sinks. Never trust referrer for security decisions.',
    };
  },
};

export const DOM_XSS_RULES: Rule[] = [
  domHashToSink,
  domSearchToSink,
  domStorageToSink,
  domReferrerToSink,
];
