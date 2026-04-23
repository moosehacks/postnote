import type { Rule } from '../types.js';

/**
 * MVP postMessage rule pack.
 * Four rules aligned with §3.4 of DESIGN.md.
 * Pure functions — no I/O, no side effects.
 */

export const pmNoOriginCheck: Rule = {
  id: 'pm-no-origin-check',
  severity: 'high',
  title: 'postMessage listener with no origin check',
  description:
    'The listener accepts messages from any origin because it does not validate event.origin.',
  match(input) {
    if (input.eventType !== 'listener') return null;
    if (input.originCheck !== 'none') return null;
    return {
      matchReason: 'origin-check classification is "none"',
      remediationHint:
        'Add a strict origin check: if (event.origin !== "https://trusted.example.com") return;',
    };
  },
};

export const pmLooseOriginCheck: Rule = {
  id: 'pm-loose-origin-check',
  severity: 'medium',
  title: 'postMessage listener with loose origin check',
  description:
    'The listener uses indexOf/startsWith/endsWith or loose equality (==) to validate event.origin, which may be bypassable.',
  match(input) {
    if (input.eventType !== 'listener') return null;
    if (!['indexOf', 'startsWith', 'endsWith', 'loose-eq'].includes(input.originCheck)) return null;
    return {
      matchReason: `origin-check classification is "${input.originCheck}"`,
      remediationHint:
        'Replace with strict equality (===) against a full, known-good origin string. Avoid substring checks.',
    };
  },
};

export const pmRegexWithoutAnchors: Rule = {
  id: 'pm-regex-without-anchors',
  severity: 'medium',
  title: 'postMessage listener uses unanchored regex for origin check',
  description:
    'The listener validates event.origin with a regex that lacks ^ or $ anchors, making it bypassable (e.g. attacker.com?trusted.com).',
  match(input) {
    if (input.eventType !== 'listener') return null;
    if (input.originCheck !== 'regex') return null;

    // Extract regex literals from the listener source and check for missing anchors.
    // Matches /pattern/flags — simple heuristic, sufficient for MVP.
    const RE_LITERAL = /\/([^/\n\\]|\\.)+\/[gimsuy]*/g;
    let m: RegExpExecArray | null;
    let anyUnanchored = false;
    while ((m = RE_LITERAL.exec(input.listenerSource)) !== null) {
      const literal = m[0];
      // Remove leading slash and trailing /flags to get the pattern body
      const body = literal.replace(/\/[gimsuy]*$/, '').slice(1);
      if (!body.startsWith('^') || !body.endsWith('$')) {
        anyUnanchored = true;
        break;
      }
    }

    if (!anyUnanchored) return null;
    return {
      matchReason: 'regex origin check lacks ^ or $ anchors',
      remediationHint:
        'Anchor the regex with ^ and $ (e.g. /^https:\\/\\/trusted\\.example\\.com$/) or switch to strict equality.',
    };
  },
};

export const pmTargetOriginWildcard: Rule = {
  id: 'pm-targetorigin-wildcard',
  severity: 'high',
  title: 'postMessage sent with wildcard targetOrigin',
  description:
    'The outbound postMessage call uses "*" as targetOrigin, allowing any origin to receive the message payload.',
  match(input) {
    if (input.eventType !== 'postmessage') return null;
    if (input.targetOrigin !== '*') return null;
    return {
      matchReason: 'targetOrigin is "*"',
      remediationHint:
        'Replace "*" with the specific receiver origin, e.g. postMessage(data, "https://trusted.example.com").',
    };
  },
};

/** Ordered rule list evaluated by the engine. */
export const POSTMESSAGE_RULES: Rule[] = [
  pmNoOriginCheck,
  pmLooseOriginCheck,
  pmRegexWithoutAnchors,
  pmTargetOriginWildcard,
];
