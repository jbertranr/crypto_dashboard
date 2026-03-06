import { NextRequest, NextResponse } from "next/server";
import { placeOcoOrder } from "../../../lib/binance-auth";
import { trailingSet } from "../../../lib/cache-store";

export async function POST(req: NextRequest) {
  try {
    const { symbol, side, quantity, tpPrice, slStopPrice, slLimitPrice, trailing } = await req.json();
    const result = await placeOcoOrder({ symbol, side, quantity, tpPrice, slStopPrice, slLimitPrice }) as Record<string, unknown>;
    if (trailing && typeof result.orderListId === "number" && result.orderListId !== -1) {
      trailingSet(result.orderListId, { symbol, ...trailing });
    }
    return NextResponse.json(result);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
