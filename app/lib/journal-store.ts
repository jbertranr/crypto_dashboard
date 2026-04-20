/**
 * Trade Journal — persistent SQLite store.
 * Records every executed trade with full context:
 * entry/exit type, execution price, P&L, commissions, strategy,
 * TF used, capital mode, trailing mode, exit reason, free notes.
 */

import path from "path";
import fs from "fs";
import { getDb, paperDb, realDb } from "./db";

// Alias for the old single-db references (now routes by mode)
const db = paperDb; // default fallback — all explicit calls pass mode

const JOURNAL_SCHEMA = `
  CREATE TABLE IF NOT EXISTS trade_journal (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    type             TEXT    NOT NULL,
    symbol           TEXT    NOT NULL,
    side             TEXT    NOT NULL,
    qty              TEXT    NOT NULL,
    price            TEXT    NOT NULL,
    quote_qty        TEXT    NOT NULL DEFAULT '0',
    commission       TEXT    NOT NULL DEFAULT '0',
    commission_asset TEXT    NOT NULL DEFAULT 'BNB',
    entry_price      TEXT    DEFAULT NULL,
    pnl_usdt         REAL    DEFAULT NULL,
    pnl_pct          REAL    DEFAULT NULL,
    order_id         INTEGER DEFAULT NULL,
    order_list_id    INTEGER DEFAULT NULL,
    strategy         TEXT    DEFAULT NULL,
    interval         TEXT    DEFAULT NULL,
    entry_type       TEXT    DEFAULT NULL,
    trailing_mode    TEXT    DEFAULT NULL,
    exit_reason      TEXT    DEFAULT NULL,
    capital_usdt     REAL    DEFAULT NULL,
    capital_mode     TEXT    DEFAULT NULL,
    notes            TEXT    DEFAULT NULL,
    source           TEXT    NOT NULL DEFAULT 'AUTO',
    trade_code       TEXT    DEFAULT NULL,
    tp_price         REAL    DEFAULT NULL,
    sl_price         REAL    DEFAULT NULL,
    trailing_activate_at REAL DEFAULT NULL,
    executed_at      INTEGER NOT NULL,
    created_at       INTEGER NOT NULL
  );
`;

function initJournalDb(d: ReturnType<typeof getDb>) {
  d.exec(JOURNAL_SCHEMA);
  try { d.exec("ALTER TABLE trade_journal ADD COLUMN trade_code TEXT DEFAULT NULL"); } catch { /* ja existeix */ }
  try { d.exec("ALTER TABLE trade_journal ADD COLUMN tp_price REAL DEFAULT NULL"); } catch { /* ja existeix */ }
  try { d.exec("ALTER TABLE trade_journal ADD COLUMN sl_price REAL DEFAULT NULL"); } catch { /* ja existeix */ }
  try { d.exec("ALTER TABLE trade_journal ADD COLUMN trailing_activate_at REAL DEFAULT NULL"); } catch { /* ja existeix */ }

  // Migrate existing data from cache.db (one-time, safe to retry)
  migrateFromCacheDb(d);
}

function migrateFromCacheDb(target: ReturnType<typeof getDb>) {
  try {
    const dataDir = target === paperDb
      ? (paperDb as unknown as { filename: string }).filename?.replace(/paper\.db$/, "")
      : (realDb  as unknown as { filename: string }).filename?.replace(/real\.db$/, "");
    const cacheDbPath = path.join(dataDir ?? path.join(process.cwd(), "data"), "cache.db");
    if (!fs.existsSync(cacheDbPath)) return;

    const srcMode = target === paperDb ? "paper" : "real";
    // Attach source DB and copy rows not yet present
    target.exec(`ATTACH DATABASE '${cacheDbPath}' AS src`);
    target.exec(`
      INSERT OR IGNORE INTO trade_journal
        SELECT id, type, symbol, side, qty, price, quote_qty, commission, commission_asset,
               entry_price, pnl_usdt, pnl_pct, order_id, order_list_id, strategy, interval,
               entry_type, trailing_mode, exit_reason, capital_usdt, capital_mode, notes,
               source, trade_code, tp_price, sl_price, trailing_activate_at, executed_at, created_at
        FROM src.trade_journal
        WHERE mode = '${srcMode}'
    `);
    target.exec("DETACH DATABASE src");
  } catch { /* cache.db pot no tenir la taula o la columna mode — ignorat */ }
}

initJournalDb(paperDb);
initJournalDb(realDb);

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
  tpPrice:            number | null;
  slPrice:            number | null;
  trailingActivateAt: number | null;
  source:          "AUTO" | "MANUAL";
  mode:            "paper" | "real";
  executedAt:      number;
  createdAt:       number;
}

export type NewJournalEntry = Omit<JournalEntry, "id" | "createdAt" | "tpPrice" | "slPrice" | "trailingActivateAt" | "mode"> & {
  tpPrice?: number | null;
  slPrice?: number | null;
  trailingActivateAt?: number | null;
  mode?: "paper" | "real";
};

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
    tpPrice:            (r.tp_price            as number | null) ?? null,
    slPrice:            (r.sl_price            as number | null) ?? null,
    trailingActivateAt: (r.trailing_activate_at as number | null) ?? null,
    source:          r.source          as "AUTO" | "MANUAL",
    mode:            ((r.mode as string) === "real" ? "real" : "paper"),
    executedAt:      r.executed_at     as number,
    createdAt:       r.created_at      as number,
  };
}

/* ── Accessors ──────────────────────────────────────────────────────── */

export function journalAdd(entry: NewJournalEntry): number {
  const d = getDb(entry.mode ?? "paper");
  const r = d.prepare(`
    INSERT INTO trade_journal
      (type, symbol, side, qty, price, quote_qty, commission, commission_asset,
       entry_price, pnl_usdt, pnl_pct, order_id, order_list_id, strategy, interval,
       entry_type, trailing_mode, exit_reason, capital_usdt, capital_mode,
       notes, source, trade_code, tp_price, sl_price, trailing_activate_at, executed_at, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    entry.type, entry.symbol, entry.side, entry.qty, entry.price,
    entry.quoteQty, entry.commission, entry.commissionAsset,
    entry.entryPrice, entry.pnlUsdt, entry.pnlPct,
    entry.orderId, entry.orderListId, entry.strategy, entry.interval,
    entry.entryType, entry.trailingMode, entry.exitReason,
    entry.capitalUsdt, entry.capitalMode, entry.notes, entry.source,
    entry.tradeCode ?? null,
    entry.tpPrice ?? null, entry.slPrice ?? null,
    entry.trailingActivateAt ?? null,
    entry.executedAt, Date.now(),
  );
  return r.lastInsertRowid as number;
}

export function journalPatchTpSl(id: number, tpPrice: number, slPrice: number, mode: "paper" | "real" = "paper"): void {
  getDb(mode).prepare("UPDATE trade_journal SET tp_price = ?, sl_price = ? WHERE id = ?").run(tpPrice, slPrice, id);
}

export function journalPatchNotes(id: number, notes: string, mode: "paper" | "real" = "paper"): void {
  getDb(mode).prepare("UPDATE trade_journal SET notes = ? WHERE id = ?").run(notes, id);
}

export function journalPatchOco(id: number, orderListId: number, tradeCode: string, mode: "paper" | "real" = "paper"): void {
  getDb(mode).prepare("UPDATE trade_journal SET order_list_id = ?, trade_code = ? WHERE id = ?").run(orderListId, tradeCode, id);
}

export function journalPatchStrategy(id: number, strategy: string | null, mode: "paper" | "real" = "paper"): void {
  getDb(mode).prepare("UPDATE trade_journal SET strategy = ? WHERE id = ?").run(strategy, id);
}

export function journalDelete(id: number, mode: "paper" | "real" = "paper"): void {
  getDb(mode).prepare("DELETE FROM trade_journal WHERE id = ?").run(id);
}

export interface JournalFilter {
  symbol?:   string;
  side?:     string;
  strategy?: string;
  from?:     number;
  to?:       number;
  limit?:    number;
  offset?:   number;
  mode?:     "paper" | "real";
}

export function journalGetAll(filter: JournalFilter = {}): JournalEntry[] {
  const d = getDb(filter.mode ?? "paper");
  const conditions: string[] = [];
  const params: unknown[]    = [];

  if (filter.symbol)   { conditions.push("symbol = ?");       params.push(filter.symbol); }
  if (filter.side)     { conditions.push("side = ?");         params.push(filter.side); }
  if (filter.strategy) { conditions.push("strategy = ?");     params.push(filter.strategy); }
  if (filter.from)     { conditions.push("executed_at >= ?"); params.push(filter.from); }
  if (filter.to)       { conditions.push("executed_at <= ?"); params.push(filter.to); }
  // No mode filter needed — each DB is already mode-specific

  const where  = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit  = filter.limit  ?? 200;
  const offset = filter.offset ?? 0;

  const rows = d
    .prepare(`SELECT * FROM trade_journal ${where} ORDER BY executed_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as Record<string, unknown>[];

  return rows.map(r => ({ ...rowToEntry(r), mode: filter.mode ?? "paper" }));
}

/**
 * Returns all journal entries related to the one with the given id.
 * Linking strategy (in priority order):
 *  1. Same order_list_id (OCO group — entry + TP/SL)
 *  2. Same order_id (single fill chain or trailing replacements)
 *  3. Fallback: same symbol within ±7 days of the anchor entry
 * Always returns entries sorted ASC by executed_at.
 */
export function journalGetRelated(id: number, mode: "paper" | "real" = "paper"): JournalEntry[] {
  const d = getDb(mode);
  const anchor = d
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
    const rows = d
      .prepare("SELECT * FROM trade_journal WHERE trade_code = ? ORDER BY executed_at ASC")
      .all(tradeCode) as Record<string, unknown>[];
    if (rows.length > 1) return rows.map(rowToEntry);
  }

  // 2. Same OCO list
  if (listId != null && listId > 0) {
    const rows = d
      .prepare("SELECT * FROM trade_journal WHERE order_list_id = ? ORDER BY executed_at ASC")
      .all(listId) as Record<string, unknown>[];
    if (rows.length > 1) return rows.map(rowToEntry);
    const window5    = 5 * 60 * 1000;
    const isEntry    = (anchor.type as string).startsWith("ENTRY") || anchor.type === "TRAIL_ACTIVE";
    const orphanFrom = isEntry ? execAt          : execAt - window5;
    const orphanTo   = isEntry ? execAt + window5 : execAt;
    const orphans = d
      .prepare(`SELECT * FROM trade_journal
                WHERE symbol = ? AND order_list_id IS NULL
                  AND executed_at BETWEEN ? AND ?
                ORDER BY executed_at ASC`)
      .all(symbol, orphanFrom, orphanTo) as Record<string, unknown>[];
    if (orphans.length > 0) {
      const relevant = isEntry
        ? orphans.slice(0, orphans.findIndex((o: Record<string, unknown>) => (o.type as string).startsWith("EXIT")) + 1 || orphans.length)
        : orphans;
      const combined = [...rows, ...relevant]
        .sort((a: Record<string, unknown>, b: Record<string, unknown>) => (a.executed_at as number) - (b.executed_at as number));
      if (combined.length > 1) return combined.map(rowToEntry);
    }
  }

  // 3. Anchor has no orderListId — find the nearest entry (5 min, same symbol) that HAS one.
  if (listId == null) {
    const window   = 5 * 60 * 1000;
    const isEntry  = (anchor.type as string).startsWith("ENTRY") || anchor.type === "TRAIL_ACTIVE";
    const nearFrom = isEntry ? execAt          : execAt - window;
    const nearTo   = isEntry ? execAt + window : execAt;
    const near = d
      .prepare(`SELECT order_list_id FROM trade_journal
                WHERE symbol = ? AND order_list_id IS NOT NULL
                  AND executed_at BETWEEN ? AND ?
                ORDER BY ABS(executed_at - ?) LIMIT 1`)
      .get(symbol, nearFrom, nearTo, execAt) as { order_list_id: number } | undefined;
    if (near?.order_list_id) {
      const rows = d
        .prepare("SELECT * FROM trade_journal WHERE order_list_id = ? ORDER BY executed_at ASC")
        .all(near.order_list_id) as Record<string, unknown>[];
      const inGroup = rows.some((r: Record<string, unknown>) => r.id === anchor.id);
      const combined = inGroup ? rows : [...rows, anchor].sort((a: Record<string, unknown>, b: Record<string, unknown>) => (a.executed_at as number) - (b.executed_at as number));
      if (combined.length > 1) return combined.map(rowToEntry);
    }
  }

  // 4. Same order id
  if (orderId != null && orderId > 0) {
    const rows = d
      .prepare("SELECT * FROM trade_journal WHERE order_id = ? ORDER BY executed_at ASC")
      .all(orderId) as Record<string, unknown>[];
    if (rows.length > 1) return rows.map(rowToEntry);
  }

  // No link found — return single anchor
  const single = d
    .prepare("SELECT * FROM trade_journal WHERE id = ? ORDER BY executed_at ASC")
    .all(id) as Record<string, unknown>[];
  return single.map(rowToEntry);
}

/**
 * Returns the entry price and qty from the most recent ENTRY_BUY for the given symbol.
 * Prefers matching by tradeCode when available, falls back to most recent within 48h.
 */
export function journalGetLastEntryMeta(symbol: string, mode: "paper" | "real" = "paper"): {
  price: number; qty: number;
  orderId: number | null; orderListId: number | null; tradeCode: string | null;
} | null {
  const since = Date.now() - 48 * 3600 * 1000;
  const row = getDb(mode).prepare(
    `SELECT price, qty, order_id, order_list_id, trade_code
     FROM trade_journal
     WHERE symbol = ? AND type IN ('ENTRY_BUY','ENTRY_OCO') AND executed_at >= ?
     ORDER BY executed_at DESC LIMIT 1`
  ).get(symbol, since) as { price: string; qty: string; order_id: number | null; order_list_id: number | null; trade_code: string | null } | undefined;
  if (!row) return null;
  return {
    price:       parseFloat(row.price),
    qty:         parseFloat(row.qty),
    orderId:     row.order_id     ?? null,
    orderListId: row.order_list_id ?? null,
    tradeCode:   row.trade_code   ?? null,
  };
}

export function journalGetLastEntryPrice(
  symbol: string,
  tradeCode: string | null,
  mode: "paper" | "real" = "paper",
): { price: number; qty: number } | null {
  const d = getDb(mode);
  if (tradeCode) {
    const row = d.prepare(
      "SELECT price, qty FROM trade_journal WHERE trade_code = ? AND type = 'ENTRY_BUY' ORDER BY executed_at ASC LIMIT 1"
    ).get(tradeCode) as { price: string; qty: string } | undefined;
    if (row) return { price: parseFloat(row.price), qty: parseFloat(row.qty) };
  }
  const since = Date.now() - 48 * 3600 * 1000;
  const row = d.prepare(
    "SELECT price, qty FROM trade_journal WHERE symbol = ? AND type = 'ENTRY_BUY' AND executed_at >= ? ORDER BY executed_at DESC LIMIT 1"
  ).get(symbol, since) as { price: string; qty: string } | undefined;
  return row ? { price: parseFloat(row.price), qty: parseFloat(row.qty) } : null;
}

/**
 * Returns the most recent tradeCode recorded for the given symbol
 * within the last `withinMs` ms (default 48 h).
 * Used by exit routes to link a manual/market sell to its origin trade.
 */
export function journalGetLastTradeCode(symbol: string, withinMs = 48 * 3600 * 1000, mode: "paper" | "real" = "paper"): string | null {
  const since = Date.now() - withinMs;
  const row = getDb(mode).prepare(`
    SELECT trade_code FROM trade_journal
    WHERE symbol = ? AND trade_code IS NOT NULL AND executed_at >= ?
    ORDER BY executed_at DESC LIMIT 1
  `).get(symbol, since) as { trade_code: string } | undefined;
  return row?.trade_code ?? null;
}

export function journalStats(mode: "paper" | "real" = "paper"): {
  totalEntries:   number;
  totalPnlUsdt:   number;
  wins:           number;
  losses:         number;
  totalCommission: number;
  biggestWin:     number;
  biggestLoss:    number;
  avgPnl:         number;
} {
  const d = getDb(mode);
  const rows = d
    .prepare("SELECT pnl_usdt, commission, commission_asset FROM trade_journal WHERE pnl_usdt IS NOT NULL")
    .all() as Array<{ pnl_usdt: number; commission: string; commission_asset: string }>;

  let totalPnl = 0, wins = 0, losses = 0, totalComm = 0, bigWin = 0, bigLoss = 0;
  for (const r of rows) {
    const p = r.pnl_usdt;
    totalPnl += p;
    if (p >= 0) { wins++; if (p > bigWin) bigWin = p; }
    else         { losses++; if (p < bigLoss) bigLoss = p; }
    totalComm += parseFloat(r.commission) || 0;
  }
  const all = d.prepare("SELECT COUNT(*) as n FROM trade_journal").get() as { n: number };
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
