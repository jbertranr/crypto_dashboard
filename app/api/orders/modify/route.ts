import { NextRequest, NextResponse } from "next/server";
import { modifyOrder } from "../../../lib/binance-auth";

export async function POST(req: NextRequest) {
  try {
    const { symbol, orderId, side, quantity, price, stopPrice } = await req.json();
    const result = await modifyOrder(symbol, orderId, side, quantity, price, stopPrice);
    return NextResponse.json(result);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
