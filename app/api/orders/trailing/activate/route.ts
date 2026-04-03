import { NextRequest, NextResponse } from "next/server";
import {
  cancelOcoOrder, getTickerPrice, placeStopLossLimitOrder, roundPrice,
} from "../../../../lib/binance-auth";
import { trailingActiveCreate, trailingDelete, orderMetaGet, orderMetaSet } from "../../../../lib/cache-store";
import { ensureTrailingEngine } from "../../../../lib/trailing-engine";
import { apiError } from "../../../../lib/api-error";
import { log } from "../../../../lib/logger";

export async function POST(req: NextRequest) {
  try {
    const { orderListId, symbol, side, quantity, trailDist, tickSize, entryPrice } =
      await req.json() as {
        orderListId: number; symbol: string; side: "SELL" | "BUY";
        quantity: string; trailDist: number; tickSize: string; entryPrice?: number;
      };

    // 1. Cancel the OCO (removes both TP and SL legs)
    // -2011: OCO ja no existeix (ja executada o cancel·lada) → no cal activar el trailing
    try {
      await cancelOcoOrder(symbol, orderListId);
    } catch (e) {
      const msg = (e as Error).message ?? "";
      if (msg.includes("-2011") || msg.includes("Unknown order list")) {
        log.orders.warn({ symbol, orderListId }, "trailing/activate: OCO ja no existia — cancel·lant suggeriment");
        trailingDelete(orderListId);
        return NextResponse.json({ ok: false, alreadyGone: true, reason: "OCO already filled or cancelled" });
      }
      throw e;
    }

    // 2. Get current price for initial SL placement
    const price = await getTickerPrice(symbol);

    // 3. Place SL only — TP is not re-placed; trailing SL handles the full exit
    const initialSl    = side === "SELL" ? price - trailDist : price + trailDist;
    const initialLimit = side === "SELL" ? initialSl * 0.999  : initialSl * 1.001;

    const slOrd = await placeStopLossLimitOrder({
      symbol, side, quantity,
      stopPrice:  roundPrice(initialSl,    tickSize),
      limitPrice: roundPrice(initialLimit, tickSize),
    }) as { orderId: number };

    log.orders.info({ symbol, side, quantity, entryPrice: price, initialSl, slOrderId: slOrd.orderId }, "trailing activat manualment");

    // 4. Save to SQLite and start engine
    const id = trailingActiveCreate({
      symbol, side, quantity,
      tpOrderId: -1, slOrderId: slOrd.orderId,
      currentSl: initialSl, trailDist, peakPrice: price,
      entryPrice: entryPrice ?? price, tickSize,
      originOcoListId: orderListId,
      ocoCreatedAt: Date.now(),
    });

    // 5. Propagate tradeCode (and interval/botName) from the original OCO to the new SL order
    const ocoMeta = orderMetaGet(`oco:${orderListId}`);
    if (ocoMeta?.tradeCode) {
      orderMetaSet(`ord:${slOrd.orderId}`, {
        tradeCode: ocoMeta.tradeCode,
        ...(ocoMeta.interval  ? { interval:  ocoMeta.interval  } : {}),
        ...(ocoMeta.botName   ? { botName:   ocoMeta.botName   } : {}),
      });
    }

    // 6. Remove from suggestions (won't auto-activate again)
    trailingDelete(orderListId);

    ensureTrailingEngine();

    return NextResponse.json({ ok: true, id, initialSl, slOrderId: slOrd.orderId });
  } catch (e) {
    return apiError(e, "orders/trailing/activate");
  }
}
