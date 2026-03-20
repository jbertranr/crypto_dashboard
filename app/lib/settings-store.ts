/**
 * Persistent settings using the shared SQLite database (data/cache.db).
 * Keys are simple strings; values are stored as text.
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
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

/* ── Defaults ─────────────────────────────────────────────────── */
export const SETTING_DEFAULTS: Record<string, string> = {
  // Telegram
  tg_on_new_order:          "1",
  tg_on_order_close:        "1",
  tg_on_sl_modify:          "1",
  tg_on_trailing_activate:  "1",
  // Entry
  entry_type:               "LIMIT",   // LIMIT | MARKET
  entry_limit_offset_pct:   "0.1",     // % below price for limit entry
  // OCO defaults
  oco_tp_atr:               "2.0",     // TP = price + N×ATR
  oco_sl_atr:               "1.0",     // SL = price − N×ATR
  oco_sl_limit_offset_pct:  "0.2",     // SL limit = SL stop − X%
  // Trailing stop defaults
  trailing_activate_atr:    "1.5",     // activate when price ≥ entry + N×ATR
  trailing_distance_atr:    "1.0",     // trailing distance = N×ATR (when mode = ATR)
  trailing_sl_mode:         "ATR",     // ATR | PIVOT_LOW
  trailing_pivot_tf:        "1h",      // TF used to detect pivot lows (when mode = PIVOT_LOW)
  trailing_pivot_offset_pct: "0.1",   // % buffer below pivot low (avoids exact-touch stops)
  // Capital management
  capital_mode:             "FIXED",   // FIXED | PCT_PORTFOLIO
  capital_fixed_usdt:       "100",     // USDT per trade (FIXED mode)
  capital_pct_portfolio:    "5",       // % of total portfolio per trade (PCT mode)
  capital_max_open:         "3",       // max simultaneous open positions
  // Pair priority (comma-separated list of enabled pairs)
  priority_pairs:           "BTCUSDT,ETHUSDT,BNBUSDT,SOLUSDT,XRPUSDT",
  // Auto-trading (master switch only — per-bot config is in the bots table)
  auto_trade_enabled: "0",             // master switch: para TOTS els bots (0 = off, 1 = on)
};

/* ── Accessors ────────────────────────────────────────────────── */
export function settingGet(key: string): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? SETTING_DEFAULTS[key] ?? "";
}

export function settingGetBool(key: string): boolean {
  return settingGet(key) === "1";
}

const SETTING_VALIDATORS: Record<string, (v: string) => void> = {
  capital_pct_portfolio:   v => { const n = +v; if (!Number.isFinite(n) || n <= 0 || n > 100)  throw new Error("capital_pct_portfolio ha d'estar entre 0 i 100"); },
  capital_fixed_usdt:      v => { const n = +v; if (!Number.isFinite(n) || n <= 0)             throw new Error("capital_fixed_usdt ha de ser > 0"); },
  capital_max_open:        v => { const n = +v; if (!Number.isInteger(n) || n < 1 || n > 50)   throw new Error("capital_max_open ha d'estar entre 1 i 50"); },
  oco_tp_atr:              v => { const n = +v; if (!Number.isFinite(n) || n <= 0)             throw new Error("oco_tp_atr ha de ser > 0"); },
  oco_sl_atr:              v => { const n = +v; if (!Number.isFinite(n) || n <= 0)             throw new Error("oco_sl_atr ha de ser > 0"); },
  trailing_activate_atr:   v => { const n = +v; if (!Number.isFinite(n) || n <= 0)             throw new Error("trailing_activate_atr ha de ser > 0"); },
  trailing_distance_atr:   v => { const n = +v; if (!Number.isFinite(n) || n <= 0)             throw new Error("trailing_distance_atr ha de ser > 0"); },
};

export function settingSet(key: string, value: string): void {
  SETTING_VALIDATORS[key]?.(value);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);
}

export function settingGetAll(): Record<string, string> {
  const rows = db
    .prepare("SELECT key, value FROM settings")
    .all() as Array<{ key: string; value: string }>;
  const result: Record<string, string> = { ...SETTING_DEFAULTS };
  for (const row of rows) result[row.key] = row.value;
  return result;
}
