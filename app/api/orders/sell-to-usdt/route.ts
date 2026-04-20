import { NextRequest, NextResponse } from "next/server";
import { guardRealFromLocalhost } from "../../../lib/real-guard";
import { placeMarketSell } from "../../../lib/binance-auth";
import { cacheGet, cacheSet } from "../../../lib/cache-store";
import { apiError } from "../../../lib/api-error";
import { log } from "../../../lib/logger";
import { settingGetBoolForMode, settingGet, getQuoteAsset } from "../../../lib/settings-store";
import { notifyOrderSold } from "../../../lib/telegram";
import { journalAdd, journalGetLastTradeCode } from "../../../lib/journal-store";

interface BinanceFilter { filterType: string; stepSize?: string; minQty?: string; }

async function getStepSize(symbol: string): Promise<{ stepSize: string; minQty: string }> {
  const KEY = `exchange-info:${symbol}`;
  const cached = cacheGet<{ stepSize: string; minQty: string }>(KEY);
  if (cached) return cached.data;

  const res = await fetch(`https://api.binance.com/api/v3/exchangeInfo?symbol=${symbol}`);
  if (!res.ok) return { stepSize: "0.00000001", minQty: "0.00000001" };
  const data = await res.json();
  const filters: BinanceFilter[] = data.symbols?.[0]?.filters ?? [];
  const lot = filters.find(f => f.filterType === "LOT_SIZE");
  const result = { stepSize: lot?.stepSize ?? "0.00000001", minQty: lot?.minQty ?? "0.00000001" };
  cacheSet(KEY, result, 86400);
  return result;
}

export async function POST(req: NextRequest) {
  try {
    const { asset, quantity, mode: rawMode } = await req.json() as { asset: string; quantity: string; mode?: string };
    const mode = rawMode === "real" ? "real" : "paper" as const;
    const guard = guardRealFromLocalhost(req, mode); if (guard) return guard;
    const symbol = `${asset}${getQuoteAsset()}`;

    const { stepSize, minQty } = await getStepSize(symbol);

    // Compute decimal places from stepSize string (e.g. "0.001" → 3)
    const stepDp = stepSize.includes(".")
      ? stepSize.trimEnd().replace(/0+$/, "").length - stepSize.indexOf(".") - 1
      : 0;

    const qty = parseFloat(quantity);

    // Truncate using integer math to avoid floating-point drift
    const factor     = Math.pow(10, stepDp);
    const roundedQty = (Math.floor(qty * factor) / factor).toFixed(stepDp);

    if (parseFloat(roundedQty) < parseFloat(minQty))
      throw new Error(`Quantitat insuficient per vendre (${roundedQty} ${asset}, mínim ${minQty})`);

    const result = await placeMarketSell(symbol, roundedQty, mode);
    const fillPrice = parseFloat(result.cummulativeQuoteQty) / parseFloat(result.executedQty);

    log.orders.info({ symbol, qty: roundedQty, fillPrice, orderId: result.orderId }, "market sell → USDC");

    // --- Journal: record market sell exit ---
    try {
      const tradeCode = journalGetLastTradeCode(symbol, 48 * 3600 * 1000, mode);
      journalAdd({
        type:            "EXIT_MARKET",
        symbol,
        side:            "SELL",
        qty:             result.executedQty,
        price:           String(fillPrice),
        quoteQty:        result.cummulativeQuoteQty,
        commission:      "0",
        commissionAsset: "BNB",
        entryPrice:      null,
        pnlUsdt:         null,
        pnlPct:          null,
        orderId:         result.orderId ?? null,
        orderListId:     null,
        strategy:        null,
        interval:        null,
        entryType:       null,
        trailingMode:    null,
        exitReason:      "MARKET_SELL",
        capitalUsdt:     parseFloat(result.cummulativeQuoteQty),
        capitalMode:     settingGet("capital_mode"),
        notes:           null,
        tradeCode,
        source:          "AUTO",
        mode,
        executedAt:      Date.now(),
      });
    } catch (je) {
      log.orders.warn({ err: (je as Error).message }, "journal sell-to-usdc fallida");
    }

    if (settingGetBoolForMode("tg_on_order_close", mode)) {
      notifyOrderSold({
        symbol,
        executedQty:  result.executedQty,
        receivedUSDT: result.cummulativeQuoteQty,
        fillPrice,
      }).catch(() => {});
    }

    return NextResponse.json({
      ok: true,
      orderId: result.orderId,
      executedQty: result.executedQty,
      receivedUSDT: result.cummulativeQuoteQty,
      fillPrice,
    });
  } catch (e) {
    return apiError(e, "orders/sell-to-usdt");
  }
}
