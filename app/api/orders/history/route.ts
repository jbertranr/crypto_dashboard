import { NextResponse } from "next/server";
import { getOrderHistory } from "../../../lib/binance-auth";

// Returns recent order history across the most common pairs
const PAIRS = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT"];

export async function GET() {
  try {
    const results = await Promise.allSettled(
      PAIRS.map((symbol) => getOrderHistory(symbol, 10))
    );

    const orders = results
      .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
      .sort((a, b) => b.time - a.time)
      .slice(0, 50);

    return NextResponse.json(orders);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
