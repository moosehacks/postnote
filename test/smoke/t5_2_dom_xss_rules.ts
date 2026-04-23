import assert from 'node:assert/strict';
import { domHashToSink, domSearchToSink, domStorageToSink, domReferrerToSink } from '../../src/rules/packs/dom-xss.js';
import type { RuleInput } from '../../src/rules/types.js';

const TASK = 't5.2';

try {
  function makeInput(overrides: Partial<RuleInput>): RuleInput {
    return {
      eventType: 'sink',
      originCheck: 'none',
      listenerSource: '',
      sinkName: 'innerHTML',
      sinkSources: [],
      sinkValue: 'hello',
      ...overrides,
    };
  }

  // hash→sink fires when source includes 'hash'
  assert.ok(domHashToSink.match(makeInput({ sinkSources: ['hash'] })) !== null, 'hash rule should fire');
  assert.ok(domHashToSink.match(makeInput({ sinkSources: [] })) === null, 'hash rule should not fire without hash');
  assert.ok(domHashToSink.match({ ...makeInput(), eventType: 'listener' }) === null, 'hash rule must ignore listener events');

  // search→sink
  assert.ok(domSearchToSink.match(makeInput({ sinkSources: ['search'] })) !== null, 'search rule should fire');
  assert.ok(domSearchToSink.match(makeInput({ sinkSources: ['hash'] })) === null, 'search rule should not fire on hash');

  // storage→sink
  assert.ok(domStorageToSink.match(makeInput({ sinkSources: ['localStorage'] })) !== null, 'storage rule should fire on localStorage');
  assert.ok(domStorageToSink.match(makeInput({ sinkSources: ['sessionStorage'] })) !== null, 'storage rule should fire on sessionStorage');
  assert.ok(domStorageToSink.match(makeInput({ sinkSources: [] })) === null, 'storage rule should not fire with no sources');

  // referrer→sink
  assert.ok(domReferrerToSink.match(makeInput({ sinkSources: ['referrer'] })) !== null, 'referrer rule should fire');
  assert.ok(domReferrerToSink.match(makeInput({ sinkSources: ['search'] })) === null, 'referrer rule should not fire on search');

  // Severity checks
  assert.equal(domHashToSink.severity, 'high');
  assert.equal(domSearchToSink.severity, 'high');
  assert.equal(domStorageToSink.severity, 'medium');
  assert.equal(domReferrerToSink.severity, 'medium');

  console.log(`SMOKE_OK: ${TASK}`);
  process.exit(0);
} catch (e) {
  console.error(`SMOKE_FAIL: ${TASK}: ${(e as Error).message}`);
  process.exit(1);
}
