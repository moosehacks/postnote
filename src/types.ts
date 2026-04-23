/** The raw listener event emitted by the in-page hook. */
export interface ListenerEvent {
  t: 'listener';
  type: string;
  source: string;
  stack: string;
  topUrl: string;
  frameUrl: string;
  originCheck: OriginCheckClassification;
}

/** Outbound postMessage call captured by the hook. */
export interface PostMessageEvent {
  t: 'postmessage';
  targetOrigin: string;
  stack: string;
  topUrl: string;
  frameUrl: string;
}

/**
 * A dangerous DOM sink invocation captured by the hook.
 * `sources` lists which taint sources (hash, search, referrer, localStorage,
 * sessionStorage) had values that appeared in the sink value at call time.
 */
export interface SinkHitEvent {
  t: 'sink';
  sink: SinkName;
  value: string;
  stack: string;
  topUrl: string;
  frameUrl: string;
  sources: TaintSource[];
}

export type SinkName =
  | 'innerHTML'
  | 'outerHTML'
  | 'insertAdjacentHTML'
  | 'eval'
  | 'document.write'
  | 'document.writeln'
  | 'location.href';

export type TaintSource = 'hash' | 'search' | 'referrer' | 'localStorage' | 'sessionStorage';

export type HookEvent = ListenerEvent | PostMessageEvent | SinkHitEvent;

export type OriginCheckClassification =
  | 'none'
  | 'loose-eq'
  | 'strict-eq'
  | 'startsWith'
  | 'endsWith'
  | 'indexOf'
  | 'regex'
  | 'ref-only';

/** A single vulnerability finding emitted by the rule engine. */
export interface Finding {
  id: string;
  ruleId: string;
  severity: Severity;
  title: string;
  description: string;
  remediationHint: string;
  scriptUrl: string | null;
  /** De-minified source URL from the source map, if available. Used as the canonical identity key for dedup. */
  scriptUrlOriginal: string | null;
  pageUrl: string;
  listenerSource: string;
  stack: string;
  attribution: 'resolved' | 'unresolved';
  capturedAt: string;
}

export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';

/** A normalized crawl target after config validation. */
export interface CrawlTarget {
  url: string;
  out: string;
  storageState?: string;
}
