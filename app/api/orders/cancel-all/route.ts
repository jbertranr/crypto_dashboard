import { NextRequest, NextResponse } from "next/server";
import {
  getOpenOrders, cancelOrder, cancelOcoOrder,
  getAccount, placeMarketSell, roundPriceDown,
} from "../../../lib/binance-auth";
import { cacheGet } from "../../../lib/cache-store";
import { apiError } from "../../../lib/api-error";
import { log } from "../../../lib/logger";
import { sendTelegram } from "../../../lib/telegram";

// Stablecoins and quote assets we never sell
const NEVER_SELL = new Set(["USDT", "BUSD", "USDC", "FDUSD", "TUSD", "BNB"]);

export async function POST(req: NextRequest) {
  const { sellAll = false } = await req.json().catch(() => ({})) as { sellAll?: boolean };

  try {
    /* ── 1. Cancel all open orders ── */
    const orders = await getOpenOrders();
    const canceledOcos = new Set<number>();
    const cancelResults: { type: string; id: number | string; symbol: string }[] = [];

    for (const order of orders) {
      try {
        if (order.orderListId !== -1) {
          if (!canceledOcos.has(order.orderListId)) {
            canceledOcos.add(order.orderListId);
            await cancelOcoOrder(order.symbol, order.orderListId);
            cancelResults.push({ type: "oco", id: order.orderListId, symbol: order.symbol });
          }
        } else {
          await cancelOrder(order.symbol, order.orderId);
          cancelResults.push({ type: "order", id: order.orderId, symbol: order.symbol });
        }
      } catch (e) {
        // Log but continue — order may have already been filled
        log.orders.warn({ orderId: order.orderId, err: (e as Error).message }, "cancel-all: error cancel·lant ordre");
      }
    }

    log.orders.warn({ canceled: cancelResults.length, sellAll }, "⚠️ Cancel·lació massiva d'ordres");

    /* ── 2. Market sell all crypto positions (optional) ── */
    const sellResults: { symbol: string; qty: string; quoteQty: string }[] = [];

    if (sellAll) {
      // Wait briefly so cancelled orders release locked balances
      await new Promise(r => setTimeout(r, 1500));

      const account = await getAccount();
      const crypto = account.balances.filter(b => {
        const free = parseFloat(b.free);
        return free > 0 && !NEVER_SELL.has(b.asset);
      });

      for (const bal of crypto) {
        const symbol = `${bal.asset}USDT`;
        try {
          // Get step size for quantity rounding
          const exInfo = cacheGet<{ stepSize: string }>(`exchange-info:${symbol}`);
          const stepSize = exInfo?.data.stepSize ?? "0.001";
          const qty = roundPriceDown(parseFloat(bal.free), stepSize);
          if (parseFloat(qty) <= 0) continue;

          const result = await placeMarketSell(symbol, qty);
          sellResults.push({ symbol, qty, quoteQty: result.cummulativeQuoteQty });
          log.orders.warn({ symbol, qty, quoteQty: result.cummulativeQuoteQty }, "⚠️ Venda d'emergència executada");
        } catch (e) {
          log.orders.error({ symbol, err: (e as Error).message }, "cancel-all: error venent posició");
        }
      }
    }

    /* ── 3. Telegram notification ── */
    const soldSummary = sellResults.length > 0
      ? `\n\n💸 Vendes executades:\n${sellResults.map(s => `• ${s.symbol}: ${s.qty} → ${parseFloat(s.quoteQty).toFixed(2)} USDT`).join("\n")}`
      : "";

    await sendTelegram(
      `🚨 BOTÓ DE PÀNIC ACTIVAT\n\n` +
      `Ordres cancel·lades: ${cancelResults.length}\n` +
      `Venda total: ${sellAll ? "SÍ" : "NO"}` +
      soldSummary
    ).catch(() => {}); // don't fail if Telegram is down

    return NextResponse.json({
      ok: true,
      canceledOrders: cancelResults.length,
      soldPositions: sellResults.length,
      sells: sellResults,
    });
  } catch (e) {
    return apiError(e, "orders/cancel-all");
  }
}
