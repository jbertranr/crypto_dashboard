/**
 * Trade Journal — persistent SQLite store.
 * Records every executed trade with full context:
 * entry/exit type, execution price, P&L, commissions, strategy,
 * TF used, capital mode, trailing mode, exit reason, free notes.
 */

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
  CREATE TABLE IF NOT EXISTS trade_journal (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    type             TEXT    NOT NULL,          -- ENTRY_BUY | ENTRY_OCO | TRAIL_ACTIVE | EXIT_TP | EXIT_SL | EXIT_TRAILING | EXIT_MARKET | MANUAL
    symbol           TEXT    NOT NULL,
    side             TEXT    NOT NULL,          -- BUY | SELL
    qty              TEXT    NOT NULL,
    price            TEXT    NOT NULL,          -- execution price
    quote_qty        TEXT    NOT NULL DEFAULT '0',  -- USDT value
    commission       TEXT    NOT NULL DEFAULT '0',
    commission_asset TEXT    NOT NULL DEFAULT 'BNB',
    entry_price      TEXT    DEFAULT NULL,      -- for exits: original entry price
    pnl_usdt         REAL    DEFAULT NULL,      -- for exits: realized P&L in USDT
    pnl_pct          REAL    DEFAULT NULL,      -- for exits: P&L as %
    order_id         INTEGER DEFAULT NULL,
    order_list_id    INTEGER DEFAULT NULL,
    strategy         TEXT    DEFAULT NULL,      -- Swing | Scalp | DCA | Breakout | Hedge
    interval         TEXT    DEFAULT NULL,      -- 5m | 1h | 4h
    entry_type       TEXT    DEFAULT NULL,      -- LIMIT | MARKET
    trailing_mode    TEXT    DEFAULT NULL,      -- ATR | PIVOT_LOW
    exit_reason      TEXT    DEFAULT NULL,      -- TP_HIT | SL_HIT | TRAILING_STOP | MARKET_SELL | MANUAL | CANCELED
    capital_usdt     REAL    DEFAULT NULL,      -- USDT deployed
    capital_mode     TEXT    DEFAULT NULL,      -- FIXED | PCT_PORTFOLIO
    notes            TEXT    DEFAULT NULL,
    source           TEXT    NOT NULL DEFAULT 'AUTO',   -- AUTO | MANUAL
    trade_code       TEXT    DEFAULT NULL,              -- T-0001 — codi de trade inicial
    executed_at      INTEGER NOT NULL,
    created_at       INTEGER NOT NULL
  );
`);

/* Migrate: add trade_code if not yet present */
try { db.exec("ALTER TABLE trade_journal ADD COLUMN trade_code TEXT DEFAULT NULL"); } catch { /* ja existeix */ }

/* ── Types ─────────────────────────────────────────────────────────── */

export type JournalType =
  | "ENTRY_BUY" | "ENTRY_OCO"
  | "TRAIL_ACTIVE"
  | "EXIT_TP" | "EXIT_SL" | "EXIT_TRAILING" | "EXIT_MARKET"
  | "MANUAL" | "CANCELED";

export type JournalExitReason =
  | "TP_HIT" | "SL_HIT" | "TRAILING_STOP" | "MARKET_SELL" | "MANUAL" | "CANCELED";

export interface JournalEntry {
  id:              number;
  type:            JournalType;
  symbol:          string;
  side:            "BUY" | "SELL";
  qty:             string;
  price:           string;
  quoteQty:        string;
  commission:      string;
  commissionAsset: string;
  entryPrice:      string | null;
  pnlUsdt:         number | null;
  pnlPct:          number | null;
  orderId:         number | null;
  orderListId:     number | null;
  strategy:        string | null;
  interval:        string | null;
  entryType:       string | null;
  trailingMode:    string | null;
  exitReason:      JournalExitReason | null;
  capitalUsdt:     number | null;
  capitalMode:     string | null;
  notes:           string | null;
  tradeCode:       string | null;
  source:          "AUTO" | "MANUAL";
  executedAt:      number;
  createdAt:       number;
}

export type NewJournalEntry = Omit<JournalEntry, "id" | "createdAt">;

/* ── Row mapper ─────────────────────────────────────────────────────── */

function rowToEntry(r: Record<string, unknown>): JournalEntry {
  return {
    id:              r.id              as number,
    type:            r.type            as JournalType,
    symbol:          r.symbol          as string,
    side:            r.side            as "BUY" | "SELL",
    qty:             r.qty             as string,
    price:           r.price           as string,
    quoteQty:        r.quote_qty       as string,
    commission:      r.commission      as string,
    commissionAsset: r.commission_asset as string,
    entryPrice:      (r.entry_price    as string | null) ?? null,
    pnlUsdt:         (r.pnl_usdt       as number | null) ?? null,
    pnlPct:          (r.pnl_pct        as number | null) ?? null,
    orderId:         (r.order_id       as number | null) ?? null,
    orderListId:     (r.order_list_id  as number | null) ?? null,
    strategy:        (r.strategy       as string | null) ?? null,
    interval:        (r.interval       as string | null) ?? null,
    entryType:       (r.entry_type     as string | null) ?? null,
    trailingMode:    (r.trailing_mode  as string | null) ?? null,
    exitReason:      (r.exit_reason    as JournalExitReason | null) ?? null,
    capitalUsdt:     (r.capital_usdt   as number | null) ?? null,
    capitalMode:     (r.capital_mode   as string | null) ?? null,
    notes:           (r.notes          as string | null) ?? null,
    tradeCode:       (r.trade_code     as string | null) ?? null,
    source:          r.source          as "AUTO" | "MANUAL",
    executedAt:      r.executed_at     as number,
    createdAt:       r.created_at      as number,
  };
}

/* ── Accessors ──────────────────────────────────────────────────────── */

export function journalAdd(entry: NewJournalEntry): number {
  const r = db.prepare(`
    INSERT INTO trade_journal
      (type, symbol, side, qty, price, quote_qty, commission, commission_asset,
       entry_price, pnl_usdt, pnl_pct, order_id, order_list_id, strategy, interval,
       entry_type, trailing_mode, exit_reason, capital_usdt, capital_mode,
       notes, source, trade_code, executed_at, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    entry.type, entry.symbol, entry.side, entry.qty, entry.price,
    entry.quoteQty, entry.commission, entry.commissionAsset,
    entry.entryPrice, entry.pnlUsdt, entry.pnlPct,
    entry.orderId, entry.orderListId, entry.strategy, entry.interval,
    entry.entryType, entry.trailingMode, entry.exitReason,
    entry.capitalUsdt, entry.capitalMode, entry.notes, entry.source,
    entry.tradeCode ?? null,
    entry.executedAt, Date.now(),
  );
  return r.lastInsertRowid as number;
}

export function journalPatchNotes(id: number, notes: string): void {
  db.prepare("UPDATE trade_journal SET notes = ? WHERE id = ?").run(notes, id);
}

export function journalPatchStrategy(id: number, strategy: string | null): void {
  db.prepare("UPDATE trade_journal SET strategy = ? WHERE id = ?").run(strategy, id);
}

export function journalDelete(id: number): void {
  db.prepare("DELETE FROM trade_journal WHERE id = ?").run(id);
}

export interface JournalFilter {
  symbol?:   string;
  side?:     string;
  strategy?: string;
  from?:     number;
  to?:       number;
  limit?:    number;
  offset?:   number;
}

export function journalGetAll(filter: JournalFilter = {}): JournalEntry[] {
  const conditions: string[] = [];
  const params: unknown[]    = [];

  if (filter.symbol)   { conditions.push("symbol = ?");              params.push(filter.symbol); }
  if (filter.side)     { conditions.push("side = ?");                params.push(filter.side); }
  if (filter.strategy) { conditions.push("strategy = ?");            params.push(filter.strategy); }
  if (filter.from)     { conditions.push("executed_at >= ?");        params.push(filter.from); }
  if (filter.to)       { conditions.push("executed_at <= ?");        params.push(filter.to); }

  const where  = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit  = filter.limit  ?? 200;
  const offset = filter.offset ?? 0;

  const rows = db
    .prepare(`SELECT * FROM trade_journal ${where} ORDER BY executed_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as Record<string, unknown>[];

  return rows.map(rowToEntry);
}

/**
 * Returns all journal entries related to the one with the given id.
 * Linking strategy (in priority order):
 *  1. Same order_list_id (OCO group — entry + TP/SL)
 *  2. Same order_id (single fill chain or trailing replacements)
 *  3. Fallback: same symbol within ±7 days of the anchor entry
 * Always returns entries sorted ASC by executed_at.
 */
export function journalGetRelated(id: number): JournalEntry[] {
  const anchor = db
    .prepare("SELECT * FROM trade_journal WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  if (!anchor) return [];

  const listId    = (anchor.order_list_id as number | null) ?? null;
  const orderId   = (anchor.order_id      as number | null) ?? null;
  const tradeCode = (anchor.trade_code    as string | null) ?? null;
  const symbol    = (anchor.symbol        as string);
  const execAt    = (anchor.executed_at   as number);

  // 1. Shared trade code — must have >1 entries to be meaningful
  if (tradeCode) {
    const rows = db
      .prepare("SELECT * FROM trade_journal WHERE trade_code = ? ORDER BY executed_at ASC")
      .all(tradeCode) as Record<string, unknown>[];
    if (rows.length > 1) return rows.map(rowToEntry);
  }

  // 2. Same OCO list
  if (listId != null && listId > 0) {
    const rows = db
      .prepare("SELECT * FROM trade_journal WHERE order_list_id = ? ORDER BY executed_at ASC")
      .all(listId) as Record<string, unknown>[];
    if (rows.length > 1) return rows.map(rowToEntry);
    // Only 1 entry with this orderListId — look for nearby orphan entries (null orderListId, ±5 min)
    // Directional: ENTRY types search forward (expect exit after), EXIT types search backward
    const window5    = 5 * 60 * 1000;
    const isEntry    = (anchor.type as string).startsWith("ENTRY") || anchor.type === "TRAIL_ACTIVE";
    const orphanFrom = isEntry ? execAt          : execAt - window5;
    const orphanTo   = isEntry ? execAt + window5 : execAt;
    const orphans = db
      .prepare(`SELECT * FROM trade_journal
                WHERE symbol = ? AND order_list_id IS NULL
                  AND executed_at BETWEEN ? AND ?
                ORDER BY executed_at ASC`)
      .all(symbol, orphanFrom, orphanTo) as Record<string, unknown>[];
    if (orphans.length > 0) {
      // For entry types: only take up to the first EXIT orphan to avoid grabbing exits from later trades
      const relevant = isEntry
        ? orphans.slice(0, orphans.findIndex((o: Record<string, unknown>) => (o.type as string).startsWith("EXIT")) + 1 || orphans.length)
        : orphans;
      const combined = [...rows, ...relevant]
        .sort((a: Record<string, unknown>, b: Record<string, unknown>) => (a.executed_at as number) - (b.executed_at as number));
      if (combined.length > 1) return combined.map(rowToEntry);
    }
  }

  // 3. Anchor has no orderListId — find the nearest entry (5 min, same symbol) that HAS one.
  //    Directional: EXIT types search before themselves, ENTRY types search after.
  if (listId == null) {
    const window   = 5 * 60 * 1000;
    const isEntry  = (anchor.type as string).startsWith("ENTRY") || anchor.type === "TRAIL_ACTIVE";
    const nearFrom = isEntry ? execAt          : execAt - window;
    const nearTo   = isEntry ? execAt + window : execAt;
    const near = db
      .prepare(`SELECT order_list_id FROM trade_journal
                WHERE symbol = ? AND order_list_id IS NOT NULL
                  AND executed_at BETWEEN ? AND ?
                ORDER BY ABS(executed_at - ?) LIMIT 1`)
      .get(symbol, nearFrom, nearTo, execAt) as { order_list_id: number } | undefined;
    if (near?.order_list_id) {
      const rows = db
        .prepare("SELECT * FROM trade_journal WHERE order_list_id = ? ORDER BY executed_at ASC")
        .all(near.order_list_id) as Record<string, unknown>[];
      // Include anchor if it is not already in the group
      const inGroup = rows.some((r: Record<string, unknown>) => r.id === anchor.id);
      const combined = inGroup ? rows : [...rows, anchor].sort((a: Record<string, unknown>, b: Record<string, unknown>) => (a.executed_at as number) - (b.executed_at as number));
      if (combined.length > 1) return combined.map(rowToEntry);
    }
  }

  // 4. Same order id
  if (orderId != null && orderId > 0) {
    const rows = db
      .prepare("SELECT * FROM trade_journal WHERE order_id = ? ORDER BY executed_at ASC")
      .all(orderId) as Record<string, unknown>[];
    if (rows.length > 1) return rows.map(rowToEntry);
  }

  // No link found — return single anchor (timeline stays hidden)
  const single = db
    .prepare("SELECT * FROM trade_journal WHERE id = ? ORDER BY executed_at ASC")
    .all(id) as Record<string, unknown>[];
  return single.map(rowToEntry);
}

/**
 * Returns the most recent tradeCode recorded for the given symbol
 * within the last `withinMs` ms (default 48 h).
 * Used by exit routes to link a manual/market sell to its origin trade.
 */
export function journalGetLastTradeCode(symbol: string, withinMs = 48 * 3600 * 1000): string | null {
  const since = Date.now() - withinMs;
  const row = db.prepare(`
    SELECT trade_code FROM trade_journal
    WHERE symbol = ? AND trade_code IS NOT NULL AND executed_at >= ?
    ORDER BY executed_at DESC LIMIT 1
  `).get(symbol, since) as { trade_code: string } | undefined;
  return row?.trade_code ?? null;
}

export function journalStats(): {
  totalEntries:   number;
  totalPnlUsdt:   number;
  wins:           number;
  losses:         number;
  totalCommission: number;
  biggestWin:     number;
  biggestLoss:    number;
  avgPnl:         number;
} {
  const rows = db
    .prepare("SELECT pnl_usdt, commission, commission_asset FROM trade_journal WHERE pnl_usdt IS NOT NULL")
    .all() as Array<{ pnl_usdt: number; commission: string; commission_asset: string }>;

  let totalPnl = 0, wins = 0, losses = 0, totalComm = 0, bigWin = 0, bigLoss = 0;
  for (const r of rows) {
    const p = r.pnl_usdt;
    totalPnl += p;
    if (p >= 0) { wins++; if (p > bigWin) bigWin = p; }
    else         { losses++; if (p < bigLoss) bigLoss = p; }
    // Sum commissions denominated in USDT/equivalent (raw value)
    totalComm += parseFloat(r.commission) || 0;
  }
  const all = db.prepare("SELECT COUNT(*) as n FROM trade_journal").get() as { n: number };
  return {
    totalEntries:    all.n,
    totalPnlUsdt:    totalPnl,
    wins,
    losses,
    totalCommission: totalComm,
    biggestWin:      bigWin,
    biggestLoss:     bigLoss,
    avgPnl:          rows.length > 0 ? totalPnl / rows.length : 0,
  };
}
