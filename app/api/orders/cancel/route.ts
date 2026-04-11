import { NextRequest, NextResponse } from "next/server";
import { cancelOrder, cancelOcoOrder, placeMarketSell, getTickerPrice } from "../../../lib/binance-auth";
import { apiError } from "../../../lib/api-error";
import { journalAdd } from "../../../lib/journal-store";
import { orderMetaGet } from "../../../lib/cache-store";
import { notifyOrderCancel, notifyOrderFill } from "../../../lib/telegram";
import { log } from "../../../lib/logger";

export async function POST(req: NextRequest) {
  try {
    const { symbol, orderId, orderListId, side, origQty, price, type, sellAtMarket, mode: rawMode } = await req.json();
    const mode = rawMode === "real" ? "real" : "paper" as const;
    let result;
    if (orderListId != null && orderListId !== -1) {
      try {
        result = await cancelOcoOrder(symbol, orderListId, mode);
        log.orders.info({ symbol, orderListId }, "OCO cancel·lada");
      } catch (e) {
        const msg = (e as Error).message ?? "";
        // -2011: OCO ja no existeix (ja executada o cancel·lada) → tractar com a èxit
        if (msg.includes("-2011") || msg.includes("Unknown order list")) {
          log.orders.warn({ symbol, orderListId }, "OCO ja no existia en cancel·lar — ignorat");
          return NextResponse.json({ ok: true, alreadyGone: true });
        }
        throw e;
      }
    } else {
      try {
        result = await cancelOrder(symbol, orderId, mode);
        log.orders.info({ symbol, orderId }, "ordre cancel·lada");
      } catch (e) {
        const msg = (e as Error).message ?? "";
        // -2011: ordre ja no existeix
        if (msg.includes("-2011") || msg.includes("Unknown order")) {
          log.orders.warn({ symbol, orderId }, "ordre ja no existia en cancel·lar — ignorat");
          return NextResponse.json({ ok: true, alreadyGone: true });
        }
        throw e;
      }
    }

    // ── Journal + Telegram for the cancellation ─────────────────────────────
    if (side != null && origQty != null) {
      const numQty   = parseFloat(String(origQty));
      const numPrice = parseFloat(String(price)) || 0;
      const tradeCode = orderListId != null && orderListId !== -1
        ? (orderMetaGet(`oco:${orderListId}`)?.tradeCode ?? null)
        : null;

      // ── Optional: market sell to convert position to USDT ────────────────
      if (sellAtMarket && side === "SELL" && numQty > 0) {
        try {
          const sellResult = await placeMarketSell(symbol, String(numQty), mode);
          const execQty    = parseFloat(sellResult.executedQty);
          const execValue  = parseFloat(sellResult.cummulativeQuoteQty);
          const execPrice  = execQty > 0 ? execValue / execQty : 0;

          // Telegram for the market sell
          notifyOrderFill({
            symbol, side: "SELL", type: "MARKET",
            execPrice, origQty: execQty, execValue,
            orderListId: orderListId != null && orderListId !== -1 ? orderListId : -1,
          }).catch(e => log.orders.warn({ err: (e as Error).message }, "telegram sell fallida"));

          // Journal: EXIT_MARKET
          try {
            journalAdd({
              type:            "EXIT_MARKET",
              symbol,
              side:            "SELL",
              qty:             String(execQty),
              price:           String(execPrice),
              quoteQty:        String(execValue),
              commission:      "0",
              commissionAsset: "BNB",
              entryPrice:      numPrice > 0 ? String(numPrice) : null,
              pnlUsdt:         null,
              pnlPct:          null,
              orderId:         sellResult.orderId > 0 ? sellResult.orderId : null,
              orderListId:     orderListId != null && orderListId !== -1 ? orderListId : null,
              strategy:        null,
              interval:        null,
              entryType:       type ?? null,
              trailingMode:    null,
              exitReason:      "CANCELED",
              capitalUsdt:     null,
              capitalMode:     null,
              notes:           null,
              tradeCode,
              source:          "MANUAL",
              executedAt:      Date.now(),
            });
          } catch (je) {
            log.orders.warn({ err: (je as Error).message }, "journal sell-after-cancel fallida");
          }

          log.orders.info({ symbol, execQty, execValue }, "market sell after cancel OK");
          const r = result as Record<string, unknown>;
          return NextResponse.json({ ...r, marketSell: { execQty, execValue, execPrice } });
        } catch (se) {
          log.orders.error({ err: (se as Error).message }, "market sell after cancel FAILED");
          const r = result as Record<string, unknown>;
          return NextResponse.json({ ...r, sellError: (se as Error).message });
        }
      }

      // Telegram (non-blocking)
      notifyOrderCancel({
        symbol,
        side:        side as "BUY" | "SELL",
        type:        type ?? "LIMIT",
        origQty:     numQty,
        price:       numPrice,
        orderId:     orderId > 0 ? orderId : undefined,
        orderListId: orderListId != null && orderListId !== -1 ? orderListId : undefined,
      }).catch(e => log.orders.warn({ err: (e as Error).message }, "telegram cancel fallida"));

      try {
        journalAdd({
          type:            "CANCELED",
          symbol,
          side:            side as "BUY" | "SELL",
          qty:             String(numQty),
          price:           numPrice > 0 ? String(numPrice) : "0",
          quoteQty:        "0",
          commission:      "0",
          commissionAsset: "BNB",
          entryPrice:      null,
          pnlUsdt:         null,
          pnlPct:          null,
          orderId:         orderId > 0 ? orderId : null,
          orderListId:     orderListId != null && orderListId !== -1 ? orderListId : null,
          strategy:        null,
          interval:        null,
          entryType:       type ?? null,
          trailingMode:    null,
          exitReason:      "CANCELED",
          capitalUsdt:     null,
          capitalMode:     null,
          notes:           null,
          tradeCode,
          source:          "MANUAL",
          executedAt:      Date.now(),
        });
      } catch (je) {
        log.orders.warn({ err: (je as Error).message }, "journal cancel fallida");
      }
    }

    return NextResponse.json(result);
  } catch (e) {
    return apiError(e, "orders/cancel");
  }
}
