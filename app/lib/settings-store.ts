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
  // Quote asset (moneda base per a tots els parells de trading)
  quote_asset:              "USDC",        // USDT | USDC | BUSD | FDUSD
  // Pair priority (comma-separated list — ha de coincidir amb quote_asset)
  priority_pairs:           "BTCUSDC,ETHUSDC,BNBUSDC,SOLUSDC,XRPUSDC",
  // Auto-trading (master switch only — per-bot config is in the bots table)
  auto_trade_enabled:      "0",        // master switch paper: para TOTS els bots paper
  auto_trade_enabled_real: "0",        // master switch real:  para TOTS els bots real
  // Motors i processos — paper
  order_monitor_enabled:   "1",
  trailing_engine_enabled: "1",
  crash_monitor_enabled:   "1",
  scheduler_enabled:       "1",
  activity_logger_enabled: "1",
  cancel_auto_sell:        "0",
  sl_sell_remaining:       "0",
  // Motors i processos — real
  order_monitor_enabled_real:   "1",
  trailing_engine_enabled_real: "1",
  crash_monitor_enabled_real:   "1",
  scheduler_enabled_real:       "1",
  activity_logger_enabled_real: "1",
  cancel_auto_sell_real:        "0",
  sl_sell_remaining_real:       "0",
  // Motor watchdog
  tg_on_market_scan:            "0",    // Telegram report each time a bot evaluates the market (paper)
  tg_on_motor_anomaly:          "1",   // Telegram alert when a motor behaves anomalously (global)
  motor_anomaly_multiplier:     "3",   // alert if motor hasn't run for N × its poll interval
  // Telegram — real mode variants
  tg_on_new_order_real:         "1",
  tg_on_order_close_real:       "1",
  tg_on_sl_modify_real:         "1",
  tg_on_trailing_activate_real: "1",
  tg_on_market_scan_real:       "0",
  // Entrada al mercat — real
  entry_type_real:              "LIMIT",
  trailing_sl_mode_real:        "ATR",
  trailing_pivot_tf_real:       "1h",
  trailing_pivot_offset_pct_real: "0.1",
  // Capital — real
  capital_mode_real:            "FIXED",
  capital_fixed_usdt_real:      "100",
  capital_pct_portfolio_real:   "5",
  capital_max_open_real:        "3",
  // Prioritats — real
  priority_pairs_real:          "BTCUSDC,ETHUSDC,BNBUSDC,SOLUSDC,XRPUSDC",
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

export function settingGetForMode(key: string, mode: "paper" | "real"): string {
  return settingGet(mode === "real" ? `${key}_real` : key);
}

export function settingGetBoolForMode(key: string, mode: "paper" | "real"): boolean {
  return settingGetBool(mode === "real" ? `${key}_real` : key);
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

/* ── Quote asset helper ───────────────────────────────────────── */
const VALID_QUOTE_ASSETS = new Set(["USDT", "USDC", "BUSD", "FDUSD", "TUSD"]);

/** Retorna l'asset quote configurat (default: "USDC") */
export function getQuoteAsset(): string {
  const v = settingGet("quote_asset").toUpperCase();
  return VALID_QUOTE_ASSETS.has(v) ? v : "USDC";
}
