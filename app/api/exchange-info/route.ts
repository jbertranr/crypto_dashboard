import { NextRequest, NextResponse } from "next/server";
import { cacheGet, cacheSet } from "../../lib/cache-store";

interface BinanceFilter {
  filterType: string;
  stepSize?: string;
  tickSize?: string;
  minQty?: string;
  maxQty?: string;
}

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol");
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });

  const KEY = `exchangeinfo:${symbol}`;
  const cached = cacheGet<{ stepSize: string; minQty: string; tickSize: string }>(KEY);
  if (cached) return NextResponse.json(cached.data);

  const res = await fetch(
    `https://api.binance.com/api/v3/exchangeInfo?symbol=${symbol}`
  );
  if (!res.ok) return NextResponse.json({ error: "Failed" }, { status: 500 });

  const data = await res.json();
  const filters: BinanceFilter[] = data.symbols?.[0]?.filters ?? [];

  const lot   = filters.find(f => f.filterType === "LOT_SIZE");
  const price = filters.find(f => f.filterType === "PRICE_FILTER");

  const result = {
    stepSize: lot?.stepSize   ?? "0.00001",
    minQty:   lot?.minQty     ?? "0.00001",
    tickSize: price?.tickSize ?? "0.01",
  };

  cacheSet(KEY, result, 86400); // 24h
  return NextResponse.json(result);
}
