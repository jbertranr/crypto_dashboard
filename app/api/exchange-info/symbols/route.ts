import { NextResponse } from "next/server";
import { cacheGet, cacheSet } from "../../../lib/cache-store";

interface BinanceSymbol {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
}

/**
 * GET /api/exchange-info/symbols
 * Retorna tots els parells de Binance spot actius (cached 1h).
 */
export async function GET() {
  const KEY = "exchange-info:all-symbols";
  const cached = cacheGet<{ symbols: { symbol: string; base: string; quote: string }[] }>(KEY);
  if (cached) return NextResponse.json(cached.data);

  const res = await fetch(
    "https://api.binance.com/api/v3/exchangeInfo?permissions=SPOT",
    { signal: AbortSignal.timeout(15_000) }
  );
  if (!res.ok) return NextResponse.json({ error: "Failed" }, { status: 500 });

  const data = await res.json() as { symbols: BinanceSymbol[] };
  const symbols = data.symbols
    .filter(s => s.status === "TRADING")
    .map(s => ({ symbol: s.symbol, base: s.baseAsset, quote: s.quoteAsset }));

  cacheSet(KEY, { symbols }, 3600); // 1h
  return NextResponse.json({ symbols });
}
