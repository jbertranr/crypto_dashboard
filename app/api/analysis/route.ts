import { NextRequest, NextResponse } from "next/server";
import { analyzeAll, OHLCV } from "../../lib/indicators";
import { cacheGet, cacheSet } from "../../lib/cache-store";

export async function GET(req: NextRequest) {
  const symbol   = req.nextUrl.searchParams.get("symbol");
  const interval = req.nextUrl.searchParams.get("interval") ?? "1h";

  if (!symbol) return NextResponse.json({ error: "Missing symbol" }, { status: 400 });

  const TTL =
    interval === "5m"  ? 60  :
    interval === "1h"  ? 300 : 600; // 4h
  const KEY = `analysis:${symbol}:${interval}`;

  const cached = cacheGet<ReturnType<typeof analyzeAll>>(KEY);
  if (cached) return NextResponse.json(cached.data, { headers: { "Cache-Control": "no-store" } });

  const res = await fetch(
    `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=250`
  );

  if (!res.ok) return NextResponse.json({ error: "Binance API error" }, { status: 502 });

  const raw: unknown[][] = await res.json();
  const candles: OHLCV[] = raw.map(k => ({
    time:   k[0] as number,
    open:   parseFloat(k[1] as string),
    high:   parseFloat(k[2] as string),
    low:    parseFloat(k[3] as string),
    close:  parseFloat(k[4] as string),
    volume: parseFloat(k[5] as string),
  }));

  const result = analyzeAll(candles, symbol, interval);
  cacheSet(KEY, result, TTL);
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
