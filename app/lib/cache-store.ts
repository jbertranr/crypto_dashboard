import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH  = path.join(DATA_DIR, "cache.db");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(DB_PATH);
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
  CREATE TABLE IF NOT EXISTS trailing_active (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol       TEXT    NOT NULL,
    side         TEXT    NOT NULL,
    quantity     TEXT    NOT NULL,
    tp_order_id  INTEGER NOT NULL DEFAULT -1,
    sl_order_id  INTEGER NOT NULL,
    current_sl   REAL    NOT NULL,
    trail_dist   REAL    NOT NULL,
    peak_price   REAL    NOT NULL,
    tick_size    TEXT    NOT NULL,
    status       TEXT    NOT NULL DEFAULT 'active',
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
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

/* Migrate: add new columns for autonomous engine activation */
const addCol = (stmt: string) => { try { db.exec(stmt); } catch { /* already exists */ } };
addCol("ALTER TABLE order_trailing ADD COLUMN quantity   TEXT NOT NULL DEFAULT ''");
addCol("ALTER TABLE order_trailing ADD COLUMN side       TEXT NOT NULL DEFAULT 'SELL'");
addCol("ALTER TABLE order_trailing ADD COLUMN tick_size  TEXT NOT NULL DEFAULT '0.01'");
addCol("ALTER TABLE order_trailing ADD COLUMN entry_price REAL NOT NULL DEFAULT 0");
addCol("ALTER TABLE trailing_active ADD COLUMN origin_oco_list_id INTEGER");
addCol("ALTER TABLE trailing_active ADD COLUMN entry_price REAL NOT NULL DEFAULT 0");

db.exec(`
  CREATE TABLE IF NOT EXISTS order_meta (
    key        TEXT PRIMARY KEY,
    interval   TEXT,
    exit_notes TEXT
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS trade_counter (
    id    INTEGER PRIMARY KEY,
    value INTEGER NOT NULL DEFAULT 0
  );
  INSERT OR IGNORE INTO trade_counter (id, value) VALUES (1, 0);
`);

const addMetaCol = (stmt: string) => { try { db.exec(stmt); } catch { /* already exists */ } };
addMetaCol("ALTER TABLE order_meta ADD COLUMN trade_code TEXT");
addMetaCol("ALTER TABLE order_meta ADD COLUMN bot_name TEXT");

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

// 7 dies × 24h × 4 snapshots/h (cada 15 min) = 672
const MAX_SNAPSHOTS = 672;

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
  quantity: string;
  side: "SELL" | "BUY";
  tickSize: string;
  entryPrice: number;
}

export function trailingSet(orderListId: number, data: Omit<TrailingRecord, "orderListId">): void {
  db.prepare(
    `INSERT OR REPLACE INTO order_trailing
      (order_list_id, symbol, activate_at, distance, activate_atr, distance_atr, logic,
       quantity, side, tick_size, entry_price, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    orderListId, data.symbol, data.activateAt, data.distance,
    data.activateAtr, data.distanceAtr, data.logic,
    data.quantity, data.side, data.tickSize, data.entryPrice, Date.now()
  );
}

export function trailingGetAll(): TrailingRecord[] {
  const rows = db.prepare("SELECT * FROM order_trailing").all() as {
    order_list_id: number; symbol: string; activate_at: number; distance: number;
    activate_atr: number; distance_atr: number; logic: string;
    quantity: string; side: string; tick_size: string; entry_price: number;
  }[];
  return rows.map(r => ({
    orderListId: r.order_list_id, symbol: r.symbol,
    activateAt: r.activate_at, distance: r.distance,
    activateAtr: r.activate_atr, distanceAtr: r.distance_atr, logic: r.logic,
    quantity: r.quantity, side: r.side as "SELL" | "BUY",
    tickSize: r.tick_size, entryPrice: r.entry_price,
  }));
}

export function trailingDelete(orderListId: number): void {
  db.prepare("DELETE FROM order_trailing WHERE order_list_id = ?").run(orderListId);
}

// ── Active Trailing Engine records ───────────────────────────────────────────

export interface TrailingActive {
  id: number; symbol: string; side: "SELL" | "BUY"; quantity: string;
  tpOrderId: number; slOrderId: number;
  currentSl: number; trailDist: number; peakPrice: number; entryPrice: number;
  tickSize: string; status: string; createdAt: number; updatedAt: number;
  originOcoListId: number | null;
}

export function trailingActiveCreate(data: Omit<TrailingActive, "id" | "status" | "createdAt" | "updatedAt">): number {
  const now = Date.now();
  const r = db.prepare(`
    INSERT INTO trailing_active
      (symbol, side, quantity, tp_order_id, sl_order_id, current_sl, trail_dist, peak_price, entry_price, tick_size, origin_oco_list_id, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `).run(data.symbol, data.side, data.quantity, data.tpOrderId, data.slOrderId,
         data.currentSl, data.trailDist, data.peakPrice, data.entryPrice ?? 0, data.tickSize,
         data.originOcoListId ?? null, now, now);
  return r.lastInsertRowid as number;
}

function rowToActive(r: Record<string, unknown>): TrailingActive {
  return {
    id: r.id as number, symbol: r.symbol as string, side: r.side as "SELL" | "BUY",
    quantity: r.quantity as string, tpOrderId: r.tp_order_id as number,
    slOrderId: r.sl_order_id as number, currentSl: r.current_sl as number,
    trailDist: r.trail_dist as number, peakPrice: r.peak_price as number,
    entryPrice: (r.entry_price as number) ?? 0,
    tickSize: r.tick_size as string, status: r.status as string,
    createdAt: r.created_at as number, updatedAt: r.updated_at as number,
    originOcoListId: (r.origin_oco_list_id as number | null) ?? null,
  };
}

export function trailingActiveGetAll(): TrailingActive[] {
  return (db.prepare("SELECT * FROM trailing_active WHERE status = 'active'").all() as Record<string, unknown>[]).map(rowToActive);
}

export function trailingActiveGetAllIncludingDone(): TrailingActive[] {
  return (db.prepare("SELECT * FROM trailing_active ORDER BY created_at DESC LIMIT 50").all() as Record<string, unknown>[]).map(rowToActive);
}

export function trailingActiveUpdateSl(id: number, slOrderId: number, currentSl: number, peakPrice: number): void {
  db.prepare("UPDATE trailing_active SET sl_order_id=?, current_sl=?, peak_price=?, updated_at=? WHERE id=?")
    .run(slOrderId, currentSl, peakPrice, Date.now(), id);
}

export function trailingActiveSetStatus(id: number, status: string): void {
  db.prepare("UPDATE trailing_active SET status=?, updated_at=? WHERE id=?")
    .run(status, Date.now(), id);
}

export function strategyGetAll(): Record<string, string> {
  const rows = db.prepare("SELECT key, strategy FROM strategies").all() as Array<{
    key: string;
    strategy: string;
  }>;
  return Object.fromEntries(rows.map((r) => [r.key, r.strategy]));
}

// ── Order meta (interval + exit notes) ──────────────────────────────────────

export interface OrderMeta {
  interval:  string | null;
  exitNotes: string | null;
  tradeCode: string | null;
  botName:   string | null;
}

/** Atomically increment the trade counter and return a formatted code like "T-0042". */
export function nextTradeCode(): string {
  const r = db.prepare(
    "UPDATE trade_counter SET value = value + 1 WHERE id = 1 RETURNING value"
  ).get() as { value: number };
  return `T-${String(r.value).padStart(4, "0")}`;
}

export function orderMetaGet(key: string): OrderMeta | null {
  const row = db.prepare(
    "SELECT interval, exit_notes, trade_code, bot_name FROM order_meta WHERE key = ?"
  ).get(key) as { interval: string | null; exit_notes: string | null; trade_code: string | null; bot_name: string | null } | undefined;
  if (!row) return null;
  return { interval: row.interval, exitNotes: row.exit_notes, tradeCode: row.trade_code ?? null, botName: row.bot_name ?? null };
}

export function orderMetaSet(key: string, data: Partial<OrderMeta>): void {
  db.prepare(`
    INSERT INTO order_meta (key, interval, exit_notes, trade_code, bot_name)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      interval   = COALESCE(excluded.interval,   interval),
      exit_notes = COALESCE(excluded.exit_notes, exit_notes),
      trade_code = COALESCE(excluded.trade_code, trade_code),
      bot_name   = COALESCE(excluded.bot_name,   bot_name)
  `).run(key, data.interval ?? null, data.exitNotes ?? null, data.tradeCode ?? null, data.botName ?? null);
}

export function orderMetaPatchNotes(key: string, notes: string): void {
  db.prepare(`
    INSERT INTO order_meta (key, interval, exit_notes) VALUES (?, NULL, ?)
    ON CONFLICT(key) DO UPDATE SET exit_notes = excluded.exit_notes
  `).run(key, notes);
}

export function orderMetaGetAll(): Record<string, OrderMeta> {
  const rows = db.prepare("SELECT key, interval, exit_notes, trade_code, bot_name FROM order_meta").all() as Array<{
    key: string; interval: string | null; exit_notes: string | null; trade_code: string | null; bot_name: string | null;
  }>;
  return Object.fromEntries(rows.map(r => [r.key, { interval: r.interval, exitNotes: r.exit_notes, tradeCode: r.trade_code ?? null, botName: r.bot_name ?? null }]));
}
