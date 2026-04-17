import { NextRequest, NextResponse } from "next/server";
import { placeMarketBuy, placeOcoOrder, getTickerPrice, roundPriceUp, roundPriceDown, type TradingMode } from "../../../lib/binance-auth";
import { guardRealFromLocalhost } from "../../../lib/real-guard";
import { trailingSet, cacheGet, nextTradeCode, orderMetaSet } from "../../../lib/cache-store";
import { ensureTrailingEngine } from "../../../lib/trailing-engine";
import { apiError } from "../../../lib/api-error";
import { log } from "../../../lib/logger";
import { settingGetBool, settingGet } from "../../../lib/settings-store";
import { notifyNewOrder } from "../../../lib/telegram";
import { journalAdd, journalPatchTpSl } from "../../../lib/journal-store";

export async function POST(req: NextRequest) {
  try {
    const { symbol, quoteOrderQty, tpPrice: tpTarget, slPrice: slTarget, trailing, botName, mode: rawMode } = await req.json() as {
      symbol: string;
      quoteOrderQty: string;
      tpPrice: number;
      slPrice: number;
      botName?: string | null;
      mode?: string;
      trailing?: {
        activateAt: number; distance: number;
        activateAtr: number; distanceAtr: number; logic: string;
      };
    };
    const mode: TradingMode = rawMode === "real" ? "real" : "paper";
    const guard = guardRealFromLocalhost(req, mode); if (guard) return guard;

    // 1. Market buy
    const buyResult = await placeMarketBuy(symbol, quoteOrderQty, mode);
    const executedQty = buyResult.executedQty;
    const fillPrice = parseFloat(buyResult.cummulativeQuoteQty) / parseFloat(executedQty);

    // Subtract commission paid in the base asset so OCO qty ≤ actual free balance
    // (Binance sometimes deducts fee from the received coin, not BNB)
    const baseAsset = symbol.replace(/USDT$|BUSD$|USDC$|FDUSD$|TUSD$|BTC$|ETH$|BNB$/, "");
    const commissionInBase = (buyResult.fills ?? [])
      .filter(f => f.commissionAsset === baseAsset)
      .reduce((sum, f) => sum + parseFloat(f.commission), 0);

    // 2. Get tickSize / stepSize (cached 24h by exchange-info route)
    const cached = cacheGet<{ tickSize: string; stepSize: string }>(`exchange-info:${symbol}`);
    let tickSize = "0.01";
    let stepSize = "1";
    if (cached) {
      tickSize = cached.data.tickSize ?? tickSize;
      stepSize = cached.data.stepSize ?? stepSize;
    } else {
      // Fallback: fetch directly (also populates cache for next call)
      const infoRes = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"}/api/exchange-info?symbol=${symbol}`);
      const info = await infoRes.json() as { tickSize?: string; stepSize?: string };
      if (info.tickSize) tickSize = info.tickSize;
      if (info.stepSize) stepSize = info.stepSize;
    }

    // Net quantity after base-asset commission, rounded DOWN to stepSize.
    // Also strip trailing decimal zeros so the OCO endpoint doesn't reject
    // "228.00000000" for a symbol with stepSize="1" (LOT_SIZE filter).
    const netQty  = parseFloat(executedQty) - commissionInBase;
    const stepNum = parseFloat(stepSize);
    const stepDp  = stepSize.includes(".") ? stepSize.length - stepSize.indexOf(".") - 1 : 0;
    const ocoQty  = (Math.floor(netQty / stepNum) * stepNum).toFixed(stepDp);

    // 3. Validate incoming prices (coerce to number defensively)
    const tpNum = Number(tpTarget);
    const slNum = Number(slTarget);
    if (!Number.isFinite(tpNum) || tpNum <= 0)
      throw new Error(`tpPrice invàlid rebut del client: ${tpTarget}`);
    if (!Number.isFinite(slNum) || slNum <= 0)
      throw new Error(`slPrice invàlid rebut del client: ${slTarget}`);

    // 4. Calculate OCO prices
    // Use the exact prices from the analysis. Only adjust if the market has already moved
    // past them (Binance rejects TP below current price or SL above current price).
    const currentPrice = await getTickerPrice(symbol, mode);
    if (!Number.isFinite(currentPrice) || currentPrice <= 0)
      throw new Error(`Preu actual invàlid de Binance: ${currentPrice}`);

    const tickNum = parseFloat(tickSize);

    // TP must be strictly above currentPrice. Use analysis target; push up only if needed.
    const tpPrice = roundPriceUp(Math.max(tpNum, currentPrice + 2 * tickNum), tickSize);

    // SL must be strictly below currentPrice. Use analysis target; push down only if needed.
    const slStopPrice  = roundPriceDown(Math.min(slNum, currentPrice - 2 * tickNum), tickSize);
    const slLimitPrice = roundPriceDown(parseFloat(slStopPrice) * 0.999, tickSize);

    log.orders.debug({ fillPrice, currentPrice, tpTarget: tpNum, slTarget: slNum, tpPrice, slStopPrice, slLimitPrice }, "OCO preus calculats");

    // Final sanity check
    if (parseFloat(tpPrice) <= currentPrice)
      throw new Error(`TP (${tpPrice}) ha de ser > preu actual (${currentPrice})`);
    if (parseFloat(slStopPrice) >= currentPrice)
      throw new Error(`SL stop (${slStopPrice}) ha de ser < preu actual (${currentPrice})`);
    if (parseFloat(slLimitPrice) > parseFloat(slStopPrice))
      throw new Error(`SL limit (${slLimitPrice}) ha de ser ≤ SL stop (${slStopPrice})`);

    // 5. Place SELL OCO
    const ocoResult = await placeOcoOrder({
      symbol, side: "SELL", quantity: ocoQty,
      tpPrice, slStopPrice, slLimitPrice,
    }, mode) as Record<string, unknown>;

    log.orders.info({ symbol, side: "SELL", fillPrice, quantity: ocoQty, commissionInBase, tpPrice, slStopPrice, buyOrderId: buyResult.orderId, ocoOrderListId: ocoResult.orderListId }, "compra de mercat + OCO");

    if (settingGetBool("tg_on_new_order")) {
      notifyNewOrder({
        symbol, type: "BUY_AND_EXIT",
        quoteQty:   parseFloat(quoteOrderQty),
        fillPrice,
        tpPrice,
        slStopPrice,
        orderListId: typeof ocoResult.orderListId === "number" ? ocoResult.orderListId : -1,
      }).catch(() => {});
    }

    // 5. Generate tradeCode and store metadata for linking
    let tradeCode: string | null = null;
    if (typeof ocoResult.orderListId === "number" && ocoResult.orderListId > 0) {
      tradeCode = nextTradeCode();
      orderMetaSet(`oco:${ocoResult.orderListId}`, { tradeCode, botName: botName ?? null, entrySource: "MANUAL" });
    }

    // 6. Save trailing suggestion if provided (with all fields for auto-activation)
    if (trailing && typeof ocoResult.orderListId === "number" && ocoResult.orderListId !== -1) {
      trailingSet(ocoResult.orderListId, {
        symbol, ...trailing,
        quantity: ocoQty, side: "SELL", tickSize, entryPrice: fillPrice,
      });
      ensureTrailingEngine();
    }

    // --- Journal: record market buy entry + OCO exit ---
    try {
      const buyUsdt = parseFloat(quoteOrderQty);
      const jId = journalAdd({
        type:            "ENTRY_BUY",
        symbol,
        side:            "BUY",
        qty:             ocoQty,
        price:           String(fillPrice),
        quoteQty:        String(buyUsdt),
        commission:      "0",
        commissionAsset: "BNB",
        entryPrice:      null,
        pnlUsdt:         null,
        pnlPct:          null,
        orderId:         buyResult.orderId ?? null,
        orderListId:     typeof ocoResult.orderListId === "number" ? ocoResult.orderListId : null,
        strategy:        null,
        interval:        null,
        entryType:       "MARKET",
        trailingMode:       trailing ? settingGet("trailing_sl_mode") : null,
        exitReason:         null,
        capitalUsdt:        buyUsdt,
        capitalMode:        settingGet("capital_mode"),
        notes:              null,
        tradeCode,
        source:             "MANUAL",
        mode,
        trailingActivateAt: trailing?.activateAt ?? null,
        executedAt:         Date.now(),
      });
      journalPatchTpSl(jId, parseFloat(tpPrice), parseFloat(slStopPrice));
    } catch (je) {
      log.orders.warn({ err: (je as Error).message }, "journal buy-and-exit entry fallida");
    }

    return NextResponse.json({
      ok: true,
      buyOrderId: buyResult.orderId,
      ocoOrderListId: ocoResult.orderListId,
      fillPrice,
      tpPrice,
      slStopPrice,
      quantity: ocoQty,
    });
  } catch (e) {
    return apiError(e, "orders/buy-and-exit");
  }
}
