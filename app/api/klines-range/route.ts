import { NextRequest, NextResponse } from "next/server";
import { cacheGet, cacheSet } from "../../lib/cache-store";

export async function GET(req: NextRequest) {
  const symbol    = req.nextUrl.searchParams.get("symbol");
  const startTime = req.nextUrl.searchParams.get("startTime");
  const window    = req.nextUrl.searchParams.get("window"); // "1h" | "4h" | "1d" | null (= full history)

  if (!symbol || !startTime) {
    return NextResponse.json({ error: "symbol and startTime required" }, { status: 400 });
  }

  const H = 3_600_000;
  let interval: string;
  let fetchStart: string;

  if (window) {
    // Fixed lookback window ending now
    const cfg: Record<string, { interval: string; ms: number }> = {
      "1h": { interval: "1m",  ms:      H },
      "4h": { interval: "5m",  ms:  4 * H },
      "1d": { interval: "15m", ms: 24 * H },
    };
    const c = cfg[window] ?? cfg["1d"];
    interval   = c.interval;
    fetchStart = String(Date.now() - c.ms);
  } else {
    // Auto-select interval based on time since order was placed
    const elapsed = Date.now() - parseInt(startTime);
    interval =
      elapsed < 6      * H ? "5m"  :
      elapsed < 24     * H ? "15m" :
      elapsed < 7 * 24 * H ? "1h"  :
      elapsed < 30* 24 * H ? "4h"  : "1d";
    fetchStart = startTime;
  }

  const KEY = `klinesrange:${symbol}:${startTime}:${window ?? "auto"}`;
  const cached = cacheGet<Array<{ time: number; close: number }>>(KEY);
  if (cached) return NextResponse.json(cached.data);

  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${fetchStart}&limit=500`;
  const res = await fetch(url);
  if (!res.ok) return NextResponse.json({ error: "Binance error" }, { status: 500 });

  const raw: unknown[][] = await res.json();
  const data = raw.map(k => ({ time: k[0] as number, close: parseFloat(k[4] as string) }));
  cacheSet(KEY, data, 60);
  return NextResponse.json(data);
}
