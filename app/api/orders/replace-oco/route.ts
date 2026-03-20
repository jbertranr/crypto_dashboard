import { NextRequest, NextResponse } from "next/server";
import { cancelOcoOrder, placeOcoOrder } from "../../../lib/binance-auth";
import { apiError } from "../../../lib/api-error";
import { log } from "../../../lib/logger";
import { settingGetBool } from "../../../lib/settings-store";
import { notifySlModified } from "../../../lib/telegram";

export async function POST(req: NextRequest) {
  try {
    const { symbol, orderListId, side, quantity, tpPrice, slStopPrice, slLimitPrice } = await req.json();
    await cancelOcoOrder(symbol, orderListId);
    const result = await placeOcoOrder({ symbol, side, quantity, tpPrice, slStopPrice, slLimitPrice }) as Record<string, unknown>;
    log.orders.info({ symbol, side, oldListId: orderListId, newListId: result.orderListId, tpPrice, slStopPrice }, "OCO substituïda");

    if (settingGetBool("tg_on_sl_modify")) {
      notifySlModified({
        symbol,
        newSlStop:  String(slStopPrice),
        newSlLimit: String(slLimitPrice),
        tpPrice:    String(tpPrice),
        orderListId: typeof result.orderListId === "number" ? result.orderListId : -1,
      }).catch(() => {});
    }

    return NextResponse.json(result);
  } catch (e) {
    return apiError(e, "orders/replace-oco");
  }
}
