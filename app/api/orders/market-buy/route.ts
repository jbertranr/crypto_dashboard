import { NextRequest, NextResponse } from "next/server";
import { placeMarketBuy } from "../../../lib/binance-auth";
import { apiError } from "../../../lib/api-error";
import { log } from "../../../lib/logger";
import { journalAdd } from "../../../lib/journal-store";
import { nextTradeCode } from "../../../lib/cache-store";
import { settingGet } from "../../../lib/settings-store";

export async function POST(req: NextRequest) {
  try {
    const { symbol, quoteOrderQty } = await req.json() as {
      symbol: string;
      quoteOrderQty: string;
    };

    const buyResult = await placeMarketBuy(symbol, quoteOrderQty);
    const executedQty = buyResult.executedQty;
    const fillPrice   = parseFloat(buyResult.cummulativeQuoteQty) / parseFloat(executedQty);
    const buyUsdt     = parseFloat(quoteOrderQty);

    log.orders.info({ symbol, fillPrice, executedQty }, "compra a mercat sense sortida automàtica");

    try {
      const tradeCode = nextTradeCode();
      journalAdd({
        type:            "ENTRY_BUY",
        symbol,
        side:            "BUY",
        qty:             executedQty,
        price:           String(fillPrice),
        quoteQty:        String(buyUsdt),
        commission:      "0",
        commissionAsset: "BNB",
        entryPrice:      null,
        pnlUsdt:         null,
        pnlPct:          null,
        orderId:         buyResult.orderId ?? null,
        orderListId:     null,
        strategy:        null,
        interval:        null,
        entryType:       "MARKET",
        trailingMode:    null,
        exitReason:      null,
        capitalUsdt:     buyUsdt,
        capitalMode:     settingGet("capital_mode"),
        notes:           "Compra manual sense sortida automàtica",
        tradeCode,
        source:          "AUTO",
        trailingActivateAt: null,
        executedAt:      Date.now(),
      });
    } catch (je) {
      log.orders.warn({ err: (je as Error).message }, "journal market-buy entry fallida");
    }

    return NextResponse.json({
      ok: true,
      buyOrderId: buyResult.orderId,
      fillPrice,
      executedQty,
    });
  } catch (e) {
    return apiError(e, "orders/market-buy");
  }
}
