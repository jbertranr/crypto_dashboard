import { NextResponse } from "next/server";
import { getOpenOrders } from "../../lib/binance-auth";
import { ensureOrderMonitor } from "../../lib/order-monitor";
import { ensureScheduler }    from "../../lib/scheduler";
import { ensureCrashMonitor } from "../../lib/crash-monitor";
import { ensureAutoTrader }   from "../../lib/auto-trader";
import { db, orderMetaGet } from "../../lib/cache-store";
import { apiError } from "../../lib/api-error";
import { log } from "../../lib/logger";

export async function GET() {
  ensureOrderMonitor();
  ensureScheduler();
  ensureCrashMonitor();
  ensureAutoTrader();
  try {
    const orders = await getOpenOrders();

    // Trailing actius: sl_order_id → { originOcoListId, slUpdateCount }
    const trailingRows = db.prepare(
      "SELECT sl_order_id, origin_oco_list_id, sl_update_count FROM trailing_active WHERE status = 'active'"
    ).all() as Array<{ sl_order_id: number; origin_oco_list_id: number | null; sl_update_count: number }>;
    const trailingMap = new Map(trailingRows.map(r => [r.sl_order_id, {
      originOcoListId: r.origin_oco_list_id ?? null,
      slUpdateCount:   r.sl_update_count,
    }]));

    const enriched = orders.map(o => {
      const td              = trailingMap.get(o.orderId) ?? null;
      const isTrailingSl    = td != null;
      const originOcoListId = td?.originOcoListId ?? null;
      const slUpdateCount   = td?.slUpdateCount   ?? null;
      const metaKey = o.orderListId !== -1
        ? `oco:${o.orderListId}`
        : originOcoListId != null ? `oco:${originOcoListId}` : null;
      const meta = metaKey ? orderMetaGet(metaKey) : null;
      return {
        ...o,
        isTrailingSl,
        originOcoListId,
        slUpdateCount,
        botName:   meta?.botName   ?? null,
        tradeCode: meta?.tradeCode ?? null,
      };
    });

    log.binance.debug({ count: orders.length }, "open orders");
    return NextResponse.json(enriched);
  } catch (e) {
    return apiError(e, "orders");
  }
}
