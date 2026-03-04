import { NextRequest, NextResponse } from "next/server";
import { cancelOrder, cancelOcoOrder } from "../../../lib/binance-auth";

export async function POST(req: NextRequest) {
  try {
    const { symbol, orderId, orderListId } = await req.json();
    let result;
    if (orderListId != null && orderListId !== -1) {
      result = await cancelOcoOrder(symbol, orderListId);
    } else {
      result = await cancelOrder(symbol, orderId);
    }
    return NextResponse.json(result);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
