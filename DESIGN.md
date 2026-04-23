# Client-Side Vulnerability Crawler — Build Plan

> **Reference document for Claude Code.** This file is the source of truth for what we are building, how we are building it, and the rules Claude must follow. Re-read the relevant section before starting any task. Do not deviate from the scope of the current phase.

---

## 0. Rules for Claude Code

These rules apply to every task in this document. Violating them is worse than shipping slower.

1. **Simple beats clever.** If a plain function does the job, do not reach for a class, a framework, or an abstraction. Abstractions earn their place by being used in 2+ places, not by being anticipated.
2. **Read before writing.** Before editing any file, open it. Before adding a dependency, check `package.json` and explain why the existing deps cannot do the job in one sentence.
3. **One concern per file.** A file is either a crawler, a hook, a rule, a reporter, or glue — never a mix. If a file grows past ~300 lines, split it.
4. **Standard over bespoke.** Use Playwright's documented APIs. Use Node's built-in `fs/promises`, `node:crypto`, `node:path`. No utility libraries (lodash, ramda) unless a specific, justified need arises.
5. **Types are documentation.** TypeScript strict mode. No `any` without a comment explaining why. Public functions get doc comments describing inputs, outputs, and failure modes.
6. **Errors are values, not surprises.** Never `throw` across module boundaries without wrapping. Functions that can fail return `{ ok: true, value } | { ok: false, error }` or throw a single typed error class from that module.
7. **Deterministic output.** Sort findings, stable-stringify JSON, never depend on object key order. The same target on the same day should produce the same report.
8. **Smoke test after every piece.** Every task in the phase roadmap ends with a smoke test. Do not move on until the smoke test is green. See §7 for the smoke-test protocol.
9. **No silent fallbacks.** If a hook fails to install, log it loudly. If auth fails, halt the crawl and explain why. Silent degradation is the enemy of a bug-bounty tool.
10. **Commit boundaries match task boundaries.** Each numbered task in the roadmap is one commit with a message of the form `phase-N/task-M: <what>`.

**What Claude must NOT do without asking:**
- Add a new top-level dependency.
- Introduce a build step beyond `tsc`.
- Write an abstraction layer ("adapter", "factory", "registry") for something with one implementation.
- Write tests for framework code (Playwright, Node stdlib). Test our code only.
- Refactor code outside the current task's scope.

---

## 1. What we are building

A command-line vulnerability crawler for bug bounty automation. It drives Playwright-controlled Chromium against a target, injects a hook script before any page JavaScript runs, records every dangerous sink invocation and every message-style event listener, and emits structured findings.

**The three things every finding must carry:**
1. **The suspicious sink / listener** — what was registered or invoked, with the captured source code.
2. **The full URL of the JS file the code was loaded from** — resolved from the call-site stack trace, de-minified via source maps when available.
3. **The origin page URL that loaded that script** — the top-level document URL at the moment of capture.

The tool uses **Playwright driving Chromium** (not Puppeteer, not CDP-direct). This is non-negotiable because Playwright's launch fingerprint, automation-flag handling, and context isolation give the best WAF-survival posture among the headless options, and its `addInitScript` / `storageState` / `newCDPSession` APIs cover everything we need.

**Primary focus for the MVP:** vulnerable `postMessage` listeners. Everything else (DOM XSS, prototype pollution, CSTI, open redirect) is a later-phase rule pack that reuses the same pipeline.

**Inspiration:** [Zeetaz/FancyTracker](https://github.com/Zeetaz/FancyTracker) (MV3 evolution of [fransr/postMessage-tracker](https://github.com/fransr/postMessage-tracker)). We copy its **wrapper-unwinding** approach (see §3.2) — that is the technique that makes captured listener source actually useful on real-world sites. We improve on it by running headlessly, persisting output, supporting auth, and emitting machine-readable findings.

---

## 2. Stack, layout, conventions

**Runtime:** Node.js ≥ 20 LTS.
**Language:** TypeScript, strict mode.
**Browser driver:** `playwright` (Chromium only for MVP).
**Storage:** SQLite via `better-sqlite3` (single-file DB, no server, synchronous API = simple code).
**Logging:** `pino` with pretty-print in dev, JSONL in prod.
**CLI:** Node's built-in `util.parseArgs`. No `commander`/`yargs`.
**Tests:** Node's built-in `node:test` + `node:assert`. No Jest/Vitest.

**Total production dependencies target: ≤ 6.** Each addition requires a one-line justification in this file.

### Directory layout

```
.
├── PLAN.md                    # This file
├── README.md                  # User-facing quickstart
├── package.json
├── tsconfig.json
├── src/
│   ├── cli.ts                 # Entry point, arg parsing, top-level error handler
│   ├── config.ts              # Config loading + validation (zod optional, start manual)
│   ├── logger.ts              # pino instance
│   ├── db.ts                  # SQLite schema + typed queries
│   ├── types.ts               # Shared types: Finding, Listener, SinkHit, CrawlTarget
│   ├── crawler/
│   │   ├── browser.ts         # Browser launch, context creation, pool management
│   │   ├── crawl.ts           # Per-page crawl loop: navigate, settle, interact, collect
│   │   ├── interact.ts        # Safe click/scroll/form-fill heuristics
│   │   └── frontier.ts        # URL queue + dedupe (state_hash)
│   ├── hooks/
│   │   ├── prelude.ts         # Exports PRELUDE_SOURCE as a string constant
│   │   ├── prelude.js         # Raw hook code (injected into pages — no TS, no imports)
│   │   └── unwrap-patterns.ts # Wrapper-unwinding regexes/heuristics (FancyTracker-inspired)
│   ├── auth/
│   │   ├── storage-state.ts   # storageState save/load/refresh
│   │   ├── strategies/
│   │   │   ├── manual.ts      # Headful codegen flow (default, always works)
│   │   │   ├── form.ts        # Selector-driven username+password form
│   │   │   ├── oauth.ts       # OAuth redirect dance
│   │   │   └── mfa.ts         # TOTP + push-notification + email-code handling
│   │   └── detect.ts          # "Am I logged in?" heuristics
│   ├── rules/
│   │   ├── engine.ts          # Loads rules, evaluates against findings stream
│   │   ├── types.ts           # Rule type + match result types
│   │   └── packs/
│   │       ├── postmessage.ts # MVP rules live in code first; YAML lands in v1
│   │       └── dom-xss.ts
│   └── report/
│       ├── emit.ts            # Writes findings as JSONL + human-readable markdown
│       └── sourcemap.ts       # Maps minified stack frames back to original source
├── test/
│   ├── fixtures/              # Static HTML pages with known-vulnerable listeners
│   │   ├── vuln-postmessage-noorigin.html
│   │   ├── vuln-postmessage-indexof.html
│   │   ├── safe-postmessage-stricteq.html
│   │   └── wrapped-newrelic.html
│   ├── smoke/                 # One smoke test per roadmap task
│   └── unit/                  # Pure-function unit tests
└── out/                       # Run artifacts (gitignored)
    └── <run-id>/
        ├── findings.jsonl
        ├── report.md
        ├── trace.zip
        └── listeners.ndjson
```

### Naming & code conventions

- `camelCase` for variables/functions, `PascalCase` for types and classes, `kebab-case` for filenames.
- File names describe the noun they export: `frontier.ts` exports `Frontier`, `crawl.ts` exports `crawl()`.
- No default exports. Named exports only.
- `async` functions always. No callback-style APIs.
- Exhaustiveness: discriminated unions get a `never` check in the default branch of any `switch`.
- Comments explain **why**, not **what**. If you need a comment to explain what, the code is too clever.

---

## 3. Architecture

### 3.1 The pipeline

```
CLI
 └─> Config
      └─> Browser pool
           └─> For each target URL from the frontier:
                 1. Fresh BrowserContext (with storageState if auth'd)
                 2. context.addInitScript(PRELUDE_SOURCE)   <-- runs in every frame before app JS
                 3. CDP session: Runtime.addBinding("__bbReport")
                 4. page.goto(url), wait for network-idle + custom "settle" logic
                 5. Interact (safe clicks, scrolls, hashchange, force lazy chunks)
                 6. Hook data streams in via binding → collected per page
                 7. Rule engine evaluates collected data → Findings
                 8. Reporter writes findings to JSONL + markdown
                 9. Frontier enqueues same-origin URLs discovered during crawl
```

### 3.2 The hook (heart of the tool)

Lives at `src/hooks/prelude.js` as raw JS (injected as a string, must not import anything).
Exported from `src/hooks/prelude.ts` as:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const PRELUDE_SOURCE = readFileSync(join(here, 'prelude.js'), 'utf8');
```

**What the hook captures (MVP scope):**

1. Every `window.addEventListener('message', fn, ...)` registration:
   - `fn.toString()` (the source, up to a sane cap like 16 KB)
   - the attach-site stack trace (`new Error().stack`)
   - **after wrapper unwinding** — see below
   - an "origin check classification": `none | loose-eq | strict-eq | startsWith | endsWith | indexOf | regex | ref-only`

2. Every `window.postMessage(...)` outbound call (useful for finding `targetOrigin='*'` leaks).

3. `MessagePort`/`BroadcastChannel` listeners (same pattern, less common but high-value when they appear).

**Wrapper unwinding (FancyTracker's contribution):** Real-world sites wrap listeners through New Relic, Raven/Sentry, Rollbar, Bugsnag, jQuery, Zone.js, LogRocket, Honeybadger, TrackJS. The registered `fn` is the wrapper; its `.toString()` looks like `function(){try{return orig.apply(this,arguments)}catch(e){notify(e)}}` and gives no useful signal. The hook inspects the wrapper source for known telltales and walks to the real function reference (usually exposed via a closure variable, a named property on `fn`, or a call-site within the wrapper). Patterns live in `src/hooks/unwrap-patterns.ts` as a list of `{ name, detect: RegExp, extract: (fn) => Function | null }`. Start with the 5 FancyTracker covers; add more from real crawl misses.

**How data gets out:** `Runtime.addBinding('__bbReport')` on the CDP session. Inside the hook, `__bbReport(JSON.stringify(event))` fires a `Runtime.bindingCalled` event in the host. One event per registration, one per outbound `postMessage`. Keep payloads under 64 KB — truncate source strings.

**What we do NOT hook in MVP:** `innerHTML`, `eval`, `document.write`, `location.href`, storage reads, fetch/XHR responses. Those land in phase 3 with the DOM XSS rule pack. Keep the MVP hook small enough to audit by eye.

### 3.3 URL/script attribution (the "three things" requirement)

Every event emitted by the hook includes:
- `topUrl`: `location.href` at the top of the frame tree (page origin).
- `frameUrl`: `location.href` of the frame the hook is running in.
- `stack`: raw `Error().stack` string.

In the host, `report/sourcemap.ts` parses the stack, picks the deepest frame **not** inside the hook itself, and resolves:
- `scriptUrl`: the full URL of the JS file the listener was defined in (from the stack frame).
- `scriptUrlOriginal`: the original-source URL if a source map is available, via the `source-map` library (add-on dep, justify at time of add).
- `pageUrl`: from `topUrl` — the page that loaded the script.

These three fields are mandatory on every finding. If `scriptUrl` cannot be resolved, the finding is still emitted but flagged `attribution: "unresolved"` and the full stack is preserved for manual triage.

### 3.4 Rule engine (MVP: code-based, simple)

Rules live in `src/rules/packs/*.ts`. Each rule is:

```ts
export interface Rule {
  id: string;              // e.g. "pm-no-origin-check"
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  match(input: RuleInput): RuleMatch | null;
}
```

`RuleInput` contains the captured listener + its unwrapped source + classification. `match` returns `null` if no hit, otherwise a structured match including a remediation hint.

MVP rule pack (postmessage):
- `pm-no-origin-check`: origin-check classification is `none`.
- `pm-loose-origin-check`: classification is `indexOf` / `startsWith` / `endsWith` without anchoring, or `loose-eq`.
- `pm-regex-without-anchors`: regex classification where the pattern lacks `^` or `$`.
- `pm-targetorigin-wildcard`: outbound `postMessage` call with `'*'` as target origin.

YAML rule loader lands in phase 5. Do not build it in the MVP.

---

## 4. Authentication plan

**This is the hardest part. Design for flexibility; default to whatever makes the user's life easiest.**

### 4.1 Guiding principles

1. **Prefer captured sessions over automated login.** A one-time headful login that saves `storageState` works for every auth scheme ever invented, including MFA. Automated login is a speed optimization, not a correctness requirement.
2. **Detect "am I logged in?" separately from logging in.** A small `isAuthenticated(page)` predicate is reused by every strategy, by the crawler's mid-run session check, and by the refresh loop.
3. **Fail loud, fail early.** If auth breaks mid-crawl, pause the crawl, log the full context, and offer to re-auth headfully. Never silently continue crawling as anonymous.
4. **Never store plaintext credentials in the project.** Credentials come from env vars or a `--creds-file` path outside the repo. `storageState` goes to `~/.bbcrawl/sessions/<target>.json` with `chmod 600`.

### 4.2 The strategy ladder (tried in this order)

**Tier 0 — Manual capture (default, ships in MVP):**
```
bbcrawl auth capture <target-url> --save ~/.bbcrawl/sessions/acme.json
```
Opens a headful Chromium, user logs in manually (handles any auth — OAuth, SSO, MFA, CAPTCHA, WebAuthn, enterprise SSO redirect chains, whatever), presses Enter in the CLI when done. Tool saves `context.storageState()` to disk. **This alone covers 95% of targets.** Ship this first and make it rock-solid.

**Tier 1 — Form login with explicit selectors (phase 4):**
```yaml
# auth.yaml
type: form
login_url: https://app.acme.com/login
selectors:
  username: "#email"
  password: "#password"
  submit: "button[type=submit]"
credentials_env: ACME_USER, ACME_PASS
success_check:
  kind: selector
  selector: "[data-testid=account-menu]"
  timeout_ms: 10000
```
No frills. If the site has anything weirder than this, Tier 0.

**Tier 2 — OAuth / SSO automation (phase 5):**
- Detect redirect to known IdP hostnames (Okta, Auth0, Google, Microsoft, OneLogin, Ping, Keycloak).
- Per-IdP login handler. Each handler is a file in `src/auth/strategies/oauth/`, isolated so a new IdP = a new file, not a framework change.
- Success = redirect back to original origin AND `isAuthenticated()` returns true.

**Tier 3 — MFA handling (phase 5, hardest):**
- **TOTP**: user supplies a TOTP secret (not the code). We generate codes on demand with `otplib` (justified dep). Works for Okta/Duo/Google Authenticator flows.
- **Email OTP**: user supplies an IMAP config (app-password, not primary). We poll the inbox, extract the code with a per-provider regex, submit. Inbox access is gated behind explicit `--mfa-email-imap` flag; never automatic.
- **SMS OTP**: not automated. Falls back to Tier 0 interactive prompt in the headful window. Document this as a known limitation.
- **Push notification (Okta Verify, Duo Push)**: not automated. Tool displays a "approve on your device" message and waits up to N seconds. Falls back to Tier 0 if it times out.
- **WebAuthn / passkey**: not automated. Tier 0 only. Document.
- **CAPTCHA**: not automated and will not be. If a target shows a CAPTCHA, Tier 0. No third-party CAPTCHA-solving service integration — that's an abuse vector and outside bug-bounty scope.

### 4.3 Session freshness

While crawling, run `isAuthenticated(page)` every N pages (default: every 10) and on any response with `401`, `403`, or a redirect to the known login URL. On failure:
1. Acquire a process-wide lock (`SETNX`-style flag on a file).
2. The first worker to fail triggers a refresh:
   - If we have a programmatic strategy: re-run it headlessly.
   - Otherwise: pause and prompt the user to re-capture (Tier 0).
3. Other workers wait on the lock, then reload the fresh `storageState` and retry their failed request.

### 4.4 Multiple identities

A crawl can be configured with multiple identities (`--identity admin.json --identity viewer.json`). The crawler clones the frontier per identity and tags findings with `identity_id`. This surfaces access-control bugs later (a listener reachable as viewer that calls an admin API).

### 4.5 The `isAuthenticated(page)` predicate

Per-target configuration, evaluated in-page:
```yaml
success_check:
  kind: any_of
  checks:
    - { kind: selector, selector: "[data-testid=account-menu]" }
    - { kind: url_not_matches, pattern: "/login|/signin" }
    - { kind: cookie_present, name: "session" }
    - { kind: js, expression: "!!window.__APP_STATE__?.user?.id" }
```

Ship `selector`, `url_not_matches`, `cookie_present`, `js` in phase 4. `js` is powerful (evaluates in page context) and covers SPAs that don't render a stable selector until hydration.

### 4.6 Build order for auth

Phase 2 ships Tier 0 only. Every additional tier is gated on "the tier below it works flawlessly and has smoke tests." Do not skip ahead.

---

## 5. The phased roadmap

Each phase is a set of numbered tasks. Each task ends with a smoke test (see §7). Do not start task N+1 until task N is green.

### Phase 1 — Foundation (gate: `npm test` passes, CLI prints "hello")

1. **1.1** Init repo: `package.json`, `tsconfig.json` (strict), `.gitignore`, `.nvmrc`, bare `src/cli.ts` that prints version and exits 0. **Smoke:** `npx tsc && node dist/cli.js --version` prints a version.
2. **1.2** Add `playwright`, `better-sqlite3`, `pino`. Run `npx playwright install chromium`. **Smoke:** `node -e "require('playwright').chromium.launch().then(b => b.close())"` exits 0.
3. **1.3** Implement `src/logger.ts`, `src/config.ts` (reads `--target`, `--out`, `--storage-state` from argv; validates). **Smoke:** `node dist/cli.js --target https://example.com --out /tmp/out` prints a parsed config object.
4. **1.4** Implement `src/db.ts` with tables `runs`, `pages`, `listeners`, `findings`. **Smoke:** `node dist/cli.js init-db --out /tmp/out` creates a SQLite file with the expected schema (`sqlite3 /tmp/out/bb.sqlite '.schema'`).

### Phase 2 — The hook + capture, no crawling yet (gate: hook captures a listener in a fixture)

5. **2.1** Write `test/fixtures/vuln-postmessage-noorigin.html` with one `window.addEventListener('message', e => document.body.innerHTML = e.data)`. Serve it via a local static server helper in `test/smoke/_server.ts`.
6. **2.2** Write `src/hooks/prelude.js`. It wraps `EventTarget.prototype.addEventListener`, captures `type === 'message'`, computes origin-check classification via regex over `fn.toString()`, reports via `__bbReport(JSON.stringify(...))`. Keep it under 200 lines.
7. **2.3** Write `src/hooks/prelude.ts` that reads the `.js` file at module load and exports `PRELUDE_SOURCE`. **Smoke:** `import { PRELUDE_SOURCE } from './hooks/prelude.js'` and `console.log(PRELUDE_SOURCE.length)` prints a non-zero number.
8. **2.4** Write `src/crawler/browser.ts` with `launchContext({ storageState? })` returning `{ browser, context, page, cdp }`. `addInitScript(PRELUDE_SOURCE)` on the context. Enable `Runtime.addBinding` for `__bbReport` on the CDP session. Wire `Runtime.bindingCalled` to a callback. **Smoke:** point this at the fixture from 2.1, capture one listener, log it. Assert via `node:test` that exactly one listener was captured with `originCheck === 'none'`.
9. **2.5** Implement wrapper unwinding in `src/hooks/unwrap-patterns.ts` + wire into `prelude.js`. Cover the five FancyTracker patterns: jQuery, New Relic, Raven/Sentry, Rollbar, Bugsnag. **Smoke:** `test/fixtures/wrapped-newrelic.html` attaches a listener through a New Relic-shaped wrapper; we capture and unwrap to the real handler source. Assert the captured source contains the inner handler's distinctive string, not the wrapper's.
10. **2.6** Resolve stack frames to script URLs in `src/report/sourcemap.ts`. MVP: regex parse of the V8 stack format, no source-map support yet. **Smoke:** a fixture loads its listener from `/static/app.js`; the captured finding has `scriptUrl` ending in `/static/app.js` and `pageUrl` matching the fixture URL.

### Phase 3 — Minimal viable scan (gate: `bbcrawl scan <url>` produces a findings file)

11. **3.1** Implement `src/rules/packs/postmessage.ts` with the four rules from §3.4. Pure functions, no I/O. **Smoke:** unit tests for each rule with hand-crafted `RuleInput` objects.
12. **3.2** Implement `src/report/emit.ts` — writes `findings.jsonl` and a `report.md` with one section per finding (sink summary, scriptUrl, pageUrl, captured source, stack, remediation). **Smoke:** feed in two fake findings, assert file contents are stable and sorted by severity.
13. **3.3** Wire it all together in `src/cli.ts`: `bbcrawl scan --target <url> --out <dir>` → launch context → inject prelude → goto → wait settle → collect listeners → run rules → emit report. **Smoke:** scan the phase-2 fixture, assert `findings.jsonl` has ≥1 entry for `pm-no-origin-check` with the three required fields populated.

### Phase 4 — Real crawling + Tier 0 auth (gate: authenticated scan of a real demo SPA)

14. **4.1** Implement `src/crawler/frontier.ts` with `state_hash` dedupe (URL template + sorted query keys + DOM simhash). **Smoke:** enqueue 5 URLs that normalize to 2, assert only 2 are dequeued.
15. **4.2** Implement `src/crawler/interact.ts`: safe clicking (exclude logout/delete by accessible name), scrolling, firing `hashchange`/`popstate`. **Smoke:** fixture with a lazy-loaded chunk behind a button click; crawler triggers the click and captures a listener registered only in that chunk.
16. **4.3** Implement `src/crawler/crawl.ts` BFS loop with depth + time caps, same-origin restriction, per-origin rate limit (token bucket, no external dep — ~20 lines of code). **Smoke:** crawl a 3-page fixture, assert all 3 pages visited and each page's listeners captured.
17. **4.4** Implement `src/auth/storage-state.ts` + `bbcrawl auth capture <url> --save <path>` command. Opens headful, waits for user to press Enter, saves `storageState`. **Smoke:** manual — capture a session against `https://the-internet.herokuapp.com/login`, then `bbcrawl scan --storage-state <path> --target https://the-internet.herokuapp.com/secure` succeeds with auth.
18. **4.5** Implement `src/auth/detect.ts` with `selector`, `url_not_matches`, `cookie_present`, `js` checks, plus mid-crawl session freshness checking. **Smoke:** scan a protected fixture with a deliberately stale storageState; tool halts with a clear "session expired" message and exit code 2.

### Phase 5 — Expand vulnerability coverage + richer auth (gate: find a real bug on a warm-up target)

19. **5.1** Add DOM-XSS hooks to the prelude (innerHTML, eval, document.write, location.href, insertAdjacentHTML). Keep source/sink reporting strictly additive — don't break postmessage capture.
20. **5.2** Add `src/rules/packs/dom-xss.ts` with rules for hash→sink, search→sink, storage→sink, referrer→sink.
21. **5.3** YAML rule loader. `js-yaml` is the justified dep. Rules in `rules/*.yaml` take precedence over code-based rules.
22. **5.4** Source-map resolution in `src/report/sourcemap.ts` using `source-map` (justified dep, lazy-loaded only when a map is present).
23. **5.5** Auth Tier 1: form-login strategy + `auth.yaml` per-target config.
24. **5.6** Auth Tier 2: OAuth/SSO handlers for Okta, Auth0, Google, Microsoft. Each handler is its own file.
25. **5.7** Auth Tier 3: TOTP via `otplib` (justified dep). Email-OTP via IMAP (justified dep: `imapflow`).

### Phase 6 — Polish (gate: someone other than the author can run it without reading the code)

26. **6.1** Structured run manifest (`out/<run-id>/manifest.json`): target, config, identity, timings, counts, versions.
27. **6.2** Playwright `tracing.start({screenshots, snapshots, sources})` per page with a trace file saved for every finding (evidence bundle).
28. **6.3** README with install, quickstart, auth capture walkthrough, one example finding.
29. **6.4** Per-finding dedupe across runs via stable hash `(rule_id, scriptUrl_original, listener_source_hash)`. New findings vs seen findings are distinguished in the report.

---

## 6. Things we are explicitly NOT building (in this repo, for now)

Saying no is how MVPs ship. Each item below has been considered and rejected **for now**:

- **Distributed crawling, Redis, worker clusters.** One machine, one process, context pool. Revisit if we regularly exceed a 1-hour crawl.
- **Plugin manifest / permission system.** We are the only plugin authors. Rules are either code in `src/rules/packs/` or YAML in `rules/`.
- **Taint tracking (real propagation).** Proxy-based string tainting in userspace JS is a tarpit. Stack traces + captured source + rule heuristics get us 80% of findings. Project Foxhound is a future opt-in engine, not a dependency.
- **Symbolic execution of postMessage handlers (PMForce-style).** Research-grade effort for marginal recall gain. Revisit if we're finding nothing that fuzzing misses.
- **CAPTCHA solving.** Out of scope forever.
- **A web UI.** CLI + JSONL + markdown are sufficient. A UI lands when a second person uses this tool.
- **Multi-browser (Firefox, WebKit).** Chromium only. Revisit when a target only renders on Firefox.

---

## 7. Smoke testing protocol

A smoke test is a 30-seconds-or-less executable check that the piece just built actually works. It is not a unit test, not a full integration test. It is the minimum evidence that the thing does the thing.

### Rules

1. **Every roadmap task has a smoke test.** If a task ships without one, it is incomplete.
2. **Smoke tests live in `test/smoke/`** and are named after their task: `test/smoke/t2_4_hook_captures_listener.ts`.
3. **Smoke tests are executable scripts** runnable as `node --import tsx test/smoke/<name>.ts`. They print one of:
   - `SMOKE_OK: <task-id>`
   - `SMOKE_FAIL: <task-id>: <reason>`
   and exit 0 or 1 accordingly.
4. **They use real fixtures served from a local HTTP server**, not mocks. The whole point is to exercise the real pipeline.
5. **They are deterministic.** If a smoke test flakes, it is broken and must be fixed before moving on. No retry loops in smoke tests — the bug is either in the code or in the test.
6. **They clean up.** Every smoke test exits having killed its browser, closed its server, and removed its temp dir.

### The smoke-test template

```ts
// test/smoke/t2_4_hook_captures_listener.ts
import { startFixtureServer } from './_server.js';
import { launchContext } from '../../src/crawler/browser.js';

const TASK = 't2.4';
let server: { url: string; close: () => Promise<void> } | undefined;
let ctx: Awaited<ReturnType<typeof launchContext>> | undefined;

try {
  server = await startFixtureServer('vuln-postmessage-noorigin.html');
  ctx = await launchContext({});
  const listeners: unknown[] = [];
  ctx.onReport((ev) => { if (ev.t === 'listener') listeners.push(ev); });
  await ctx.page.goto(server.url);
  await ctx.page.waitForLoadState('networkidle');

  if (listeners.length !== 1) throw new Error(`expected 1 listener, got ${listeners.length}`);
  const [l] = listeners as [{ originCheck: string; scriptUrl: string; pageUrl: string }];
  if (l.originCheck !== 'none') throw new Error(`expected originCheck=none, got ${l.originCheck}`);
  if (!l.scriptUrl) throw new Error('scriptUrl missing');
  if (!l.pageUrl) throw new Error('pageUrl missing');

  console.log(`SMOKE_OK: ${TASK}`);
  process.exit(0);
} catch (e) {
  console.error(`SMOKE_FAIL: ${TASK}: ${(e as Error).message}`);
  process.exit(1);
} finally {
  await ctx?.close();
  await server?.close();
}
```

### Running all smoke tests

`npm run smoke` runs every file in `test/smoke/` sequentially and fails on the first `SMOKE_FAIL`. Output should be a clean list of `SMOKE_OK` lines per task.

### When a smoke test fails

1. Do not disable it.
2. Do not add a retry.
3. Read the output, fix the code, re-run.
4. If the smoke test itself is wrong, fix the smoke test and explain why in the commit message.

---

## 8. Definition of done for the MVP

The MVP (end of Phase 4) is done when:

1. `bbcrawl auth capture <url>` successfully saves a session against a target requiring MFA.
2. `bbcrawl scan --storage-state <session> --target <url>` crawls that target's authenticated SPA and completes without errors.
3. The produced `findings.jsonl` contains at least one entry with all three mandatory attribution fields (`scriptUrl`, `pageUrl`, listener source).
4. On a controlled vulnerable fixture, the tool detects every planted postMessage bug at 100% recall and with zero false positives against safe-listener fixtures.
5. Every smoke test in `test/smoke/` exits green in a single `npm run smoke` run.
6. A fresh machine running `git clone && npm ci && npx playwright install chromium && npm run smoke` goes green in under 10 minutes with no manual steps.

Anything beyond this is Phase 5+ and is optional work.

---

## 9. Appendix: References worth keeping open

- FancyTracker: https://github.com/Zeetaz/FancyTracker
- Frans Rosén's original: https://github.com/fransr/postMessage-tracker
- Rhynorater's postMessage braindump: https://rhynorater.github.io/postMessage-Braindump
- Playwright auth docs: https://playwright.dev/docs/auth
- Playwright `addInitScript`: https://playwright.dev/docs/api/class-browsercontext#browser-context-add-init-script
- CDP `Runtime.addBinding`: https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#method-addBinding
- `source-map` library: https://github.com/mozilla/source-map

---

*End of plan. When in doubt, re-read §0 and the current phase's section. Everything else is negotiable. §0 is not.*