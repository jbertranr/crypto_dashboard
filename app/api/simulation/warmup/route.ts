import { NextRequest, NextResponse } from "next/server";
import { candleUpsertBatch, candleCoveredRange } from "../../../lib/candle-store";
import { OHLCV } from "../../../lib/indicators";

const INTERVAL_MS: Record<string, number> = {
  "15m":  15 * 60_000,
  "30m":  30 * 60_000,
  "1h":   60 * 60_000,
  "4h":  240 * 60_000,
  "1d": 1440 * 60_000,
};

async function fetchBatch(
  symbol: string, interval: string, startMs: number, endMs: number
): Promise<OHLCV[]> {
  const msPerBar = INTERVAL_MS[interval] ?? INTERVAL_MS["1h"];
  const all: OHLCV[] = [];
  let batchStart = startMs;
  let safety = 0;

  while (batchStart < endMs && safety < 50) {
    safety++;
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${batchStart}&endTime=${endMs}&limit=1000`;
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`Binance ${res.status} per ${symbol} ${interval}`);
    const raw: unknown[][] = await res.json();
    if (raw.length === 0) break;
    for (const k of raw) {
      all.push({
        time:   k[0] as number,
        open:   parseFloat(k[1] as string),
        high:   parseFloat(k[2] as string),
        low:    parseFloat(k[3] as string),
        close:  parseFloat(k[4] as string),
        volume: parseFloat(k[5] as string),
      });
    }
    batchStart = (raw[raw.length - 1][0] as number) + msPerBar;
    if (raw.length < 1000) break;
    await new Promise(r => setTimeout(r, 200)); // respecta rate-limit Binance
  }
  return all;
}

// POST /api/simulation/warmup
// Body: { symbols: string[], interval: string, from: number, to: number }
export async function POST(req: NextRequest) {
  try {
    const { symbols, interval, from, to } = await req.json() as {
      symbols: string[]; interval: string; from: number; to: number;
    };
    if (!Array.isArray(symbols) || !symbols.length || !interval || !from || !to) {
      return NextResponse.json({ error: "Falten paràmetres" }, { status: 400 });
    }

    const msPerBar     = INTERVAL_MS[interval] ?? INTERVAL_MS["1h"];
    const currentStart = Math.floor(Date.now() / msPerBar) * msPerBar;
    const closedUntil  = currentStart - 1;
    const cacheEnd     = Math.min(to, closedUntil);

    const report: Record<string, { fetched: number; cached: boolean }> = {};

    for (const symbol of symbols) {
      const covered = candleCoveredRange(symbol, interval);
      const needsFetch = !covered || covered.min > from || covered.max < cacheEnd;

      if (!needsFetch) {
        report[symbol] = { fetched: 0, cached: true };
        continue;
      }

      const candles = await fetchBatch(symbol, interval, from, cacheEnd);
      const closed  = candles.filter(c => c.time <= closedUntil);
      if (closed.length > 0) candleUpsertBatch(symbol, interval, closed);
      report[symbol] = { fetched: closed.length, cached: false };
    }

    return NextResponse.json({ ok: true, report });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
