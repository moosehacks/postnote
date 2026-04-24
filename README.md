# bbcrawl

A command-line vulnerability crawler for bug bounty automation. It drives headless Chromium, injects a hook before any page JavaScript runs, and records every dangerous sink invocation and `postMessage` listener. Findings are written as structured JSONL and human-readable Markdown.

---

## Install

```
git clone <repo>
cd bbcrawl
npm ci
npx playwright install chromium
npm run build
```

Requires **Node.js ≥ 20 LTS**.

---

## Quickstart

**Scan a single page (no auth):**

```
node dist/cli.js scan --target https://example.com --out ./out/example
```

The `--out` directory will contain:

| File | Contents |
|---|---|
| `findings.jsonl` | One JSON finding per line, sorted by severity |
| `report.md` | Human-readable summary with source, stack, and remediation |
| `listeners.ndjson` | All captured `message` listeners (including safe ones) |
| `senders.ndjson` | All captured outbound `postMessage` calls (including safe ones) |
| `manifest.json` | Run metadata: target, timings, counts, tool version |
| `traces/<hash>.zip` | Playwright trace for every page that produced findings |

---

## Authentication

### Auth capture (recommended — works with any auth scheme)

Open a headful Chromium, log in manually, press **Enter** in the terminal when done.
The session is saved to disk and reused for subsequent scans.

```bash
# 1. Capture a session
node dist/cli.js auth capture \
  --target https://app.example.com/login \
  --save ~/.bbcrawl/sessions/example.json

# 2. Scan with the captured session
node dist/cli.js scan \
  --target https://app.example.com/dashboard \
  --storage-state ~/.bbcrawl/sessions/example.json \
  --out ./out/example-auth
```

This approach handles OAuth, SSO, MFA, CAPTCHA, WebAuthn, and anything else a browser can do — because you're the one logging in.

---

## Example finding

```json
{
  "id": "a3f9d2c1b4e5f607",
  "ruleId": "pm-no-origin-check",
  "severity": "high",
  "title": "postMessage listener with no origin check",
  "description": "A window.addEventListener('message', ...) handler was registered without checking event.origin. An attacker on any origin can send a crafted message and trigger the handler.",
  "remediationHint": "Add a strict origin check: if (event.origin !== 'https://trusted.example.com') return;",
  "scriptUrl": "https://app.example.com/static/bundle.js",
  "pageUrl": "https://app.example.com/dashboard",
  "listenerSource": "function(e){document.body.innerHTML=e.data}",
  "stack": "Error\n    at https://app.example.com/static/bundle.js:1:4200",
  "attribution": "resolved",
  "capturedAt": "2026-04-22T18:00:00.000Z"
}
```

---

## Rules

| Rule ID | Severity | Description |
|---|---|---|
| `pm-no-origin-check` | high | `message` listener with no `event.origin` check |
| `pm-loose-origin-check` | medium | Origin checked with `indexOf`, `startsWith`, or `endsWith` (bypassable) |
| `pm-regex-without-anchors` | medium | Origin validated by a regex missing `^` or `$` |
| `pm-targetorigin-wildcard` | high | `postMessage(data, '*')` leaks to any receiving origin |
| `pm-wildcard-sensitive-payload` | high | Wildcard send whose payload contains a JWT or credential key |
| `pm-wildcard-html-payload` | medium | Wildcard send whose payload contains an HTML tag (potential innerHTML XSS) |
| `dxss-hash-to-sink` | high | `location.hash` value flows into a dangerous DOM sink |
| `dxss-search-to-sink` | high | `location.search` value flows into a dangerous DOM sink |
| `dxss-storage-to-sink` | medium | `localStorage`/`sessionStorage` value flows into a dangerous sink |
| `dxss-referrer-to-sink` | medium | `document.referrer` value flows into a dangerous sink |

Custom rules can be added as YAML files — see `rules/*.yaml` (any `.yaml` files in that directory are loaded automatically).

---

## Output directory layout

```
out/<run>/
├── findings.jsonl      # machine-readable findings (one JSON per line)
├── report.md           # human-readable report
├── listeners.ndjson    # all captured listeners (including safe ones)
├── senders.ndjson      # all captured outbound postMessage calls (including safe ones)
├── manifest.json       # run metadata
└── traces/
    └── <page-hash>.zip # Playwright trace for pages with findings
```

Open a trace in the [Playwright Trace Viewer](https://trace.playwright.dev/) to replay the browser session that produced the finding.

---

## All options

```
bbcrawl scan
  --target <url>          URL to scan (required)
  --out <dir>             Output directory (default: ./out)
  --storage-state <path>  Path to a saved Playwright storageState JSON

bbcrawl auth capture
  --target <url>          URL to open in the browser (required)
  --save <path>           Where to save the storageState JSON (required)

bbcrawl init-db
  --out <dir>             Initialize a SQLite database in this directory

bbcrawl --version         Print the tool version and exit
```
