import { NextResponse } from "next/server";
import { getOpenOrders } from "../../lib/binance-auth";

export async function GET() {
  try {
    const orders = await getOpenOrders();
    return NextResponse.json(orders);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
