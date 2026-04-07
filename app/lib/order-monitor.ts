/**
 * Order Monitor — detecta ordres executades i envia notificacions a Telegram
 * Fa polling de les ordres obertes i compara amb l'estat anterior.
 */

import { getOpenOrders, getOrder, placeMarketSell, getAccount } from "./binance-auth";
import { notifyOrderFill } from "./telegram";
import { journalAdd, journalGetLastEntryPrice, type JournalType, type JournalExitReason } from "./journal-store";
import { settingGetBool, settingGet } from "./settings-store";
import { cacheGet, cacheDelete, orderMetaGet, trailingActiveGetAll, trailingActiveGetAllIncludingDone } from "./cache-store";
import { log } from "./logger";

const POLL_MS = 35_000; // lleugerament desfasat del trailing engine (30s)

interface StoredOrder {
  symbol:      string;
  type:        string;
  side:        "BUY" | "SELL";
  price:       string;
  stopPrice:   string;
  origQty:     string;
  orderListId: number;
}

// Globals per sobreviure hot-module reloads de Next.js
declare global {
  var __orderMonitorStarted:     boolean | undefined;
  var __orderMonitorInitialized: boolean | undefined;
  var __checkFillsRunning:       boolean | undefined;
  var __knownOpenOrders:         Map<number, StoredOrder> | undefined;
  var __trailingReplacedSls:     Set<number> | undefined;
  var __orderMonitorLastRun:     number | undefined;
  var __orderMonitorLastResult:  string | undefined;
}

export function getOrderMonitorStatus() {
  return {
    started:         !!global.__orderMonitorStarted,
    running:         !!global.__checkFillsRunning,
    lastRun:         global.__orderMonitorLastRun    ?? null,
    lastResult:      global.__orderMonitorLastResult ?? null,
    knownOrderCount: knownOrders.size,
  };
}

const knownOrders          = (global.__knownOpenOrders      ??= new Map<number, StoredOrder>());
const trailingReplacedSls  = (global.__trailingReplacedSls  ??= new Set<number>());

/** Mark an SL orderId as being replaced by the trailing engine (cancel + re-place). */
export function trailingSlLock(orderId: number)   { trailingReplacedSls.add(orderId); }
/** Unmark after the new SL has been placed. */
export function trailingSlUnlock(orderId: number) { trailingReplacedSls.delete(orderId); }

function calcPnl(symbol: string, tradeCode: string | null, execPrice: number, execQty: number) {
  const entry = journalGetLastEntryPrice(symbol, tradeCode);
  if (!entry || entry.price <= 0) return { entryPrice: null, pnlUsdt: null, pnlPct: null };
  const pnlUsdt = (execPrice - entry.price) * execQty;
  const pnlPct  = ((execPrice - entry.price) / entry.price) * 100;
  return { entryPrice: String(entry.price), pnlUsdt, pnlPct };
}

function storeOrder(o: { orderId: number; symbol: string; type: string; side: "BUY" | "SELL"; price: string; stopPrice: string; origQty: string; orderListId: number }) {
  knownOrders.set(o.orderId, {
    symbol: o.symbol, type: o.type, side: o.side,
    price: o.price, stopPrice: o.stopPrice,
    origQty: o.origQty, orderListId: o.orderListId,
  });
}

async function initKnownOrders(): Promise<void> {
  if (global.__orderMonitorInitialized) return;
  try {
    const orders = await getOpenOrders();
    knownOrders.clear();
    orders.forEach(storeOrder);
    global.__orderMonitorInitialized = true;
    log.monitor.info({ count: orders.length }, "inicialitzat");
  } catch (err) {
    log.monitor.error({ err: (err as Error).message }, "error inicialitzant");
  }
}

async function checkFills(): Promise<void> {
  // Evitar execucions concurrents: si el cicle anterior encara no ha acabat, saltem
  if (global.__checkFillsRunning) {
    log.monitor.warn("checkFills overlapped — cycle skipped");
    return;
  }
  global.__checkFillsRunning = true;
  try {
    await checkFillsInner();
    global.__orderMonitorLastResult = "ok";
  } catch (err) {
    global.__orderMonitorLastResult = `error: ${(err as Error).message}`;
    throw err;
  } finally {
    global.__checkFillsRunning = false;
    global.__orderMonitorLastRun = Date.now();
  }
}

async function checkFillsInner(): Promise<void> {
  let current: Awaited<ReturnType<typeof getOpenOrders>>;
  try {
    current = await getOpenOrders();
  } catch {
    return; // error de xarxa temporal, provarem el pròxim cicle
  }

  const currentIds = new Set(current.map(o => o.orderId));

  // Ordres que eren obertes i ja no hi són
  const disappeared = [...knownOrders.entries()].filter(([id]) => !currentIds.has(id));

  // Registrem quins orderListId han tingut un FILL en aquest cicle
  // per evitar journalitzar la cancel·lació automàtica de la parella OCO
  const filledOcoLists = new Set<number>();

  for (const [orderId, meta] of disappeared) {
    try {
      const status = await getOrder(meta.symbol, orderId);

      if (status.status === "FILLED") {
        const execQty   = parseFloat(status.executedQty || meta.origQty);
        const execPrice = parseFloat(status.price || meta.price || meta.stopPrice);
        const execValue = parseFloat(status.cummulativeQuoteQty) || execPrice * execQty;

        log.orders.info({ symbol: meta.symbol, side: meta.side, type: meta.type, execPrice, execValue, orderId }, "ordre executada (fill)");

        // Recupera el codi de trade de l'OCO original
        const tradeCode = meta.orderListId > 0
          ? (orderMetaGet(`oco:${meta.orderListId}`)?.tradeCode ?? null)
          : null;

        // ── Determine journal entry type from order type ──────────────────
        const effectiveType = (status.type || meta.type || "").toUpperCase();
        const isTp = effectiveType === "LIMIT_MAKER"
                  || effectiveType === "TAKE_PROFIT"
                  || effectiveType === "TAKE_PROFIT_LIMIT";
        const isSl = effectiveType === "STOP_LOSS_LIMIT"
                  || effectiveType === "STOP_LOSS";
        const isEntry = meta.side === "BUY" && (
                          effectiveType === "LIMIT" ||
                          effectiveType === "MARKET" ||
                          effectiveType === "LIMIT_MAKER"
                        );

        const journalType: JournalType = isTp    ? "EXIT_TP"
                                       : isSl    ? "EXIT_SL"
                                       : isEntry ? "ENTRY_BUY"
                                       : meta.side === "SELL" ? "EXIT_MARKET"
                                       : "MANUAL";

        const exitReason: JournalExitReason | null = isTp    ? "TP_HIT"
                                                : isSl    ? "SL_HIT"
                                                : isEntry ? null
                                                : meta.side === "SELL" ? "MARKET_SELL"
                                                : null;
        // Skip journaling if this SL fill belongs to a trailing — trailing-engine journals it
        // Use IncludingDone because trailing-engine may have already marked it "filled"
        if (isSl && trailingActiveGetAllIncludingDone().some(t => t.slOrderId === orderId)) {
          log.orders.info({ orderId, symbol: meta.symbol }, "fill SL trailing — journal delegat al trailing engine");
          if (meta.orderListId > 0) filledOcoLists.add(meta.orderListId);
        } else try {
          const isExit = isTp || isSl || (!isEntry && meta.side === "SELL");
          const pnl = isExit ? calcPnl(meta.symbol, tradeCode, execPrice, execQty) : { entryPrice: null, pnlUsdt: null, pnlPct: null };
          journalAdd({
            type:            journalType,
            symbol:          meta.symbol,
            side:            meta.side,
            qty:             String(execQty),
            price:           String(execPrice),
            quoteQty:        String(execValue),
            commission:      "0",
            commissionAsset: "BNB",
            entryPrice:      pnl.entryPrice,
            pnlUsdt:         pnl.pnlUsdt,
            pnlPct:          pnl.pnlPct,
            orderId,
            orderListId:     meta.orderListId > 0 ? meta.orderListId : null,
            strategy:        null,
            interval:        null,
            entryType:       effectiveType || null,
            trailingMode:    null,
            exitReason,
            capitalUsdt:     execValue,
            capitalMode:     null,
            notes:           null,
            tradeCode,
            source:          "AUTO",
            executedAt:      Date.now(),
          });
          if (isExit) cacheDelete("pnl:summary");
        // Registrar que aquest OCO ha tingut fill per ignorar la cancel·lació de la parella
        if (meta.orderListId > 0) filledOcoLists.add(meta.orderListId);
        } catch (je) {
          log.monitor.warn({ err: (je as Error).message }, "journal fill fallida");
        }

        await notifyOrderFill({
          symbol:      meta.symbol,
          side:        meta.side,
          type:        meta.type,
          execPrice,
          origQty:     execQty,
          execValue,
          orderListId: meta.orderListId,
        });

        // ── sl_sell_remaining: si és un SL, vendre qualsevol resta de posició lliure
        if (isSl && settingGetBool("sl_sell_remaining")) {
          try {
            const baseAsset = meta.symbol.replace(/USDT$|BUSD$|USDC$|FDUSD$|TUSD$/, "");
            const acct   = await getAccount();
            const bal    = acct.balances.find(b => b.asset === baseAsset);
            const freeQty = parseFloat(bal?.free ?? "0");
            if (freeQty > 0) {
              const cached   = cacheGet<{ stepSize: string }>(`exchange-info:${meta.symbol}`);
              const stepSize = cached?.data.stepSize ?? "0.00001";
              const stepNum  = parseFloat(stepSize);
              const stepDp   = stepSize.includes(".") ? stepSize.length - stepSize.indexOf(".") - 1 : 0;
              const sellQty  = (Math.floor(freeQty / stepNum) * stepNum).toFixed(stepDp);
              if (parseFloat(sellQty) > 0) {
                log.monitor.info({ symbol: meta.symbol, freeQty, sellQty }, "sl_sell_remaining: venent resta posició");
                const sell2 = await placeMarketSell(meta.symbol, sellQty);
                const eQty2  = parseFloat(sell2.executedQty);
                const eVal2  = parseFloat(sell2.cummulativeQuoteQty);
                const ePx2   = eQty2 > 0 ? eVal2 / eQty2 : 0;
                try {
                  const pnl2 = calcPnl(meta.symbol, tradeCode, ePx2, eQty2);
                  journalAdd({
                    type:            "EXIT_MARKET",
                    symbol:          meta.symbol,
                    side:            "SELL",
                    qty:             String(eQty2),
                    price:           String(ePx2),
                    quoteQty:        String(eVal2),
                    commission:      "0",
                    commissionAsset: "BNB",
                    entryPrice:      pnl2.entryPrice,
                    pnlUsdt:         pnl2.pnlUsdt,
                    pnlPct:          pnl2.pnlPct,
                    orderId:         sell2.orderId,
                    orderListId:     meta.orderListId > 0 ? meta.orderListId : null,
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
                  });
                  cacheDelete("pnl:summary");
                } catch (je) {
                  log.monitor.warn({ err: (je as Error).message }, "journal sl_sell_remaining fallida");
                }
                notifyOrderFill({
                  symbol: meta.symbol, side: "SELL", type: "MARKET",
                  execPrice: ePx2, origQty: eQty2, execValue: eVal2,
                  orderListId: meta.orderListId,
                }).catch(err => log.monitor.warn({ err: (err as Error).message }, "notifyOrderFill fallida"));
              }
            }
          } catch (rse) {
            log.monitor.error({ symbol: meta.symbol, err: (rse as Error).message }, "sl_sell_remaining: error venent resta");
          }
        }
      // Si és CANCELED: si és un SL standalone (orderListId=-1) i cancel_auto_sell és actiu → market sell
      } else if (
        status.status === "CANCELED" &&
        meta.side === "SELL" &&
        meta.orderListId === -1 &&
        (meta.type === "STOP_LOSS_LIMIT" || meta.type === "STOP_LOSS") &&
        !trailingReplacedSls.has(orderId) &&
        settingGetBool("cancel_auto_sell")
      ) {
        const qty = meta.origQty;
        log.monitor.info({ symbol: meta.symbol, orderId, qty }, "cancel_auto_sell: SL standalone cancel·lat — venem a mercat");
        try {
          const sell = await placeMarketSell(meta.symbol, qty);
          const execQty   = parseFloat(sell.executedQty);
          const execValue = parseFloat(sell.cummulativeQuoteQty);
          const execPrice = execQty > 0 ? execValue / execQty : 0;
          try {
            const pnl3 = calcPnl(meta.symbol, null, execPrice, execQty);
            journalAdd({
              type:            "EXIT_MARKET",
              symbol:          meta.symbol,
              side:            "SELL",
              qty:             String(execQty),
              price:           String(execPrice),
              quoteQty:        String(execValue),
              commission:      "0",
              commissionAsset: "BNB",
              entryPrice:      pnl3.entryPrice,
              pnlUsdt:         pnl3.pnlUsdt,
              pnlPct:          pnl3.pnlPct,
              orderId:         sell.orderId,
              orderListId:     null,
              strategy:        null,
              interval:        null,
              entryType:       meta.type || null,
              trailingMode:    settingGet("trailing_sl_mode"),
              exitReason:      "MARKET_SELL",
              capitalUsdt:     execValue,
              capitalMode:     null,
              notes:           "Auto-sell: SL cancel·lat",
              tradeCode:       null,
              source:          "AUTO",
              executedAt:      Date.now(),
            });
            cacheDelete("pnl:summary");
          } catch (je) {
            log.monitor.warn({ err: (je as Error).message }, "journal auto-sell fallida");
          }
          await notifyOrderFill({
            symbol:      meta.symbol,
            side:        "SELL",
            type:        "MARKET",
            execPrice,
            origQty:     execQty,
            execValue,
            orderListId: -1,
          });
        } catch (se) {
          log.monitor.error({ symbol: meta.symbol, err: (se as Error).message }, "cancel_auto_sell: venda fallida");
        }
      } else if (
        status.status === "CANCELED" &&
        meta.side === "SELL" &&
        meta.orderListId > 0 &&
        !filledOcoLists.has(meta.orderListId) &&
        !trailingReplacedSls.has(orderId) &&
        // Journalitzem només el LIMIT_MAKER (TP) per evitar doble entrada per OCO
        (meta.type === "LIMIT_MAKER" || meta.type === "TAKE_PROFIT_LIMIT") &&
        // Omet OCOs cancel·lades per activació trailing — el trailing engine ja ho ha journalitzat
        !trailingActiveGetAllIncludingDone().some(t => t.originOcoListId === meta.orderListId)
      ) {
        // OCO cancel·lada manualment (ex: sell-all, cancel manual a Binance)
        const tradeCode = meta.orderListId > 0
          ? (orderMetaGet(`oco:${meta.orderListId}`)?.tradeCode ?? null)
          : null;
        log.monitor.info({ symbol: meta.symbol, orderId, orderListId: meta.orderListId }, "OCO cancel·lada manualment — journalitzant CANCELED");
        try {
          journalAdd({
            type:            "CANCELED",
            symbol:          meta.symbol,
            side:            meta.side,
            qty:             meta.origQty,
            price:           meta.price,
            quoteQty:        "0",
            commission:      "0",
            commissionAsset: "BNB",
            entryPrice:      null,
            pnlUsdt:         null,
            pnlPct:          null,
            orderId,
            orderListId:     meta.orderListId,
            strategy:        null,
            interval:        null,
            entryType:       null,
            trailingMode:    null,
            exitReason:      "CANCELED",
            capitalUsdt:     null,
            capitalMode:     null,
            notes:           "OCO cancel·lada manualment",
            tradeCode,
            source:          "AUTO",
            executedAt:      Date.now(),
          });
          cacheDelete("pnl:summary");
        } catch (je) {
          log.monitor.warn({ err: (je as Error).message }, "journal OCO canceled fallida");
        }
      }
      // Altres CANCELED (parella OCO auto-cancel·lada, etc.) — no notifiquem
    } catch (err) {
      log.monitor.error({ orderId, err: (err as Error).message }, "no s'ha pogut verificar ordre");
    }
  }

  // Actualitza el mapa amb les ordres actuals
  knownOrders.clear();
  current.forEach(storeOrder);
}

export function ensureOrderMonitor(): void {
  if (global.__orderMonitorStarted) return;
  global.__orderMonitorStarted = true;
  log.monitor.info("monitor iniciat");
  // Primer: pobla el mapa sense notificar, després inicia el polling
  initKnownOrders()
    .then(() => { setInterval(checkFills, POLL_MS); })
    .catch(err => log.monitor.error({ err: (err as Error).message }, "initKnownOrders fallida — monitor aturat"));
}
