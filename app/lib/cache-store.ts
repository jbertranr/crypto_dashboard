import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH  = path.join(DATA_DIR, "cache.db");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS api_cache (
    key        TEXT    PRIMARY KEY,
    data       TEXT    NOT NULL,
    fetched_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS snapshots (
    time  INTEGER PRIMARY KEY,
    value REAL NOT NULL
  );
  CREATE TABLE IF NOT EXISTS strategies (
    key      TEXT PRIMARY KEY,
    strategy TEXT NOT NULL
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS order_trailing (
    order_list_id INTEGER PRIMARY KEY,
    symbol        TEXT    NOT NULL,
    activate_at   REAL    NOT NULL,
    distance      REAL    NOT NULL,
    activate_atr  REAL    NOT NULL,
    distance_atr  REAL    NOT NULL,
    logic         TEXT    NOT NULL,
    created_at    INTEGER NOT NULL
  );
`);

// Remove entries expired more than 24h ago
db.prepare("DELETE FROM api_cache WHERE expires_at < ?").run(Date.now() - 86_400_000);

// ── Generic cache ────────────────────────────────────────────────────────────

export function cacheGet<T>(key: string): { data: T; fetchedAt: number; expiresAt: number } | null {
  const row = db.prepare(
    "SELECT data, fetched_at, expires_at FROM api_cache WHERE key = ? AND expires_at > ?"
  ).get(key, Date.now()) as { data: string; fetched_at: number; expires_at: number } | undefined;
  if (!row) return null;
  return { data: JSON.parse(row.data) as T, fetchedAt: row.fetched_at, expiresAt: row.expires_at };
}

export function cacheSet<T>(key: string, data: T, ttlSeconds: number): void {
  const now = Date.now();
  db.prepare(
    "INSERT OR REPLACE INTO api_cache (key, data, fetched_at, expires_at) VALUES (?, ?, ?, ?)"
  ).run(key, JSON.stringify(data), now, now + ttlSeconds * 1000);
}

export function cacheDelete(key: string): void {
  db.prepare("DELETE FROM api_cache WHERE key = ?").run(key);
}

export function cacheDeletePrefix(prefix: string): void {
  db.prepare("DELETE FROM api_cache WHERE key LIKE ?").run(prefix + "%");
}

// ── Snapshots ────────────────────────────────────────────────────────────────

const MAX_SNAPSHOTS = 200;

export function snapshotAdd(time: number, value: number): void {
  db.prepare("INSERT OR REPLACE INTO snapshots (time, value) VALUES (?, ?)").run(time, value);
  db.prepare(
    "DELETE FROM snapshots WHERE time NOT IN (SELECT time FROM snapshots ORDER BY time DESC LIMIT ?)"
  ).run(MAX_SNAPSHOTS);
}

export function snapshotGetAll(): Array<{ time: number; value: number }> {
  return db.prepare("SELECT time, value FROM snapshots ORDER BY time ASC").all() as Array<{
    time: number;
    value: number;
  }>;
}

// ── Strategies ───────────────────────────────────────────────────────────────

export function strategySet(key: string, strategy: string | null): void {
  if (!strategy) {
    db.prepare("DELETE FROM strategies WHERE key = ?").run(key);
  } else {
    db.prepare("INSERT OR REPLACE INTO strategies (key, strategy) VALUES (?, ?)").run(key, strategy);
  }
}

// ── Order Trailing Stops ─────────────────────────────────────────────────────

export interface TrailingRecord {
  orderListId: number;
  symbol: string;
  activateAt: number;
  distance: number;
  activateAtr: number;
  distanceAtr: number;
  logic: string;
}

export function trailingSet(orderListId: number, data: Omit<TrailingRecord, "orderListId">): void {
  db.prepare(
    "INSERT OR REPLACE INTO order_trailing (order_list_id, symbol, activate_at, distance, activate_atr, distance_atr, logic, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(orderListId, data.symbol, data.activateAt, data.distance, data.activateAtr, data.distanceAtr, data.logic, Date.now());
}

export function trailingGetAll(): TrailingRecord[] {
  const rows = db.prepare("SELECT * FROM order_trailing").all() as {
    order_list_id: number; symbol: string; activate_at: number; distance: number;
    activate_atr: number; distance_atr: number; logic: string;
  }[];
  return rows.map(r => ({
    orderListId: r.order_list_id, symbol: r.symbol,
    activateAt: r.activate_at, distance: r.distance,
    activateAtr: r.activate_atr, distanceAtr: r.distance_atr, logic: r.logic,
  }));
}

export function trailingDelete(orderListId: number): void {
  db.prepare("DELETE FROM order_trailing WHERE order_list_id = ?").run(orderListId);
}

export function strategyGetAll(): Record<string, string> {
  const rows = db.prepare("SELECT key, strategy FROM strategies").all() as Array<{
    key: string;
    strategy: string;
  }>;
  return Object.fromEntries(rows.map((r) => [r.key, r.strategy]));
}
