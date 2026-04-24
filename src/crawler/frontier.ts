import { createHash } from 'node:crypto';

/**
 * Normalises a URL into a stable template string used for deduplication.
 * Two URLs are considered the same "page" if they share the same origin,
 * pathname, sorted query-key set, and route fragment.
 *
 * Fragments that look like routes (contain a '/') are preserved because
 * hash-router SPAs encode routes in the fragment (e.g. /#/settings).
 * Bare anchor fragments (#section) are dropped — they are same-page refs.
 *
 * Precondition: `raw` must be a parseable absolute URL. Callers are expected
 * to validate (e.g. via `new URL(raw)`) before enqueuing.
 */
export function normalizeUrl(raw: string): string {
  const u = new URL(raw); // throws on invalid input — caller must validate
  const sortedKeys = [...new Set([...u.searchParams.keys()].sort())].join(',');
  // Keep /#/route style fragments; drop #anchor style fragments.
  const frag = u.hash && u.hash.includes('/') ? u.hash : '';
  return `${u.origin}${u.pathname}?keys=${sortedKeys}${frag}`;
}

/**
 * Stable hash used to deduplicate frontier entries.
 * Derived from the normalised URL template only (no DOM simhash in MVP).
 */
export function stateHash(normalised: string): string {
  return createHash('sha256').update(normalised).digest('hex').slice(0, 16);
}

/**
 * BFS URL frontier with URL-template deduplication.
 *
 * - `enqueue` returns true only when the URL is newly added (not a duplicate).
 * - `dequeue` yields URLs in FIFO order.
 * - Tracks depth per URL so the crawl loop can apply a depth cap.
 */
export class Frontier {
  private readonly seen = new Set<string>();
  private readonly queue: Array<{ url: string; depth: number }> = [];

  /** Attempt to add a URL to the frontier. Returns false if it was already seen. */
  enqueue(url: string, depth: number = 0): boolean {
    const hash = stateHash(normalizeUrl(url));
    if (this.seen.has(hash)) return false;
    this.seen.add(hash);
    this.queue.push({ url, depth });
    return true;
  }

  /** Pop the next URL. Returns undefined if the frontier is empty. */
  dequeue(): { url: string; depth: number } | undefined {
    return this.queue.shift();
  }

  get size(): number {
    return this.queue.length;
  }

  get totalSeen(): number {
    return this.seen.size;
  }
}
