import assert from 'node:assert/strict';
import { Frontier } from '../../src/crawler/frontier.js';

const TASK = 't4.1';

try {
  const f = new Frontier();

  // These five URLs collapse to 2 canonical templates:
  //   Template A: example.com/page?keys=a,b  (params a+b, values differ)
  //   Template B: example.com/other?keys=x   (different path)
  const added = [
    f.enqueue('https://example.com/page?a=1&b=2'),   // A — new
    f.enqueue('https://example.com/page?b=3&a=4'),   // A — duplicate (param order flip, same keys)
    f.enqueue('https://example.com/page?a=99&b=0'),  // A — duplicate
    f.enqueue('https://example.com/other?x=1'),      // B — new
    f.enqueue('https://example.com/other?x=2'),      // B — duplicate (same keys)
  ];

  assert.deepEqual(added, [true, false, false, true, false], 'enqueue return values wrong');
  assert.equal(f.size, 2, `queue size should be 2, got ${f.size}`);
  assert.equal(f.totalSeen, 2, `totalSeen should be 2, got ${f.totalSeen}`);

  const d1 = f.dequeue();
  const d2 = f.dequeue();
  const d3 = f.dequeue();

  assert.ok(d1, 'first dequeue should return an entry');
  assert.ok(d2, 'second dequeue should return an entry');
  assert.equal(d3, undefined, 'third dequeue should return undefined');
  assert.equal(f.size, 0);

  // Fragment is stripped — these two deduplicate
  const f2 = new Frontier();
  assert.equal(f2.enqueue('https://x.com/p#section1'), true);
  assert.equal(f2.enqueue('https://x.com/p#section2'), false, 'fragments should be ignored for dedup');

  console.log(`SMOKE_OK: ${TASK}`);
  process.exit(0);
} catch (e) {
  console.error(`SMOKE_FAIL: ${TASK}: ${(e as Error).message}`);
  process.exit(1);
}
