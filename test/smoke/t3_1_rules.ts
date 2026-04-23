import assert from 'node:assert/strict';
import {
  pmNoOriginCheck,
  pmLooseOriginCheck,
  pmRegexWithoutAnchors,
  pmTargetOriginWildcard,
} from '../../src/rules/packs/postmessage.js';
import type { RuleInput } from '../../src/rules/types.js';

const TASK = 't3.1';

function base(overrides: Partial<RuleInput>): RuleInput {
  return {
    eventType: 'listener',
    originCheck: 'none',
    listenerSource: 'function(e){ document.body.innerHTML = e.data; }',
    ...overrides,
  };
}

try {
  // pm-no-origin-check fires on 'none'
  assert.ok(pmNoOriginCheck.match(base({ originCheck: 'none' })) !== null, 'should fire on none');
  // does not fire on 'strict-eq'
  assert.ok(pmNoOriginCheck.match(base({ originCheck: 'strict-eq' })) === null, 'should not fire on strict-eq');
  // does not fire on postmessage events
  assert.ok(pmNoOriginCheck.match(base({ eventType: 'postmessage' })) === null, 'should not fire on postmessage event type');

  // pm-loose-origin-check fires on indexOf / startsWith / endsWith / loose-eq
  for (const oc of ['indexOf', 'startsWith', 'endsWith', 'loose-eq'] as const) {
    assert.ok(pmLooseOriginCheck.match(base({ originCheck: oc })) !== null, `should fire on ${oc}`);
  }
  assert.ok(pmLooseOriginCheck.match(base({ originCheck: 'strict-eq' })) === null, 'should not fire on strict-eq');
  assert.ok(pmLooseOriginCheck.match(base({ originCheck: 'none' })) === null, 'should not fire on none');

  // pm-regex-without-anchors fires when regex lacks anchors
  const unanchored = 'if (/trusted\\.com/.test(event.origin)) {}';
  assert.ok(
    pmRegexWithoutAnchors.match(base({ originCheck: 'regex', listenerSource: unanchored })) !== null,
    'should fire on unanchored regex',
  );
  const anchored = 'if (/^https:\\/\\/trusted\\.com$/.test(event.origin)) {}';
  assert.ok(
    pmRegexWithoutAnchors.match(base({ originCheck: 'regex', listenerSource: anchored })) === null,
    'should not fire on anchored regex',
  );
  // partial-anchor: has ^ but no $ — still bypassable, must fire
  const partialStart = 'if (/^trusted\\.com/.test(event.origin)) {}';
  assert.ok(
    pmRegexWithoutAnchors.match(base({ originCheck: 'regex', listenerSource: partialStart })) !== null,
    'should fire on regex with ^ but no $',
  );
  // partial-anchor: has $ but no ^ — still bypassable, must fire
  const partialEnd = 'if (/trusted\\.com$/.test(event.origin)) {}';
  assert.ok(
    pmRegexWithoutAnchors.match(base({ originCheck: 'regex', listenerSource: partialEnd })) !== null,
    'should fire on regex with $ but no ^',
  );
  // only fires when originCheck is 'regex'
  assert.ok(
    pmRegexWithoutAnchors.match(base({ originCheck: 'none', listenerSource: unanchored })) === null,
    'should not fire when originCheck is not regex',
  );

  // pm-targetorigin-wildcard fires on postmessage with * targetOrigin
  const pmInput = base({ eventType: 'postmessage', targetOrigin: '*' });
  assert.ok(pmTargetOriginWildcard.match(pmInput) !== null, 'should fire on wildcard targetOrigin');
  assert.ok(
    pmTargetOriginWildcard.match(base({ eventType: 'postmessage', targetOrigin: 'https://safe.com' })) === null,
    'should not fire on specific targetOrigin',
  );
  // does not fire on listener events
  assert.ok(
    pmTargetOriginWildcard.match(base({ eventType: 'listener', targetOrigin: '*' })) === null,
    'should not fire on listener event type',
  );

  console.log(`SMOKE_OK: ${TASK}`);
  process.exit(0);
} catch (e) {
  console.error(`SMOKE_FAIL: ${TASK}: ${(e as Error).message}`);
  process.exit(1);
}
