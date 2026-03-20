import { db } from "./cache-store";
import { OHLCV } from "./indicators";

// ── Schema ────────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS candles (
    symbol   TEXT    NOT NULL,
    interval TEXT    NOT NULL,
    time     INTEGER NOT NULL,
    open     REAL    NOT NULL,
    high     REAL    NOT NULL,
    low      REAL    NOT NULL,
    close    REAL    NOT NULL,
    volume   REAL    NOT NULL,
    PRIMARY KEY (symbol, interval, time)
  );
  CREATE INDEX IF NOT EXISTS candles_range ON candles (symbol, interval, time);
`);

// ── Prepared statements ───────────────────────────────────────────────────────

const stmtUpsert = db.prepare(`
  INSERT OR REPLACE INTO candles (symbol, interval, time, open, high, low, close, volume)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const stmtGetRange = db.prepare(`
  SELECT time, open, high, low, close, volume
  FROM candles
  WHERE symbol = ? AND interval = ? AND time >= ? AND time <= ?
  ORDER BY time ASC
`);

const stmtCovered = db.prepare(`
  SELECT MIN(time) AS min, MAX(time) AS max
  FROM candles WHERE symbol = ? AND interval = ?
`);

const insertMany = db.transaction((symbol: string, interval: string, rows: OHLCV[]) => {
  for (const r of rows) {
    stmtUpsert.run(symbol, interval, r.time, r.open, r.high, r.low, r.close, r.volume);
  }
});

// ── Public API ────────────────────────────────────────────────────────────────

export function candleUpsertBatch(symbol: string, interval: string, candles: OHLCV[]): void {
  if (candles.length === 0) return;
  insertMany(symbol, interval, candles);
}

export function candleGetRange(
  symbol: string, interval: string, fromMs: number, toMs: number
): OHLCV[] {
  return (stmtGetRange.all(symbol, interval, fromMs, toMs) as {
    time: number; open: number; high: number; low: number; close: number; volume: number;
  }[]).map(r => ({ time: r.time, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume }));
}

export function candleCoveredRange(
  symbol: string, interval: string
): { min: number; max: number } | null {
  const row = stmtCovered.get(symbol, interval) as { min: number | null; max: number | null };
  if (row.min === null || row.max === null) return null;
  return { min: row.min, max: row.max };
}
