import { NextResponse } from "next/server";
import { getOpenOrders } from "../../lib/binance-auth";
import { ensureOrderMonitor } from "../../lib/order-monitor";
import { ensureScheduler }    from "../../lib/scheduler";
import { ensureCrashMonitor } from "../../lib/crash-monitor";
import { ensureAutoTrader }   from "../../lib/auto-trader";
import { apiError } from "../../lib/api-error";
import { log } from "../../lib/logger";

export async function GET() {
  ensureOrderMonitor();
  ensureScheduler();
  ensureCrashMonitor();
  ensureAutoTrader();
  try {
    const orders = await getOpenOrders();
    log.binance.debug({ count: orders.length }, "open orders");
    return NextResponse.json(orders);
  } catch (e) {
    return apiError(e, "orders");
  }
}
