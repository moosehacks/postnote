/**
 * Stack frame attribution for captured hook events.
 *
 * Phase 5.4 adds source-map resolution: when the resolved script URL points to
 * a minified file that has a `//# sourceMappingURL=` annotation, we fetch the
 * map and map the frame back to the original source. `source-map` is lazy-loaded
 * (dynamic import) so it only costs anything when a map is actually present.
 *
 * V8 frame formats:
 *   at FunctionName (https://host/file.js:line:col)
 *   at https://host/file.js:line:col
 */

/** Result when the stack can be resolved to a script URL. */
export interface ResolvedStack {
  scriptUrl: string;
  line: number;
  col: number;
  attribution: 'resolved';
}

/** Result when no HTTP frame could be extracted from the stack. */
export interface UnresolvedStack {
  scriptUrl: null;
  line: null;
  col: null;
  attribution: 'unresolved';
}

export type StackResolution = ResolvedStack | UnresolvedStack;

/** Original source position from a source map. */
export interface OriginalSource {
  source: string;   // original source file URL (as in the map's "sources" array)
  line: number;
  col: number;
}

// Matches the URL+line+col portion of a V8 stack frame line.
const FRAME_RE =
  /^\s+at\s+(?:[^(]+\s+\()?(https?:\/\/[^:/]+(?::\d+)?(?:\/[^:)]*)?(?:\?[^:)#]*)?(?:#[^:]*)?)(?::(\d+)(?::(\d+))?)?\)?$/;

/**
 * Parses a raw V8 stack string and returns the URL, line, and column of the
 * FIRST (innermost) non-anonymous HTTP frame.
 *
 * V8 stacks list frames from most-recent (top of call stack) to oldest.
 * The hook wrappers (addEventListener shim, innerHTML setter, etc.) always run
 * as anonymous init-script frames — they have no URL and are skipped by the
 * FRAME_RE. The first HTTP frame we encounter is therefore the specific
 * application (or library) line that invoked the sink or registered the listener,
 * which is exactly the attribution the report needs (§3.3).
 */
export function resolveStack(stack: string): StackResolution {
  for (const line of stack.split('\n')) {
    const m = FRAME_RE.exec(line);
    if (!m) continue;
    const url = m[1];
    if (url) {
      const stackLine = m[2] ? parseInt(m[2], 10) : 0;
      const col = m[3] ? parseInt(m[3], 10) : 0;
      return { scriptUrl: url, line: stackLine, col, attribution: 'resolved' };
    }
  }
  return { scriptUrl: null, line: null, col: null, attribution: 'unresolved' };
}

// In-process cache: scriptUrl → source map consumer (or null if no map found).
// Using `any` here because SourceMapConsumer's type varies between CJS/ESM builds
// and we only call `.originalPositionFor()` which is stable across versions.
/* eslint-disable @typescript-eslint/no-explicit-any */
const mapCache = new Map<string, any | null>();
const SOURCE_MAP_URL_RE = /\/\/[#@]\s*sourceMappingURL=(\S+)/;

/**
 * Fetches `scriptUrl`, looks for a `sourceMappingURL` annotation, fetches
 * and parses the source map, then resolves `line`/`col` back to the original
 * source position.
 *
 * Returns `null` if:
 * - the script has no source map annotation
 * - the map cannot be fetched / parsed
 * - `source-map` is unavailable (should never happen — it is a hard dep)
 *
 * Results are cached per scriptUrl so the same script is only fetched once
 * per process lifetime.
 */
export async function resolveOriginalSource(
  scriptUrl: string,
  line: number,
  col: number,
): Promise<OriginalSource | null> {
  try {
    let consumer = mapCache.get(scriptUrl);
    if (consumer === undefined) {
      consumer = await buildConsumer(scriptUrl);
      mapCache.set(scriptUrl, consumer);
    }
    if (!consumer) return null;
    const pos = consumer.originalPositionFor({ line, column: col });
    if (!pos.source) return null;
    return { source: pos.source, line: pos.line ?? 0, col: pos.column ?? 0 };
  } catch {
    return null;
  }
}

async function buildConsumer(scriptUrl: string): Promise<any | null> {
  // Fetch the script to extract the sourceMappingURL annotation.
  let scriptText: string;
  try {
    const resp = await fetch(scriptUrl, { signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) return null;
    scriptText = await resp.text();
  } catch {
    return null;
  }

  const m = SOURCE_MAP_URL_RE.exec(scriptText);
  if (!m) return null;

  // Resolve the map URL (may be relative or an inline data: URI).
  const rawMapUrl = m[1];
  if (!rawMapUrl) return null;
  let mapUrl: string;
  if (rawMapUrl.startsWith('data:')) {
    mapUrl = rawMapUrl;
  } else if (rawMapUrl.startsWith('http://') || rawMapUrl.startsWith('https://')) {
    mapUrl = rawMapUrl;
  } else {
    // Relative URL — resolve against the script URL
    mapUrl = new URL(rawMapUrl, scriptUrl).href;
  }

  let mapText: string;
  if (mapUrl.startsWith('data:')) {
    // Inline base64-encoded map: data:application/json;base64,<...>
    const commaIdx = mapUrl.indexOf(',');
    if (commaIdx === -1) return null;
    const encoded = mapUrl.slice(commaIdx + 1);
    mapText = Buffer.from(encoded, 'base64').toString('utf8');
  } else {
    try {
      const resp = await fetch(mapUrl, { signal: AbortSignal.timeout(10_000) });
      if (!resp.ok) return null;
      mapText = await resp.text();
    } catch {
      return null;
    }
  }

  // Lazy-load source-map only when we know a map is present.
  const sourceMap = await import('source-map');
  // SourceMapConsumer constructor accepts a raw map object.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const SourceMapConsumerCtor = sourceMap.SourceMapConsumer as any;
  const parsed = JSON.parse(mapText);
  const consumer = await new SourceMapConsumerCtor(parsed);
  return consumer;
}
