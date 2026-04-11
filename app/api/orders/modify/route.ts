import { NextRequest, NextResponse } from "next/server";
import { modifyOrder } from "../../../lib/binance-auth";
import { apiError } from "../../../lib/api-error";
import { log } from "../../../lib/logger";
import { settingGetBool } from "../../../lib/settings-store";
import { notifySlModified } from "../../../lib/telegram";

export async function POST(req: NextRequest) {
  try {
    const { symbol, orderId, side, quantity, price, stopPrice, mode: rawMode } = await req.json();
    const mode = rawMode === "real" ? "real" : "paper" as const;
    const result = await modifyOrder(symbol, orderId, side, quantity, price, stopPrice, mode);
    log.orders.info({ symbol, orderId, side, price, stopPrice }, "ordre modificada");

    if (stopPrice && settingGetBool("tg_on_sl_modify")) {
      notifySlModified({
        symbol,
        newSlStop:  String(stopPrice),
        newSlLimit: String(price),
        orderId,
      }).catch(() => {});
    }

    return NextResponse.json(result);
  } catch (e) {
    return apiError(e, "orders/modify");
  }
}
