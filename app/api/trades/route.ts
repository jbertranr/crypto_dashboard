import { NextResponse } from "next/server";
import { getMyTrades } from "../../lib/binance-auth";
import { apiError } from "../../lib/api-error";
import { log } from "../../lib/logger";

const PAIRS = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT"];

export async function GET() {
  try {
    const results = await Promise.allSettled(
      PAIRS.map((symbol) => getMyTrades(symbol, 20))
    );

    const trades = results
      .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
      .sort((a, b) => b.time - a.time);

    log.binance.info({ count: trades.length }, "trades");
    return NextResponse.json(trades);
  } catch (e) {
    return apiError(e, "trades");
  }
}
