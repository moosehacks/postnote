import type { OriginCheckClassification, Severity, SinkName, TaintSource } from '../types.js';

/** Input fed to every rule's match function. */
export interface RuleInput {
  /** Origin-check classification from the hook. */
  originCheck: OriginCheckClassification;
  /** Listener source code (post-unwrap). */
  listenerSource: string;
  /** The event type: 'listener' | 'postmessage' | 'sink'. */
  eventType: 'listener' | 'postmessage' | 'sink';
  /** For postmessage events: the targetOrigin string, if extractable. */
  targetOrigin?: string;
  /** For sink events: which sink was invoked. */
  sinkName?: SinkName;
  /** For sink events: which taint sources flowed into the sink value. */
  sinkSources?: TaintSource[];
  /** For sink events: the value passed to the sink (truncated). */
  sinkValue?: string;
}

/** A positive rule match. */
export interface RuleMatch {
  /** Short human-readable explanation of why this matched. */
  matchReason: string;
  /** Advice to include in the report. */
  remediationHint: string;
}

export interface Rule {
  id: string;
  severity: Severity;
  title: string;
  description: string;
  /** Returns null if no match; RuleMatch if the rule fires. */
  match(input: RuleInput): RuleMatch | null;
}
