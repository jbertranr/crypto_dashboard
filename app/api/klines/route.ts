import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const pair = req.nextUrl.searchParams.get("pair");
  if (!pair) return NextResponse.json({ error: "Missing pair" }, { status: 400 });

  const interval = req.nextUrl.searchParams.get("interval") ?? "1h";
  const limit = req.nextUrl.searchParams.get("limit") ?? "24";

  const res = await fetch(
    `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${interval}&limit=${limit}`,
    { next: { revalidate: 60 } }
  );
  if (!res.ok) return NextResponse.json([], { status: 200 });

  const klines: unknown[][] = await res.json();
  const chart = klines.map((k) => ({
    time: k[0] as number,
    close: parseFloat(k[4] as string),
  }));

  return NextResponse.json(chart);
}
