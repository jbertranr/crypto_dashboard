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
    time  INTEGER NOT NULL,
    value REAL    NOT NULL,
    mode  TEXT    NOT NULL DEFAULT 'paper',
    PRIMARY KEY (time, mode)
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
addCol("ALTER TABLE order_trailing ADD COLUMN mode TEXT NOT NULL DEFAULT 'paper'");
addCol("ALTER TABLE order_trailing ADD COLUMN break_even_atr REAL NOT NULL DEFAULT 0");
addCol("ALTER TABLE trailing_active ADD COLUMN origin_oco_list_id INTEGER");
addCol("ALTER TABLE trailing_active ADD COLUMN entry_price REAL NOT NULL DEFAULT 0");
addCol("ALTER TABLE trailing_active ADD COLUMN sl_update_count INTEGER NOT NULL DEFAULT 0");
addCol("ALTER TABLE trailing_active ADD COLUMN oco_created_at INTEGER");
addCol("ALTER TABLE trailing_active ADD COLUMN mode TEXT NOT NULL DEFAULT 'paper'");

db.exec(`
  CREATE TABLE IF NOT EXISTS trailing_sl_history (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    trailing_active_id INTEGER NOT NULL,
    symbol             TEXT    NOT NULL,
    mode               TEXT    NOT NULL DEFAULT 'paper',
    old_sl             REAL    NOT NULL,
    new_sl             REAL    NOT NULL,
    peak_price         REAL    NOT NULL,
    recorded_at        INTEGER NOT NULL
  );
`);

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
addMetaCol("ALTER TABLE order_meta ADD COLUMN entry_source TEXT");
addMetaCol("ALTER TABLE order_meta ADD COLUMN score INTEGER");

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

// Migració: afegir columna mode si no existeix (taula antiga sense mode)
{
  const cols = (db.prepare("PRAGMA table_info(snapshots)").all() as { name: string }[]).map(r => r.name);
  if (!cols.includes("mode")) {
    db.exec("ALTER TABLE snapshots ADD COLUMN mode TEXT NOT NULL DEFAULT 'paper'");
  }
}

// 7 dies × 24h × 4 snapshots/h (cada 15 min) = 672
const MAX_SNAPSHOTS = 672;

export function snapshotAdd(time: number, value: number, mode: "paper" | "real" = "paper"): void {
  db.prepare("INSERT OR REPLACE INTO snapshots (time, value, mode) VALUES (?, ?, ?)").run(time, value, mode);
  db.prepare(
    "DELETE FROM snapshots WHERE mode = ? AND time NOT IN (SELECT time FROM snapshots WHERE mode = ? ORDER BY time DESC LIMIT ?)"
  ).run(mode, mode, MAX_SNAPSHOTS);
}

export function snapshotGetAll(mode: "paper" | "real" = "paper"): Array<{ time: number; value: number }> {
  return db.prepare("SELECT time, value FROM snapshots WHERE mode = ? ORDER BY time ASC").all(mode) as Array<{
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
  breakEvenAtr: number;
  logic: string;
  quantity: string;
  side: "SELL" | "BUY";
  tickSize: string;
  entryPrice: number;
  mode: "paper" | "real";
  createdAt: number;
}

export function trailingSet(orderListId: number, data: Omit<TrailingRecord, "orderListId" | "createdAt">): void {
  db.prepare(
    `INSERT OR REPLACE INTO order_trailing
      (order_list_id, symbol, activate_at, distance, activate_atr, distance_atr, logic,
       quantity, side, tick_size, entry_price, mode, break_even_atr, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    orderListId, data.symbol, data.activateAt, data.distance,
    data.activateAtr, data.distanceAtr, data.logic,
    data.quantity, data.side, data.tickSize, data.entryPrice,
    data.mode ?? "paper", data.breakEvenAtr ?? 0, Date.now()
  );
}

export function trailingGetAll(): TrailingRecord[] {
  const rows = db.prepare("SELECT * FROM order_trailing").all() as {
    order_list_id: number; symbol: string; activate_at: number; distance: number;
    activate_atr: number; distance_atr: number; logic: string;
    quantity: string; side: string; tick_size: string; entry_price: number;
    mode: string; created_at: number; break_even_atr: number;
  }[];
  return rows.map(r => ({
    orderListId: r.order_list_id, symbol: r.symbol,
    activateAt: r.activate_at, distance: r.distance,
    activateAtr: r.activate_atr, distanceAtr: r.distance_atr, logic: r.logic,
    quantity: r.quantity, side: r.side as "SELL" | "BUY",
    tickSize: r.tick_size, entryPrice: r.entry_price,
    breakEvenAtr: r.break_even_atr ?? 0,
    mode: (r.mode === "real" ? "real" : "paper") as "paper" | "real",
    createdAt: r.created_at,
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
  slUpdateCount: number;
  ocoCreatedAt: number | null;
  mode: "paper" | "real";
}

export function trailingActiveCreate(data: Omit<TrailingActive, "id" | "status" | "createdAt" | "updatedAt" | "slUpdateCount"> & { ocoCreatedAt?: number | null }): number {
  const now = Date.now();
  const r = db.prepare(`
    INSERT INTO trailing_active
      (symbol, side, quantity, tp_order_id, sl_order_id, current_sl, trail_dist, peak_price, entry_price, tick_size, origin_oco_list_id, oco_created_at, sl_update_count, mode, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'active', ?, ?)
  `).run(data.symbol, data.side, data.quantity, data.tpOrderId, data.slOrderId,
         data.currentSl, data.trailDist, data.peakPrice, data.entryPrice ?? 0, data.tickSize,
         data.originOcoListId ?? null, data.ocoCreatedAt ?? null, data.mode ?? "paper", now, now);
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
    slUpdateCount: (r.sl_update_count as number) ?? 0,
    ocoCreatedAt: (r.oco_created_at as number | null) ?? null,
    mode: ((r.mode as string) === "real" ? "real" : "paper"),
  };
}

export function trailingActiveGetAll(): TrailingActive[] {
  return (db.prepare("SELECT * FROM trailing_active WHERE status = 'active'").all() as Record<string, unknown>[]).map(rowToActive);
}

export function trailingActiveGetAllIncludingDone(): TrailingActive[] {
  return (db.prepare("SELECT * FROM trailing_active ORDER BY created_at DESC LIMIT 50").all() as Record<string, unknown>[]).map(rowToActive);
}

export function trailingActiveUpdateSl(id: number, slOrderId: number, currentSl: number, peakPrice: number): void {
  db.prepare("UPDATE trailing_active SET sl_order_id=?, current_sl=?, peak_price=?, sl_update_count=sl_update_count+1, updated_at=? WHERE id=?")
    .run(slOrderId, currentSl, peakPrice, Date.now(), id);
}

export function trailingActiveSetStatus(id: number, status: string): void {
  db.prepare("UPDATE trailing_active SET status=?, updated_at=? WHERE id=?")
    .run(status, Date.now(), id);
}

// ── Trailing SL history ──────────────────────────────────────────────────────

export interface TrailingSlHistoryEntry {
  time:  number;
  oldSl: number;
  newSl: number;
  peak:  number;
}

export function trailingSlHistoryAdd(entry: {
  trailingActiveId: number;
  symbol:           string;
  mode:             string;
  oldSl:            number;
  newSl:            number;
  peakPrice:        number;
}): void {
  db.prepare(
    "INSERT INTO trailing_sl_history (trailing_active_id, symbol, mode, old_sl, new_sl, peak_price, recorded_at) VALUES (?,?,?,?,?,?,?)"
  ).run(entry.trailingActiveId, entry.symbol, entry.mode, entry.oldSl, entry.newSl, entry.peakPrice, Date.now());
}

export function trailingSlHistoryGet(trailingActiveId: number): TrailingSlHistoryEntry[] {
  return db.prepare(
    "SELECT recorded_at AS time, old_sl AS oldSl, new_sl AS newSl, peak_price AS peak FROM trailing_sl_history WHERE trailing_active_id=? ORDER BY recorded_at ASC"
  ).all(trailingActiveId) as TrailingSlHistoryEntry[];
}

export function trailingSlHistoryGetBySymbol(symbol: string, fromMs: number, toMs: number): TrailingSlHistoryEntry[] {
  return db.prepare(
    "SELECT recorded_at AS time, old_sl AS oldSl, new_sl AS newSl, peak_price AS peak FROM trailing_sl_history WHERE symbol=? AND recorded_at >= ? AND recorded_at <= ? ORDER BY recorded_at ASC"
  ).all(symbol, fromMs, toMs) as TrailingSlHistoryEntry[];
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
  interval:    string | null;
  exitNotes:   string | null;
  tradeCode:   string | null;
  botName:     string | null;
  entrySource: "AUTO" | "MANUAL" | null;  // AUTO = bot placed order, MANUAL = user placed order
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
    "SELECT interval, exit_notes, trade_code, bot_name, entry_source FROM order_meta WHERE key = ?"
  ).get(key) as { interval: string | null; exit_notes: string | null; trade_code: string | null; bot_name: string | null; entry_source: string | null } | undefined;
  if (!row) return null;
  return { interval: row.interval, exitNotes: row.exit_notes, tradeCode: row.trade_code ?? null, botName: row.bot_name ?? null, entrySource: (row.entry_source as "AUTO" | "MANUAL" | null) ?? null };
}

export function orderMetaSet(key: string, data: Partial<OrderMeta>): void {
  db.prepare(`
    INSERT INTO order_meta (key, interval, exit_notes, trade_code, bot_name, entry_source)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      interval     = COALESCE(excluded.interval,     interval),
      exit_notes   = COALESCE(excluded.exit_notes,   exit_notes),
      trade_code   = COALESCE(excluded.trade_code,   trade_code),
      bot_name     = COALESCE(excluded.bot_name,     bot_name),
      entry_source = COALESCE(excluded.entry_source, entry_source)
  `).run(key, data.interval ?? null, data.exitNotes ?? null, data.tradeCode ?? null, data.botName ?? null, data.entrySource ?? null);
}

export function orderMetaPatchNotes(key: string, notes: string): void {
  db.prepare(`
    INSERT INTO order_meta (key, interval, exit_notes) VALUES (?, NULL, ?)
    ON CONFLICT(key) DO UPDATE SET exit_notes = excluded.exit_notes
  `).run(key, notes);
}

/** Retorna el conjunt de claus d'order_meta associades a un bot concret (ex: "oco:123456"). */
export function orderMetaKeysByBot(botName: string): Set<string> {
  const rows = db.prepare("SELECT key FROM order_meta WHERE bot_name = ?").all(botName) as { key: string }[];
  return new Set(rows.map(r => r.key));
}

export function orderMetaGetAll(): Record<string, OrderMeta> {
  const rows = db.prepare("SELECT key, interval, exit_notes, trade_code, bot_name, entry_source FROM order_meta").all() as Array<{
    key: string; interval: string | null; exit_notes: string | null; trade_code: string | null; bot_name: string | null; entry_source: string | null;
  }>;
  return Object.fromEntries(rows.map(r => [r.key, { interval: r.interval, exitNotes: r.exit_notes, tradeCode: r.trade_code ?? null, botName: r.bot_name ?? null, entrySource: (r.entry_source as "AUTO" | "MANUAL" | null) ?? null }]));
}

/* ── Pending OCO (compra sense OCO col·locada) ───────────────── */

db.exec(`
  CREATE TABLE IF NOT EXISTS pending_oco (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol          TEXT    NOT NULL,
    oco_qty         TEXT    NOT NULL,
    tp_price        TEXT    NOT NULL,
    sl_stop_price   TEXT    NOT NULL,
    sl_limit_price  TEXT    NOT NULL,
    fill_price      REAL    NOT NULL,
    trail_act_at    REAL    NOT NULL,
    trail_dist      REAL    NOT NULL,
    trail_mode      TEXT    NOT NULL,
    tick_size       TEXT    NOT NULL,
    bot_name        TEXT    NOT NULL,
    interval_tf     TEXT    NOT NULL,
    score           INTEGER NOT NULL,
    quote_qty       REAL    NOT NULL,
    atr             REAL    NOT NULL,
    buy_order_id    INTEGER,
    journal_id      INTEGER NOT NULL,
    trade_code      TEXT,
    attempts        INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL
  );
`);

// ── Schema migration — add mode column to pending_oco ─────────────────────
{
  const cols = (db.prepare("PRAGMA table_info(pending_oco)").all() as { name: string }[]).map(r => r.name);
  if (!cols.includes("mode")) db.exec("ALTER TABLE pending_oco ADD COLUMN mode TEXT NOT NULL DEFAULT 'paper'");
}

export interface PendingOco {
  id:           number;
  symbol:       string;
  ocoQty:       string;
  tpPrice:      string;
  slStopPrice:  string;
  slLimitPrice: string;
  fillPrice:    number;
  trailActAt:   number;
  trailDist:    number;
  trailMode:    string;
  tickSize:     string;
  botName:      string;
  intervalTf:   string;
  score:        number;
  quoteQty:     number;
  atr:          number;
  buyOrderId:   number | null;
  journalId:    number;
  tradeCode:    string | null;
  mode:         string;
  attempts:     number;
  createdAt:    number;
}

export function pendingOcoSave(p: Omit<PendingOco, "id" | "attempts" | "createdAt">): number {
  const r = db.prepare(`
    INSERT INTO pending_oco
      (symbol, oco_qty, tp_price, sl_stop_price, sl_limit_price, fill_price,
       trail_act_at, trail_dist, trail_mode, tick_size, bot_name, interval_tf,
       score, quote_qty, atr, buy_order_id, journal_id, trade_code, mode, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    p.symbol, p.ocoQty, p.tpPrice, p.slStopPrice, p.slLimitPrice, p.fillPrice,
    p.trailActAt, p.trailDist, p.trailMode, p.tickSize, p.botName, p.intervalTf,
    p.score, p.quoteQty, p.atr, p.buyOrderId ?? null, p.journalId, p.tradeCode ?? null,
    p.mode ?? "paper",
    Date.now(),
  );
  return r.lastInsertRowid as number;
}

export function pendingOcoGetAll(): PendingOco[] {
  return (db.prepare("SELECT * FROM pending_oco ORDER BY created_at ASC").all() as Array<Record<string, unknown>>).map(r => ({
    id:           r.id           as number,
    symbol:       r.symbol       as string,
    ocoQty:       r.oco_qty      as string,
    tpPrice:      r.tp_price     as string,
    slStopPrice:  r.sl_stop_price as string,
    slLimitPrice: r.sl_limit_price as string,
    fillPrice:    r.fill_price   as number,
    trailActAt:   r.trail_act_at as number,
    trailDist:    r.trail_dist   as number,
    trailMode:    r.trail_mode   as string,
    tickSize:     r.tick_size    as string,
    botName:      r.bot_name     as string,
    intervalTf:   r.interval_tf  as string,
    score:        r.score        as number,
    quoteQty:     r.quote_qty    as number,
    atr:          r.atr          as number,
    buyOrderId:   r.buy_order_id as number | null,
    journalId:    r.journal_id   as number,
    tradeCode:    r.trade_code   as string | null,
    mode:         (r.mode as string) ?? "paper",
    attempts:     r.attempts     as number,
    createdAt:    r.created_at   as number,
  }));
}

export function pendingOcoDelete(id: number): void {
  db.prepare("DELETE FROM pending_oco WHERE id = ?").run(id);
}

export function pendingOcoIncAttempts(id: number): void {
  db.prepare("UPDATE pending_oco SET attempts = attempts + 1 WHERE id = ?").run(id);
}

/* ── Orphan watch (posicions detectades sense SL) ────────────── */

db.exec(`
  CREATE TABLE IF NOT EXISTS orphan_watch (
    symbol      TEXT    PRIMARY KEY,
    detected_at INTEGER NOT NULL,
    notified    INTEGER NOT NULL DEFAULT 0
  );
`);

export function orphanWatchUpsert(symbol: string): boolean {
  // Returns true if it was a new insertion (first detection)
  const existing = db.prepare("SELECT symbol FROM orphan_watch WHERE symbol = ?").get(symbol);
  if (existing) return false;
  db.prepare("INSERT INTO orphan_watch (symbol, detected_at, notified) VALUES (?, ?, 0)").run(symbol, Date.now());
  return true;
}

export function orphanWatchGet(symbol: string): { detectedAt: number; notified: number } | null {
  const r = db.prepare("SELECT detected_at, notified FROM orphan_watch WHERE symbol = ?").get(symbol) as
    { detected_at: number; notified: number } | undefined;
  return r ? { detectedAt: r.detected_at, notified: r.notified } : null;
}

export function orphanWatchDelete(symbol: string): void {
  db.prepare("DELETE FROM orphan_watch WHERE symbol = ?").run(symbol);
}

export function orphanWatchMarkNotified(symbol: string): void {
  db.prepare("UPDATE orphan_watch SET notified = 1 WHERE symbol = ?").run(symbol);
}

export function orphanWatchGetAll(): Array<{ symbol: string; detectedAt: number; notified: number }> {
  return (db.prepare("SELECT symbol, detected_at, notified FROM orphan_watch").all() as Array<{
    symbol: string; detected_at: number; notified: number;
  }>).map(r => ({ symbol: r.symbol, detectedAt: r.detected_at, notified: r.notified }));
}

export function hasActiveTrailing(symbol: string): boolean {
  const r = db.prepare(
    "SELECT id FROM trailing_active WHERE symbol = ? AND status = 'active' LIMIT 1"
  ).get(symbol);
  return !!r;
}
