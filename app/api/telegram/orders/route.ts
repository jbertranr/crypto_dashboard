import { NextResponse } from "next/server";
import { getOpenOrders } from "../../../lib/binance-auth";
import { sendOpenOrdersReport, isConfigured } from "../../../lib/telegram";
import { apiError } from "../../../lib/api-error";

export async function POST() {
  if (!isConfigured()) {
    return NextResponse.json(
      { error: "Telegram no configurat" },
      { status: 503 }
    );
  }
  try {
    const orders = await getOpenOrders();
    await sendOpenOrdersReport(orders);
    return NextResponse.json({ ok: true, count: orders.length });
  } catch (e) {
    return apiError(e, "telegram/orders");
  }
}
