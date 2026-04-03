/**
 * Persistent activity log — guarda els events dels motors a SQLite.
 * Màxim ACTIVITY_MAX registres; els més antics es purgen automàticament.
 */
import { db } from "./cache-store";

const ACTIVITY_MAX = 500;

db.exec(`
  CREATE TABLE IF NOT EXISTS activity_log (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    ts     INTEGER NOT NULL,
    motor  TEXT    NOT NULL,
    kind   TEXT    NOT NULL,
    badge  TEXT    NOT NULL,
    icon   TEXT    NOT NULL,
    qtype  TEXT    NOT NULL DEFAULT '',
    msg    TEXT    NOT NULL,
    detail TEXT
  );
  CREATE INDEX IF NOT EXISTS activity_log_ts ON activity_log(ts DESC);
`);

// Migration: add qtype column if it doesn't exist yet (upgrade from old schema)
try {
  db.exec(`ALTER TABLE activity_log ADD COLUMN qtype TEXT NOT NULL DEFAULT ''`);
} catch { /* column already exists */ }

export interface ActivityItem {
  id:      number;
  ts:      number;
  motor:   string;
  kind:    string;
  badge:   string;
  icon:    string;
  qtype:   string;
  msg:     string;
  detail?: string | null;
}

const stmtInsert = db.prepare<[number, string, string, string, string, string, string, string | null]>(`
  INSERT INTO activity_log (ts, motor, kind, badge, icon, qtype, msg, detail)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const stmtPrune = db.prepare<[number]>(`
  DELETE FROM activity_log WHERE id NOT IN (
    SELECT id FROM activity_log ORDER BY ts DESC LIMIT ?
  )
`);

const stmtRecent = db.prepare<[number]>(`
  SELECT * FROM activity_log ORDER BY ts DESC LIMIT ?
`);

export function activityPush(item: Omit<ActivityItem, "id">): void {
  stmtInsert.run(item.ts, item.motor, item.kind, item.badge, item.icon, item.qtype, item.msg, item.detail ?? null);
  stmtPrune.run(ACTIVITY_MAX);
}

export function activityGetRecent(limit = 300): ActivityItem[] {
  return stmtRecent.all(limit) as ActivityItem[];
}
