import { NextRequest, NextResponse } from "next/server";
import { placeOcoOrder } from "../../../lib/binance-auth";

export async function POST(req: NextRequest) {
  try {
    const { symbol, side, quantity, tpPrice, slStopPrice, slLimitPrice } = await req.json();
    const result = await placeOcoOrder({ symbol, side, quantity, tpPrice, slStopPrice, slLimitPrice });
    return NextResponse.json(result);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
