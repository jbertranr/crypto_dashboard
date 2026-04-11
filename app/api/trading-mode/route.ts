import { NextResponse } from "next/server";

/**
 * GET /api/trading-mode
 * Retorna si les claus de real trading estan configurades (sense exposar-les).
 */
export async function GET() {
  const hasReal = !!(process.env.BINANCE_API_KEY_REAL && process.env.BINANCE_SECRET_KEY_REAL);
  return NextResponse.json({ realConfigured: hasReal });
}
