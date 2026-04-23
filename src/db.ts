import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id          TEXT PRIMARY KEY,
  target_url  TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  status      TEXT NOT NULL DEFAULT 'running'
);

CREATE TABLE IF NOT EXISTS pages (
  id        TEXT PRIMARY KEY,
  run_id    TEXT NOT NULL REFERENCES runs(id),
  url       TEXT NOT NULL,
  depth     INTEGER NOT NULL DEFAULT 0,
  visited_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS listeners (
  id          TEXT PRIMARY KEY,
  run_id      TEXT NOT NULL REFERENCES runs(id),
  page_id     TEXT NOT NULL REFERENCES pages(id),
  event_type  TEXT NOT NULL,
  origin_check TEXT NOT NULL,
  source      TEXT NOT NULL,
  stack       TEXT NOT NULL,
  script_url  TEXT,
  page_url    TEXT NOT NULL,
  attribution TEXT NOT NULL DEFAULT 'resolved',
  captured_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS findings (
  id               TEXT PRIMARY KEY,
  run_id           TEXT NOT NULL REFERENCES runs(id),
  rule_id          TEXT NOT NULL,
  severity         TEXT NOT NULL,
  title            TEXT NOT NULL,
  description      TEXT NOT NULL,
  remediation_hint TEXT NOT NULL,
  script_url       TEXT,
  page_url         TEXT NOT NULL,
  listener_source  TEXT NOT NULL,
  stack            TEXT NOT NULL,
  attribution      TEXT NOT NULL,
  captured_at      TEXT NOT NULL
);
`;

/**
 * Creates the SQLite database file at <outDir>/bb.sqlite and applies the schema.
 * Safe to call multiple times — all tables use CREATE IF NOT EXISTS.
 */
export function initDb(outDir: string): Database.Database {
  const dbPath = join(outDir, 'bb.sqlite');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

/**
 * Opens an existing database. Throws if the file does not exist — callers must
 * run `initDb` first. Does not re-apply the schema.
 */
export function openDb(outDir: string): Database.Database {
  const dbPath = join(outDir, 'bb.sqlite');
  if (!existsSync(dbPath)) {
    throw new Error(`database not found at ${dbPath}; run 'bbcrawl init-db --out ${outDir}' first`);
  }
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}
