import {
  trailingActiveGetAll, trailingActiveUpdateSl, trailingActiveSetStatus, TrailingActive,
  trailingGetAll, trailingActiveCreate, trailingDelete, cacheGet, orderMetaGet, orderMetaSet,
} from "./cache-store";
import {
  cancelOrder, cancelOcoOrder, placeStopLossLimitOrder, placeMarketSell, getTickerPrice, getOrder, getAccount, roundPrice,
  getKlines, getOpenOrders,
} from "./binance-auth";
import { notifyTrailingFill, notifyTrailingActivated, notifySlModified } from "./telegram";
import { settingGetBool, settingGetBoolForMode, settingGet, settingGetForMode } from "./settings-store";
import { journalAdd } from "./journal-store";
import { trailingSlLock, trailingSlUnlock } from "./order-monitor";
import { calcPivotLow } from "./indicators";
import { log } from "./logger";

const POLL_MS       = 30_000;
const MAX_ERRORS    = 3;
const BACKOFF_CAP   = 30 * 60_000; // 30 min màxim

// Error tracking per key (sobreviu hot-reload via global)
declare global {
  var __trailingEngineStarted: boolean | undefined;
  var __trailingErrorCounts:   Map<string, number>  | undefined;
  var __trailingPauseUntil:    Map<string, number>  | undefined;
  var __trailingLastRun:       number | undefined;
  var __trailingLastResult:    string | undefined;
}

export function getTrailingEngineStatus() {
  const actives  = trailingActiveGetAll();
  const pendings = trailingGetAll();
  return {
    started:        !!global.__trailingEngineStarted,
    lastRun:        global.__trailingLastRun    ?? null,
    lastResult:     global.__trailingLastResult ?? null,
    activeCount:    actives.length,
    pendingCount:   pendings.length,
    activeSymbols:  actives.map(t => ({ symbol: t.symbol, currentSl: t.currentSl, peakPrice: t.peakPrice })),
    pendingSymbols: pendings.map(t => t.symbol),
    pausedSymbols:  [...pauseUntil.keys()],
  };
}

const errorCounts = (global.__trailingErrorCounts ??= new Map<string, number>());
const pauseUntil  = (global.__trailingPauseUntil  ??= new Map<string, number>());

function trailKey(kind: "suggest" | "active", id: number): string {
  return `${kind}:${id}`;
}

function isPaused(key: string): boolean {
  const until = pauseUntil.get(key);
  if (!until) return false;
  if (Date.now() >= until) { pauseUntil.delete(key); errorCounts.delete(key); return false; }
  return true;
}

function recordError(key: string, symbol: string, err: Error) {
  const count = (errorCounts.get(key) ?? 0) + 1;
  errorCounts.set(key, count);
  log.trailing.error({ symbol, count, max: MAX_ERRORS, err: err.message }, "error al cicle");
  if (count >= MAX_ERRORS) {
    const pause = Math.min(BACKOFF_CAP, POLL_MS * Math.pow(2, count - MAX_ERRORS + 1));
    pauseUntil.set(key, Date.now() + pause);
    log.trailing.warn({ symbol, count, pauseSecs: Math.round(pause / 1000) }, "pausat per errors consecutius");
  }
}

function recordSuccess(key: string) {
  errorCounts.delete(key);
  pauseUntil.delete(key);
}

export function ensureTrailingEngine() {
  if (global.__trailingEngineStarted) return;
  global.__trailingEngineStarted = true;
  log.trailing.info("motor iniciat");
  setInterval(runCycle, POLL_MS);
}

async function runCycle() {
  if (!settingGetBool("trailing_engine_enabled") && !settingGetBool("trailing_engine_enabled_real")) {
    global.__trailingLastRun    = Date.now();
    global.__trailingLastResult = "desactivat";
    return;
  }
  // 0. Cleanup stale suggestions: remove order_trailing entries whose OCO no longer exists on Binance
  const suggestions = trailingGetAll();
  if (suggestions.length > 0) {
    try {
      const [paperOrders, realOrders] = await Promise.all([getOpenOrders("paper"), getOpenOrders("real")]);
      const openOrders = [...paperOrders, ...realOrders];
      const activeOcoIds = new Set(openOrders.map(o => o.orderListId).filter(id => id > 0));
      for (const s of suggestions) {
        if (!activeOcoIds.has(s.orderListId)) {
          log.trailing.info({ symbol: s.symbol, orderListId: s.orderListId }, "eliminant trailing pendent — OCO ja no existeix a Binance");
          trailingDelete(s.orderListId);
        }
      }
    } catch { /* si Binance falla, mantenim les entrades i ho intentem el proper cicle */ }
  }

  // 1. Auto-activate pending suggestions
  const freshSuggestions = trailingGetAll();
  for (const s of freshSuggestions) {
    const enabledKey = s.mode === "real" ? "trailing_engine_enabled_real" : "trailing_engine_enabled";
    if (!settingGetBool(enabledKey)) continue;
    const key = trailKey("suggest", s.orderListId);
    if (isPaused(key)) continue;
    try {
      await checkAndActivate(s);
      recordSuccess(key);
    } catch (err) {
      recordError(key, s.symbol, err as Error);
    }
  }

  // 2. Trail active SL orders
  const actives = trailingActiveGetAll();
  for (const t of actives) {
    const enabledKey = t.mode === "real" ? "trailing_engine_enabled_real" : "trailing_engine_enabled";
    if (!settingGetBool(enabledKey)) continue;
    const key = trailKey("active", t.id);
    if (isPaused(key)) continue;
    try {
      await processTrailing(t);
      recordSuccess(key);
    } catch (err) {
      recordError(key, t.symbol, err as Error);
    }
  }

  global.__trailingLastRun    = Date.now();
  global.__trailingLastResult = `ok: ${actives.length} actius, ${suggestions.length} pendents`;
}

async function checkAndActivate(s: ReturnType<typeof trailingGetAll>[number]) {
  if (!s.quantity || !s.tickSize) return; // legacy record without enough data

  const price = await getTickerPrice(s.symbol, s.mode);
  if (!price || isNaN(price)) return;

  // Only activate once price crosses activateAt
  if (s.side === "SELL" && price < s.activateAt) return;
  if (s.side === "BUY"  && price > s.activateAt) return;

  log.trailing.info({ mode: s.mode, symbol: s.symbol, price, activateAt: s.activateAt }, "trailing activat");

  // Cancel the OCO (removes both TP and SL legs).
  // If -2011: OCO already filled/cancelled — remove suggestion and bail out.
  try {
    await cancelOcoOrder(s.symbol, s.orderListId, s.mode);
  } catch (e) {
    const msg = (e as Error).message ?? "";
    if (msg.includes("-2011") || msg.includes("Unknown order list")) {
      log.trailing.warn({ symbol: s.symbol, orderListId: s.orderListId }, "OCO ja no existeix en activar trailing — eliminant suggeriment");
      trailingDelete(s.orderListId);
      return;
    }
    throw e;
  }

  // Place SL only — TP is not re-placed (trailing SL will handle the full exit)
  const initialSl    = s.side === "SELL" ? price - s.distance : price + s.distance;
  const initialLimit = s.side === "SELL" ? initialSl * 0.999  : initialSl * 1.001;

  const stopStr  = roundPrice(initialSl,    s.tickSize);
  const limitStr = roundPrice(initialLimit, s.tickSize);
  log.trailing.debug({ mode: s.mode, symbol: s.symbol, side: s.side, quantity: s.quantity, stopPrice: stopStr, limitPrice: limitStr, price, distance: s.distance, tickSize: s.tickSize }, "col·locant SL inicial");

  const slOrd = await placeStopLossLimitOrder({
    symbol: s.symbol, side: s.side, quantity: s.quantity,
    stopPrice: stopStr, limitPrice: limitStr,
  }, s.mode) as { orderId: number };

  trailingActiveCreate({
    symbol: s.symbol, side: s.side, quantity: s.quantity,
    tpOrderId: -1, slOrderId: slOrd.orderId,
    currentSl: initialSl, trailDist: s.distance,
    peakPrice: price, entryPrice: s.entryPrice ?? price, tickSize: s.tickSize,
    originOcoListId: s.orderListId,
    ocoCreatedAt: s.createdAt ?? null,
    mode: s.mode,
  });

  // Propagate tradeCode from original OCO to the new SL order
  const ocoMeta = orderMetaGet(`oco:${s.orderListId}`);
  if (ocoMeta?.tradeCode) {
    orderMetaSet(`ord:${slOrd.orderId}`, {
      tradeCode:   ocoMeta.tradeCode,
      ...(ocoMeta.interval     ? { interval:     ocoMeta.interval     } : {}),
      ...(ocoMeta.botName      ? { botName:      ocoMeta.botName      } : {}),
      ...(ocoMeta.entrySource  ? { entrySource:  ocoMeta.entrySource  } : {}),
    });
  }

  // Remove from suggestions so it doesn't trigger again
  trailingDelete(s.orderListId);

  // --- Journal: 1) OCO cancel·lada, 2) Trailing actiu (timestamps consecutius per ordre correcte) ---
  try {
    const tradeCode = s.orderListId != null
      ? (orderMetaGet(`oco:${s.orderListId}`)?.tradeCode ?? null)
      : null;
    const ePx = s.entryPrice ?? price;
    const cancelTs = Date.now();
    // 1) CANCELED — l'OCO original ha estat cancel·lada per activar el trailing
    journalAdd({
      type:            "CANCELED",
      symbol:          s.symbol,
      side:            s.side,
      qty:             s.quantity,
      price:           "0",
      quoteQty:        "0",
      commission:      "0",
      commissionAsset: "BNB",
      entryPrice:      null,
      pnlUsdt:         null,
      pnlPct:          null,
      orderId:         null,
      orderListId:     s.orderListId,
      strategy:        null,
      interval:        null,
      entryType:       null,
      trailingMode:    null,
      exitReason:      "CANCELED",
      capitalUsdt:     null,
      capitalMode:     null,
      notes:           "OCO cancel·lada — activació trailing",
      tradeCode,
      source:          "AUTO",
      executedAt:      cancelTs,
      mode:            s.mode,
    });
    // 2) TRAIL_ACTIVE — 1ms després per garantir ordre correcte
    journalAdd({
      type:            "TRAIL_ACTIVE",
      symbol:          s.symbol,
      side:            s.side,
      qty:             s.quantity,
      price:           String(price),
      quoteQty:        String(price * parseFloat(s.quantity)),
      commission:      "0",
      commissionAsset: "BNB",
      entryPrice:      ePx > 0 ? String(ePx) : null,
      pnlUsdt:         null,
      pnlPct:          null,
      orderId:         slOrd.orderId,
      orderListId:     s.orderListId,
      strategy:        null,
      interval:        orderMetaGet(`oco:${s.orderListId}`)?.interval ?? null,
      entryType:       null,
      trailingMode:    settingGet("trailing_sl_mode"),
      exitReason:      null,
      capitalUsdt:     null,
      capitalMode:     null,
      slPrice:         parseFloat(stopStr),
      notes:           `distància: ${s.distance.toFixed(2)}`,
      tradeCode,
      source:          "AUTO",
      executedAt:      cancelTs + 1,
      mode:            s.mode,
    });
  } catch (je) {
    log.trailing.warn({ err: (je as Error).message }, "journal trail-active fallida");
  }

  if (settingGetBoolForMode("tg_on_trailing_activate", s.mode)) {
    notifyTrailingActivated({
      symbol:      s.symbol,
      side:        s.side,
      price,
      initialSl:   stopStr,
      distance:    s.distance,
      orderListId: s.orderListId,
      mode:        s.mode,
    }).catch(err => log.trailing.warn({ err: (err as Error).message }, "notifyTrailingActivated fallida"));
  }
}

async function processTrailing(t: TrailingActive) {
  // Check if the SL order is still open
  let status: string;
  try {
    const ord = await getOrder(t.symbol, t.slOrderId, t.mode);
    status = ord.status;
  } catch (e) {
    const msg = (e as Error).message ?? "";
    // -2013: Order does not exist → mark permanently as error
    if (msg.includes("-2013") || msg.includes("Order does not exist")) {
      log.trailing.warn({ symbol: t.symbol, slOrderId: t.slOrderId }, "ordre SL no existeix — marcant com a error");
      trailingActiveSetStatus(t.id, "error");
      return;
    }
    // Transient error (network, timeout) → re-throw so recordError/backoff applies
    throw e;
  }

  if (status === "FILLED") {
    trailingActiveSetStatus(t.id, "filled");
    log.trailing.info({ symbol: t.symbol, stopPrice: t.currentSl }, "SL executat — tancat");
    const tradeCode = t.originOcoListId != null
      ? (orderMetaGet(`oco:${t.originOcoListId}`)?.tradeCode ?? null)
      : null;
    // --- Journal: record trailing exit ---
    try {
      const qty    = parseFloat(t.quantity);
      const ePx    = t.entryPrice > 0 ? t.entryPrice : null;
      const pnl    = ePx ? (t.currentSl - ePx) * qty : null;
      const pnlPct = ePx ? ((t.currentSl - ePx) / ePx) * 100 : null;
      journalAdd({
        type:           "EXIT_TRAILING",
        symbol:          t.symbol,
        side:            t.side,
        qty:             t.quantity,
        price:           String(t.currentSl),
        quoteQty:        String(t.currentSl * qty),
        commission:      "0",
        commissionAsset: "BNB",
        entryPrice:      ePx ? String(ePx) : null,
        pnlUsdt:         pnl,
        pnlPct:          pnlPct,
        orderId:         t.slOrderId,
        orderListId:     t.originOcoListId ?? null,
        strategy:        null,
        interval:        null,
        entryType:       null,
        trailingMode:    settingGet("trailing_sl_mode"),
        exitReason:      "TRAILING_STOP",
        capitalUsdt:     null,
        capitalMode:     null,
        notes:           null,
        tradeCode,
        source:          "AUTO",
        executedAt:      Date.now(),
        mode:            t.mode,
      });
    } catch (je) {
      log.trailing.warn({ err: (je as Error).message }, "journal exit fallida");
    }
    notifyTrailingFill({
      symbol:    t.symbol,
      side:      t.side,
      stopPrice: t.currentSl,
      qty:       t.quantity,
      mode:      t.mode,
    }).catch(err => log.trailing.warn({ err: (err as Error).message }, "notifyTrailingFill fallida"));

    // ── sl_sell_remaining: vendre qualsevol resta de posició lliure
    if (settingGetBoolForMode("sl_sell_remaining", t.mode)) {
      try {
        const baseAsset = t.symbol.replace(/USDT$|BUSD$|USDC$|FDUSD$|TUSD$/, "");
        const acct    = await getAccount(t.mode);
        const bal     = acct.balances.find(b => b.asset === baseAsset);
        const freeQty = parseFloat(bal?.free ?? "0");
        if (freeQty > 0) {
          const cached   = cacheGet<{ stepSize: string }>(`exchange-info:${t.symbol}`);
          const stepSize = cached?.data.stepSize ?? "0.00001";
          const stepNum  = parseFloat(stepSize);
          const stepDp   = stepSize.includes(".") ? stepSize.length - stepSize.indexOf(".") - 1 : 0;
          const sellQty  = (Math.floor(freeQty / stepNum) * stepNum).toFixed(stepDp);
          if (parseFloat(sellQty) > 0) {
            log.trailing.info({ symbol: t.symbol, freeQty, sellQty }, "sl_sell_remaining: venent resta posició");
            const sell2 = await placeMarketSell(t.symbol, sellQty, t.mode);
            const eQty2 = parseFloat(sell2.executedQty);
            const eVal2 = parseFloat(sell2.cummulativeQuoteQty);
            const ePx2  = eQty2 > 0 ? eVal2 / eQty2 : 0;
            const ePnl  = t.entryPrice > 0 ? (ePx2 - t.entryPrice) * eQty2 : null;
            try {
              journalAdd({
                type:            "EXIT_MARKET",
                symbol:          t.symbol,
                side:            "SELL",
                qty:             String(eQty2),
                price:           String(ePx2),
                quoteQty:        String(eVal2),
                commission:      "0",
                commissionAsset: "BNB",
                entryPrice:      t.entryPrice > 0 ? String(t.entryPrice) : null,
                pnlUsdt:         ePnl,
                pnlPct:          t.entryPrice > 0 ? ((ePx2 - t.entryPrice) / t.entryPrice) * 100 : null,
                orderId:         sell2.orderId,
                orderListId:     t.originOcoListId ?? null,
                strategy:        null,
                interval:        null,
                entryType:       null,
                trailingMode:    settingGet("trailing_sl_mode"),
                exitReason:      "MARKET_SELL",
                capitalUsdt:     eVal2,
                capitalMode:     null,
                notes:           "Liquidació total: resta després de SL",
                tradeCode,
                source:          "AUTO",
                executedAt:      Date.now(),
                mode:            t.mode,
              });
            } catch (je) {
              log.trailing.warn({ err: (je as Error).message }, "journal sl_sell_remaining fallida");
            }
            notifyTrailingFill({
              symbol:    t.symbol,
              side:      t.side,
              stopPrice: ePx2,
              qty:       t.quantity,
              mode:      t.mode,
            }).catch(err => log.trailing.warn({ err: (err as Error).message }, "notifyTrailingFill (sl_sell_remaining) fallida"));
          }
        }
      } catch (rse) {
        log.trailing.error({ symbol: t.symbol, err: (rse as Error).message }, "sl_sell_remaining: error venent resta");
      }
    }
    return;
  }
  if (status === "CANCELED" || status === "EXPIRED") {
    trailingActiveSetStatus(t.id, "canceled");
    log.trailing.warn({ symbol: t.symbol, slOrderId: t.slOrderId, status }, "SL cancel·lat/expirat externament");    const tradeCode = t.originOcoListId != null
      ? (orderMetaGet(`oco:${t.originOcoListId}`)?.tradeCode ?? null)
      : null;
    if (settingGetBoolForMode("cancel_auto_sell", t.mode) && t.side === "SELL") {
      const qty = t.quantity;
      log.trailing.info({ symbol: t.symbol, qty }, "cancel_auto_sell: venem a mercat per protegir posició");
      try {
        const sell = await placeMarketSell(t.symbol, qty, t.mode);
        const execQty   = parseFloat(sell.executedQty);
        const execValue = parseFloat(sell.cummulativeQuoteQty);
        const execPrice = execQty > 0 ? execValue / execQty : 0;
        try {
          journalAdd({
            type:            "EXIT_MARKET",
            symbol:          t.symbol,
            side:            "SELL",
            qty:             String(execQty),
            price:           String(execPrice),
            quoteQty:        String(execValue),
            commission:      "0",
            commissionAsset: "BNB",
            entryPrice:      t.entryPrice > 0 ? String(t.entryPrice) : null,
            pnlUsdt:         t.entryPrice > 0 ? (execPrice - t.entryPrice) * execQty : null,
            pnlPct:          t.entryPrice > 0 ? ((execPrice - t.entryPrice) / t.entryPrice) * 100 : null,
            orderId:         sell.orderId,
            orderListId:     t.originOcoListId ?? null,
            strategy:        null,
            interval:        null,
            entryType:       null,
            trailingMode:    settingGet("trailing_sl_mode"),
            exitReason:      "MARKET_SELL",
            capitalUsdt:     execValue,
            capitalMode:     null,
            notes:           "Auto-sell: SL cancel·lat",
            tradeCode,
            source:          "AUTO",
            executedAt:      Date.now(),
            mode:            t.mode,
          });
        } catch (je) {
          log.trailing.warn({ err: (je as Error).message }, "journal auto-sell fallida");
        }
        notifyTrailingFill({
          symbol:    t.symbol,
          side:      "SELL",
          stopPrice: execPrice,
          qty,
          mode:      t.mode,
        }).catch(err => log.trailing.warn({ err: (err as Error).message }, "notifyTrailingFill (cancel_auto_sell) fallida"));
      } catch (se) {
        log.trailing.error({ symbol: t.symbol, err: (se as Error).message }, "cancel_auto_sell: venda fallida");
      }
    }
    return;
  }

  const price = await getTickerPrice(t.symbol, t.mode);
  if (!price || isNaN(price)) return;

  // Resolve new SL candidate based on configured mode ─────────────────────
  const slMode      = settingGetForMode("trailing_sl_mode", t.mode) || "ATR";
  const pivotTf     = settingGetForMode("trailing_pivot_tf", t.mode) || "1h";
  const pivotOffset = parseFloat(settingGetForMode("trailing_pivot_offset_pct", t.mode) || "0.1") / 100;

  async function computeNewSl(peakCandidate: number): Promise<number | null> {
    if (slMode === "PIVOT_LOW") {
      try {
        const candles = await getKlines(t.symbol, pivotTf, 60);
        const pivot   = calcPivotLow(candles);
        if (pivot === null) return null;                          // no pivot found — keep current SL
        return pivot * (1 - pivotOffset);                        // small cushion below pivot
      } catch (e) {
        log.trailing.warn({ symbol: t.symbol, err: (e as Error).message }, "error obtenint pivot low — usant ATR");
        return peakCandidate - t.trailDist;                      // fallback to ATR
      }
    }
    return peakCandidate - t.trailDist;                          // ATR mode
  }

  // Long position (SELL OCO exit): move SL up when price makes new highs
  if (t.side === "SELL") {
    // In pivot-low mode we re-evaluate on every cycle; in ATR mode only on new highs
    if (slMode !== "PIVOT_LOW" && price <= t.peakPrice) return;
    if (slMode === "PIVOT_LOW"  && price <= t.peakPrice) {
      // Still check if pivot has moved above current SL (e.g. new higher pivot formed)
    }

    const newPeak = price;
    const newSl   = await computeNewSl(newPeak);
    if (newSl === null || newSl <= t.currentSl) {
      if (price > t.peakPrice) trailingActiveUpdateSl(t.id, t.slOrderId, t.currentSl, newPeak);
      return;
    }

    // Move SL up: cancel old + place new
    const stopStr  = roundPrice(newSl, t.tickSize);
    const limitStr = roundPrice(newSl * 0.999, t.tickSize);

    // B2: place new SL inside the try so that if it fails, we know the position has no SL
    const oldSlOrderId = t.slOrderId;
    trailingSlLock(oldSlOrderId);
    try {
      await cancelOrder(t.symbol, t.slOrderId, t.mode);
      const newOrder = await placeStopLossLimitOrder({
        symbol: t.symbol, side: "SELL", quantity: t.quantity,
        stopPrice: stopStr, limitPrice: limitStr,
      }, t.mode) as { orderId: number };

      trailingActiveUpdateSl(t.id, newOrder.orderId, parseFloat(stopStr), Math.max(newPeak, t.peakPrice));
      // Carry tradeCode forward to the replacement SL order (fallback: OCO meta)
      const slMeta = orderMetaGet(`ord:${oldSlOrderId}`)
        ?? (t.originOcoListId ? orderMetaGet(`oco:${t.originOcoListId}`) : null);
      if (slMeta?.tradeCode) orderMetaSet(`ord:${newOrder.orderId}`, {
        tradeCode: slMeta.tradeCode,
        ...(slMeta.interval ? { interval: slMeta.interval } : {}),
      });
      log.trailing.info(
        { symbol: t.symbol, mode: slMode, oldSl: t.currentSl, newSl: stopStr, peak: newPeak },
        slMode === "PIVOT_LOW" ? "SL actualitzat a pivot low" : "SL pujat"
      );

      if (settingGetBoolForMode("tg_on_sl_modify", t.mode)) {
        notifySlModified({
          symbol:    t.symbol,
          oldSl:     t.currentSl,
          newSlStop: stopStr,
          newSlLimit: limitStr,
          mode:      t.mode,
        }).catch(err => log.trailing.warn({ err: (err as Error).message }, "notifySlModified fallida"));
      }
    } catch (err) {
      log.trailing.error({ err: (err as Error).message, symbol: t.symbol }, "trailing SL SELL cancel+replace fallat — marcant com error");
      trailingActiveSetStatus(t.id, "error");
    } finally {
      trailingSlUnlock(oldSlOrderId);
    }
  }

  // Short position (BUY cover): move SL down when price makes new lows
  if (t.side === "BUY") {
    if (price >= t.peakPrice) return;

    const newPeak = price; // for BUY, "peak" tracks the lowest price seen
    const newSl   = newPeak + t.trailDist;

    if (newSl >= t.currentSl) {
      trailingActiveUpdateSl(t.id, t.slOrderId, t.currentSl, newPeak);
      return;
    }

    const stopStr  = roundPrice(newSl, t.tickSize);
    const limitStr = roundPrice(newSl * 1.001, t.tickSize);

    // B2: place new SL inside the try so that if it fails, we know the position has no SL
    const oldSlOrderId = t.slOrderId;
    trailingSlLock(oldSlOrderId);
    try {
      await cancelOrder(t.symbol, t.slOrderId, t.mode);
      const newOrder = await placeStopLossLimitOrder({
        symbol: t.symbol, side: "BUY", quantity: t.quantity,
        stopPrice: stopStr, limitPrice: limitStr,
      }, t.mode) as { orderId: number };

      trailingActiveUpdateSl(t.id, newOrder.orderId, parseFloat(stopStr), newPeak);
      // Carry tradeCode forward to the replacement SL order (fallback: OCO meta)
      const slMeta = orderMetaGet(`ord:${oldSlOrderId}`)
        ?? (t.originOcoListId ? orderMetaGet(`oco:${t.originOcoListId}`) : null);
      if (slMeta?.tradeCode) orderMetaSet(`ord:${newOrder.orderId}`, {
        tradeCode: slMeta.tradeCode,
        ...(slMeta.interval ? { interval: slMeta.interval } : {}),
      });
      log.trailing.info({ symbol: t.symbol, oldSl: t.currentSl, newSl: stopStr, peak: newPeak }, "SL baixat");

      if (settingGetBoolForMode("tg_on_sl_modify", t.mode)) {
        notifySlModified({
          symbol:    t.symbol,
          oldSl:     t.currentSl,
          newSlStop: stopStr,
          newSlLimit: limitStr,
          mode:      t.mode,
        }).catch(err => log.trailing.warn({ err: (err as Error).message }, "notifySlModified fallida"));
      }
    } catch (err) {
      log.trailing.error({ err: (err as Error).message, symbol: t.symbol }, "trailing SL BUY cancel+replace fallat — marcant com error");
      trailingActiveSetStatus(t.id, "error");
    } finally {
      trailingSlUnlock(oldSlOrderId);
    }
  }
}
