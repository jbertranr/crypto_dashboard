import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const pair = req.nextUrl.searchParams.get("pair");
  if (!pair) return NextResponse.json({ error: "Missing pair" }, { status: 400 });

  const interval = req.nextUrl.searchParams.get("interval") ?? "1h";
  const limit = req.nextUrl.searchParams.get("limit") ?? "24";

  // Cache proportional to candle size: longer timeframes need less frequent refresh
  const revalidate =
    interval === "1m" ? 60 :
    interval === "5m" ? 300 :
    interval === "15m" ? 600 :
    interval === "1h" ? 1800 :
    interval === "4h" ? 7200 :
    interval === "1d" ? 21600 : 86400; // 1w+

  const res = await fetch(
    `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${interval}&limit=${limit}`,
    { next: { revalidate } }
  );
  if (!res.ok) return NextResponse.json([], { status: 200 });

  const klines: unknown[][] = await res.json();
  const chart = klines.map((k) => ({
    time: k[0] as number,
    close: parseFloat(k[4] as string),
  }));

  return NextResponse.json(chart);
}
