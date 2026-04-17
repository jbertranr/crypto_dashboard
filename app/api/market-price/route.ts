import { NextRequest, NextResponse } from "next/server";
import { BINANCE_BASE } from "../../lib/constants";

/**
 * GET /api/market-price?symbol=SOLBTC
 * Retorna el preu actual d'un parell Binance qualsevol.
 */
export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol")?.toUpperCase();
  if (!symbol) return NextResponse.json({ error: "symbol requerit" }, { status: 400 });

  try {
    const res = await fetch(`${BINANCE_BASE}/ticker/price?symbol=${symbol}`, { cache: "no-store" });
    if (!res.ok) return NextResponse.json({ error: "Parell no trobat" }, { status: 404 });
    const data = await res.json() as { price: string };
    return NextResponse.json({ symbol, price: parseFloat(data.price) });
  } catch {
    return NextResponse.json({ error: "Error obtenint preu" }, { status: 500 });
  }
}
