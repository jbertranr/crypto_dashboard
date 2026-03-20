/**
 * Error Store — registre persistent d'errors a SQLite
 * Comparteix el mateix fitxer DB que cache-store.ts (WAL mode)
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH  = path.join(DATA_DIR, "cache.db");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

declare global { var __errStoreDb: InstanceType<typeof Database> | undefined; }
const db = (global.__errStoreDb ??= new Database(DB_PATH));

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS app_errors (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    ts       INTEGER NOT NULL,
    source   TEXT    NOT NULL,
    severity TEXT    NOT NULL,
    code     TEXT    NOT NULL,
    message  TEXT    NOT NULL,
    context  TEXT
  );
  CREATE INDEX IF NOT EXISTS app_errors_ts ON app_errors (ts DESC);
`);

export type Severity = "warn" | "error" | "critical";

export interface AppError {
  id:       number;
  ts:       number;
  source:   string;
  severity: Severity;
  code:     string;
  message:  string;
  context:  Record<string, unknown> | null;
}

const stmtInsert = db.prepare(
  "INSERT INTO app_errors (ts, source, severity, code, message, context) VALUES (?, ?, ?, ?, ?, ?)"
);
const stmtRecent = db.prepare(
  "SELECT * FROM app_errors ORDER BY ts DESC LIMIT ?"
);
const stmtCountSince = db.prepare(
  "SELECT COUNT(*) as n FROM app_errors WHERE ts > ?"
);
const stmtClear = db.prepare("DELETE FROM app_errors");
const stmtPrune = db.prepare(
  "DELETE FROM app_errors WHERE id NOT IN (SELECT id FROM app_errors ORDER BY ts DESC LIMIT 500)"
);

export function recordError(
  source:   string,
  severity: Severity,
  code:     string,
  message:  string,
  context?: Record<string, unknown>
): void {
  stmtInsert.run(Date.now(), source, severity, code, message,
    context ? JSON.stringify(context) : null);
  stmtPrune.run();
  // Emetre l'error nou via SSE
  const latest = getRecentErrors(1)[0];
  if (latest) {
    import("./event-bus").then(({ eventBus }) =>
      eventBus.emitEvent({ type: "error:new", payload: latest })
    ).catch(() => {});
  }
}

export function getRecentErrors(limit = 50): AppError[] {
  const rows = stmtRecent.all(limit) as Array<{
    id: number; ts: number; source: string; severity: string;
    code: string; message: string; context: string | null;
  }>;
  return rows.map(r => ({
    ...r,
    severity: r.severity as Severity,
    context:  r.context ? (JSON.parse(r.context) as Record<string, unknown>) : null,
  }));
}

export function countErrorsSince(ts: number): number {
  const row = stmtCountSince.get(ts) as { n: number };
  return row.n;
}

export function clearErrors(): void {
  stmtClear.run();
  import("./event-bus").then(({ eventBus }) =>
    eventBus.emitEvent({ type: "error:clear" })
  ).catch(() => {});
}
