import { NextRequest, NextResponse } from "next/server";
import { cacheGet, cacheSet } from "../../lib/cache-store";

export async function GET(req: NextRequest) {
  const pair = req.nextUrl.searchParams.get("pair");
  if (!pair) return NextResponse.json({ error: "Missing pair" }, { status: 400 });

  const interval = req.nextUrl.searchParams.get("interval") ?? "1h";
  const limit = req.nextUrl.searchParams.get("limit") ?? "24";

  const TTL =
    interval === "1m"  ? 30  :
    interval === "5m"  ? 60  :
    interval === "15m" ? 120 :
    interval === "1h"  ? 300 :
    interval === "4h"  ? 600 :
    interval === "1d"  ? 900 : 1800; // 1w+
  const KEY = `klines:${pair}:${interval}:${limit}`;

  const cached = cacheGet<Array<{ time: number; close: number }>>(KEY);
  if (cached) return NextResponse.json(cached.data);

  // Fetch one extra candle to always include the current forming candle
  const limitNum = parseInt(limit) + 1;

  const res = await fetch(
    `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${interval}&limit=${limitNum}`
  );
  if (!res.ok) return NextResponse.json([], { status: 200 });

  const klines: unknown[][] = await res.json();
  const chart = klines.map((k) => ({
    time: k[0] as number,
    close: parseFloat(k[4] as string),
  }));

  cacheSet(KEY, chart, TTL);
  return NextResponse.json(chart);
}
