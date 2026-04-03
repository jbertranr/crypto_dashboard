import { NextRequest, NextResponse } from "next/server";
import { placeOcoOrder, getTickerPrice, roundQty } from "../../../lib/binance-auth";
import { trailingSet, cacheGet, orderMetaSet, nextTradeCode } from "../../../lib/cache-store";
import { ensureTrailingEngine } from "../../../lib/trailing-engine";
import { apiError } from "../../../lib/api-error";
import { log } from "../../../lib/logger";
import { settingGetBool, settingGet } from "../../../lib/settings-store";
import { notifyNewOrder } from "../../../lib/telegram";
import { journalAdd, journalPatchTpSl } from "../../../lib/journal-store";

export async function POST(req: NextRequest) {
  try {
    const { symbol, side, quantity, tpPrice, slStopPrice, slLimitPrice, trailing, interval, botName } = await req.json();

    if (!Number.isFinite(Number(tpPrice))    || Number(tpPrice)    <= 0) throw new Error(`tpPrice invàlid: ${tpPrice}`);
    if (!Number.isFinite(Number(slStopPrice)) || Number(slStopPrice) <= 0) throw new Error(`slStopPrice invàlid: ${slStopPrice}`);
    if (!Number.isFinite(Number(slLimitPrice)) || Number(slLimitPrice) <= 0) throw new Error(`slLimitPrice invàlid: ${slLimitPrice}`);
    if (Number(slLimitPrice) > Number(slStopPrice)) throw new Error(`slLimitPrice (${slLimitPrice}) ha de ser ≤ slStopPrice (${slStopPrice})`);

    // Arrodonir la quantitat al stepSize del symbol per evitar "Invalid quantity" de Binance
    const exInfo   = cacheGet<{ stepSize: string }>(`exchange-info:${symbol}`);
    const stepSize = exInfo?.data.stepSize ?? "0.00001";
    const roundedQty = roundQty(parseFloat(String(quantity)), stepSize);

    const result = await placeOcoOrder({ symbol, side, quantity: roundedQty, tpPrice, slStopPrice, slLimitPrice }) as Record<string, unknown>;
    log.orders.info({ symbol, side, quantity: roundedQty, tpPrice, slStopPrice, orderListId: result.orderListId }, "OCO col·locada");

    // Desa el timeframe d'entrada i genera el codi de trade
    let tradeCode: string | null = null;
    if (typeof result.orderListId === "number" && result.orderListId > 0) {
      tradeCode = nextTradeCode();
      orderMetaSet(`oco:${result.orderListId}`, { interval: interval ?? null, tradeCode, botName: botName ?? null, entrySource: "MANUAL" });
    }

    if (settingGetBool("tg_on_new_order")) {
      notifyNewOrder({
        symbol, type: "OCO",
        quantity: roundedQty,
        tpPrice:     String(tpPrice),
        slStopPrice: String(slStopPrice),
        orderListId: typeof result.orderListId === "number" ? result.orderListId : -1,
      }).catch(err => log.orders.warn({ err: (err as Error).message }, "notifyNewOrder fallida"));
    }
    // --- Journal: record OCO entry ---
    try {
      const entryPx = await getTickerPrice(symbol).catch(() => 0);
      const jId = journalAdd({
        type: "ENTRY_OCO",
        symbol, side,
        qty:             roundedQty,
        price:           String(tpPrice),
        quoteQty:        String(parseFloat(roundedQty) * (entryPx || tpPrice)),
        commission:      "0",
        commissionAsset: "BNB",
        entryPrice:      entryPx ? String(entryPx) : null,
        pnlUsdt:         null,
        pnlPct:          null,
        orderId:         null,
        orderListId:     typeof result.orderListId === "number" ? result.orderListId : null,
        strategy:        null,
        interval:        null,
        entryType:       settingGet("entry_type"),
        trailingMode:    trailing ? settingGet("trailing_sl_mode") : null,
        exitReason:      null,
        capitalUsdt:     parseFloat(settingGet("capital_fixed_usdt") || "100"),
        capitalMode:     settingGet("capital_mode"),
        notes:           null,
        tradeCode,
        source:          "AUTO",
        trailingActivateAt: trailing?.activateAt ?? null,
        executedAt:      Date.now(),
      });
      journalPatchTpSl(jId, parseFloat(String(tpPrice)), parseFloat(String(slStopPrice)));
    } catch (je) {
      log.orders.warn({ err: (je as Error).message }, "journal entry fallida");
    }

    if (trailing && typeof result.orderListId === "number" && result.orderListId !== -1) {
      const cached    = cacheGet<{ tickSize: string }>(`exchange-info:${symbol}`);
      const tickSize  = cached?.data.tickSize ?? "0.01";
      const entryPrice = await getTickerPrice(symbol);
      trailingSet(result.orderListId, {
        symbol, ...trailing,
        quantity: roundedQty, side, tickSize, entryPrice,
      });
      ensureTrailingEngine();
    }
    return NextResponse.json(result);
  } catch (e) {
    return apiError(e, "orders/new");
  }
}
