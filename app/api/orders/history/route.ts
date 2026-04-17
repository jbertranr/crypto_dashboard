import { NextRequest, NextResponse } from "next/server";
import { getOrderHistory } from "../../../lib/binance-auth";
import { apiError } from "../../../lib/api-error";
import { log } from "../../../lib/logger";

// Returns recent order history across the most common pairs
const PAIRS = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT"];

export async function GET(req: NextRequest) {
  try {
    const modeParam = req.nextUrl.searchParams.get("mode");
    const mode = modeParam === "real" ? "real" : "paper";

    const results = await Promise.allSettled(
      PAIRS.map((symbol) => getOrderHistory(symbol, 10, mode))
    );

    const orders = results
      .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
      .sort((a, b) => b.time - a.time)
      .slice(0, 50);

    log.binance.info({ count: orders.length, mode }, "order history");
    return NextResponse.json(orders);
  } catch (e) {
    return apiError(e, "orders/history");
  }
}
