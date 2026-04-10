/**
 * Auto-trader multi-bot — compra automàtica en el tancament de candles.
 *
 * Arquitectura:
 *  - Poll global cada 60s.
 *  - Per cada bot enabled: si la seva candle acaba de tancar → runBotScan().
 *  - Paràmetres de trading (TP/SL/trail/symbols/interval) vénen de la sim desada.
 *  - Paràmetres operatius (budget, maxDaily, hores) vénen del propi bot.
 *  - Master switch: auto_trade_enabled (settings) para TOTS els bots.
 */

import { analyzeAll, type OHLCV } from "./indicators";

// ── Probabilitat d'entrada (idèntic a simulation/run/route.ts) ────────────────
const INTERVAL_BONUS: Record<string, number> = {
  "1d": 10, "4h": 10, "1h": 5, "30m": 2, "15m": 0,
};
const CONF_BONUS: Record<string, number> = {
  alta: 10, moderada: 5, baixa: 0,
};
function computeProbability(score: number, interval: string, confidence: string): number {
  return Math.min(95, Math.round(
    score * 0.7 + (INTERVAL_BONUS[interval] ?? 0) + (CONF_BONUS[confidence] ?? 0),
  ));
}
import { settingGet, settingGetBool } from "./settings-store";
import { botGetAll, type Bot } from "./bot-store";
import {
  placeMarketBuy, placeMarketSell, placeOcoOrder, getTickerPrice,
  roundPriceUp, roundPriceDown, roundQty, getOpenOrders, getAccount,
} from "./binance-auth";
import {
  cacheGet, trailingSet, nextTradeCode, orderMetaSet,
  pendingOcoSave, pendingOcoGetAll, pendingOcoDelete, pendingOcoIncAttempts,
  orphanWatchUpsert, orphanWatchGet, orphanWatchDelete, orphanWatchMarkNotified, hasActiveTrailing,
  trailingActiveGetAll,
} from "./cache-store";
import { ensureTrailingEngine } from "./trailing-engine";
import { journalAdd, journalPatchOco, journalPatchTpSl, journalGetLastEntryPrice, journalGetLastTradeCode, journalGetLastEntryMeta } from "./journal-store";
import { notifyNewOrder, notifyOcoFailed, notifyOrphanDetected, notifyOrphanNoBot, notifyMarketScan, type ScanSymbolResult } from "./telegram";
import { log } from "./logger";
import path from "path";
import fs from "fs";

declare global {
  var __autoTraderStarted:    boolean | undefined;
  var __autoTraderTimer:      ReturnType<typeof setInterval> | undefined;
  var __autoTraderLastRun:    number | undefined;
  var __autoTraderLastResult: string | undefined;
}

export function getAutoTraderStatus() {
  return {
    started:    !!global.__autoTraderStarted,
    running:    _polling,
    lastRun:    global.__autoTraderLastRun    ?? null,
    lastResult: global.__autoTraderLastResult ?? null,
  };
}

/* ── SavedConfig (same shape as simulation/configs) ──────────── */

interface SavedConfig {
  id: string;
  name: string;
  config: {
    symbols:          string[];
    interval:         string;
    tpAtr:            number;
    slAtr:            number;
    trailActivateAtr: number;
    trailDistanceAtr: number;
    capitalMode:      string;  // "FIXED" | "PCT" | "ANTI_MARTINGALE"
    capitalFixed?:    number;
    capitalPct?:      number;
    amBasePct?:       number;
  };
  effectiveConfig?: {
    minProbability?: number;
    maxOpen?:        number;
  };
}

const SIM_DIR = path.join(process.cwd(), "simulation");

function loadSimConfig(simId: string): SavedConfig | null {
  // A5: prevent path traversal — simId must be alphanumeric/dash/underscore only
  if (!/^[a-zA-Z0-9_-]+$/.test(simId)) return null;
  if (!fs.existsSync(SIM_DIR)) return null;
  const filePath = path.join(SIM_DIR, `${simId}.json`);
  if (!path.resolve(filePath).startsWith(path.resolve(SIM_DIR))) return null;
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as SavedConfig;
  } catch {
    return null;
  }
}

/* ── Candle close detection ──────────────────────────────────── */

const INTERVAL_MS: Record<string, number> = {
  "1m":  1  * 60_000,
  "3m":  3  * 60_000,
  "5m":  5  * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h":  60 * 60_000,
  "2h":  2  * 60 * 60_000,
  "4h":  4  * 60 * 60_000,
  "6h":  6  * 60 * 60_000,
  "12h": 12 * 60 * 60_000,
  "1d":  24 * 60 * 60_000,
};

/**
 * Returns true if a candle on `interval` has closed in the last 60 seconds.
 * Based on floor(now / period) vs floor((now - 60s) / period).
 */
function candleJustClosed(interval: string): boolean {
  const period = INTERVAL_MS[interval] ?? 60_000;
  const now = Date.now();
  return Math.floor(now / period) > Math.floor((now - 60_000) / period);
}

/* ── Per-bot daily counters (in-memory) ─────────────────────── */

const _botDailyDate  = new Map<string, string>();
const _botDailyCount = new Map<string, number>();

function getBotTodayCount(botId: string): number {
  const today = new Date().toISOString().slice(0, 10);
  if (_botDailyDate.get(botId) !== today) {
    _botDailyDate.set(botId, today);
    _botDailyCount.set(botId, 0);
  }
  return _botDailyCount.get(botId) ?? 0;
}

function incBotTodayCount(botId: string): void {
  getBotTodayCount(botId); // ensure date reset
  _botDailyCount.set(botId, (_botDailyCount.get(botId) ?? 0) + 1);
}

/* ── Analysis (directe a Binance, sense HTTP intern) ─────────── */

async function fetchAndAnalyze(symbol: string, interval: string, retry = 0) {
  const res = await fetch(
    `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=251`,
    { cache: "no-store", signal: AbortSignal.timeout(10_000) },
  );
  // B4: backoff on rate limit
  if (res.status === 429 && retry < 3) {
    await new Promise(r => setTimeout(r, Math.pow(2, retry) * 1000));
    return fetchAndAnalyze(symbol, interval, retry + 1);
  }
  if (!res.ok) throw new Error(`Binance klines ${symbol}/${interval}: ${res.status}`);
  const raw: unknown[][] = await res.json();
  // Exclude the last (forming) candle — only use closed candles
  const candles: OHLCV[] = raw.slice(0, -1).map(k => ({
    time:   k[0] as number,
    open:   parseFloat(k[1] as string),
    high:   parseFloat(k[2] as string),
    low:    parseFloat(k[3] as string),
    close:  parseFloat(k[4] as string),
    volume: parseFloat(k[5] as string),
  }));
  return analyzeAll(candles, symbol, interval);
}

/* ── Compra + OCO ────────────────────────────────────────────── */

interface BuyOpts {
  symbol:    string;
  quoteQty:  number;
  score:     number;
  interval:  string;
  atr:       number;
  fillRef:   number;
  tpAtr:     number;
  slAtr:     number;
  trailAct:  number;
  trailDst:  number;
  trailMode: string;
  botName:   string;
}

async function applyOcoSuccess(
  ocoResult:  Record<string, unknown>,
  symbol:     string,
  ocoQty:     string,
  tpPrice:    string,
  slStopPrice: string,
  fillPrice:  number,
  trailAct:   number,
  trailDst:   number,
  trailMode:  string,
  tickSize:   string,
  atr:        number,
  interval:   string,
  botName:    string,
  quoteQty:   number,
  score:      number,
  journalId:  number,
  existingTradeCode: string | null,
): Promise<void> {
  const orderListId = typeof ocoResult.orderListId === "number" ? ocoResult.orderListId : -1;

  // Codi d'operació + metadades
  let tradeCode = existingTradeCode;
  if (orderListId > 0) {
    tradeCode = tradeCode ?? nextTradeCode();
    orderMetaSet(`oco:${orderListId}`, { tradeCode, interval, botName, entrySource: "AUTO" });
    journalPatchOco(journalId, orderListId, tradeCode);
  }

  // Guarda preus TP/SL al diari per mostrar-los a la taula
  journalPatchTpSl(journalId, parseFloat(tpPrice), parseFloat(slStopPrice));

  // Trailing stop suggestion
  const activateAt = fillPrice + trailAct * atr;
  const distance   = trailDst * atr;
  if (orderListId !== -1) {
    trailingSet(orderListId, {
      symbol,
      activateAt, distance,
      activateAtr: trailAct, distanceAtr: trailDst, logic: trailMode,
      quantity: ocoQty, side: "SELL", tickSize, entryPrice: fillPrice,
    });
    ensureTrailingEngine();
  }

  // Notificació Telegram
  if (settingGetBool("tg_on_new_order")) {
    notifyNewOrder({
      symbol, type: "BUY_AND_EXIT",
      quoteQty, fillPrice, tpPrice, slStopPrice,
      orderListId,
    }).catch(err => log.auto.warn({ err: (err as Error).message }, "notifyNewOrder fallida"));
  }
}

async function executeBuy(opts: BuyOpts): Promise<void> {
  const { symbol, quoteQty, score, interval, atr, tpAtr, slAtr, trailAct, trailDst, trailMode, botName } = opts;

  // 1. Compra a mercat
  const buyResult   = await placeMarketBuy(symbol, String(quoteQty));
  const executedQty = buyResult.executedQty;
  const fillPrice   = parseFloat(buyResult.cummulativeQuoteQty) / parseFloat(executedQty);

  // Comissions en el base asset
  const baseAsset  = symbol.replace(/USDT$|BUSD$|USDC$|FDUSD$|TUSD$|BTC$|ETH$|BNB$/, "");
  const commInBase = (buyResult.fills ?? [])
    .filter(f => f.commissionAsset === baseAsset)
    .reduce((sum, f) => sum + parseFloat(f.commission), 0);

  // 2. tickSize / stepSize
  const cached = cacheGet<{ tickSize: string; stepSize: string }>(`exchange-info:${symbol}`);
  let tickSize = "0.01";
  let stepSize = "1";
  if (cached) {
    tickSize = cached.data.tickSize ?? tickSize;
    stepSize = cached.data.stepSize ?? stepSize;
  } else {
    const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
    const info = await fetch(`${base}/api/exchange-info?symbol=${symbol}`, { signal: AbortSignal.timeout(10_000) })
      .then(r => r.json() as Promise<{ tickSize?: string; stepSize?: string }>);
    if (info.tickSize) tickSize = info.tickSize;
    if (info.stepSize) stepSize = info.stepSize;
  }

  // Quantitat neta (sense comissions), arrodonida al stepSize
  const netQty  = parseFloat(executedQty) - commInBase;
  const stepNum = parseFloat(stepSize);
  const stepDp  = stepSize.includes(".") ? stepSize.length - stepSize.indexOf(".") - 1 : 0;
  const ocoQty  = (Math.floor(netQty / stepNum) * stepNum).toFixed(stepDp);

  // 3. Preus TP / SL a partir de l'ATR
  const tpTarget = fillPrice + tpAtr * atr;
  const slTarget = fillPrice - slAtr * atr;

  const currentPrice = await getTickerPrice(symbol);
  const tickNum      = parseFloat(tickSize);
  const tpPrice      = roundPriceUp(Math.max(tpTarget, currentPrice + 2 * tickNum), tickSize);
  const slStopPrice  = roundPriceDown(Math.min(slTarget, currentPrice - 2 * tickNum), tickSize);
  const slLimitPrice = roundPriceDown(parseFloat(slStopPrice) * 0.999, tickSize);

  // 4. Journal immediat (abans de l'OCO, per garantir el registre de la compra)
  const tradeCode = nextTradeCode();
  const journalId = journalAdd({
    type:            "ENTRY_BUY",
    symbol,
    side:            "BUY",
    qty:             ocoQty,
    price:           String(fillPrice),
    quoteQty:        String(quoteQty),
    commission:      "0",
    commissionAsset: "BNB",
    entryPrice:      null,
    pnlUsdt:         null,
    pnlPct:          null,
    orderId:         buyResult.orderId ?? null,
    orderListId:     null,  // s'actualitza si l'OCO té èxit
    strategy:        null,
    interval,
    entryType:       "MARKET",
    trailingMode:       trailMode,
    exitReason:         null,
    capitalUsdt:        quoteQty,
    capitalMode:        settingGet("capital_mode"),
    notes:              `Auto-trade · Bot: ${botName} · score ${score} · ${interval}`,
    tradeCode,
    source:             "AUTO",
    trailingActivateAt: trailMode && trailAct && atr ? fillPrice + trailAct * atr : null,
    executedAt:         Date.now(),
  });

  // 5. Col·loca l'OCO de sortida (3 intents)
  let ocoResult: Record<string, unknown> | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      ocoResult = await placeOcoOrder({
        symbol, side: "SELL", quantity: ocoQty,
        tpPrice, slStopPrice, slLimitPrice,
      }) as Record<string, unknown>;
      break;
    } catch (err) {
      log.auto.warn({ symbol, attempt, err: (err as Error).message }, "OCO fallida, reintentant…");
      if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }

  if (!ocoResult) {
    // Guarda per reintent posterior en el proper cicle de poll
    pendingOcoSave({
      symbol, ocoQty, tpPrice, slStopPrice, slLimitPrice, fillPrice,
      trailActAt: fillPrice + trailAct * atr,
      trailDist:  trailDst * atr,
      trailMode, tickSize, botName,
      intervalTf: interval, score, quoteQty, atr,
      buyOrderId: buyResult.orderId ?? null,
      journalId, tradeCode,
    });
    log.auto.error({ symbol, journalId }, "OCO no col·locada — guardada per reintent posterior");
    notifyOcoFailed({
      symbol, fillPrice, quoteQty, ocoQty,
      tpPrice, slPrice: slStopPrice,
      error: "Invalid quantity / OCO rebutjada per Binance",
      journalId,
    }).catch(err => log.auto.warn({ err: (err as Error).message }, "notifyOcoFailed fallida"));
    return;
  }

  log.auto.info(
    { symbol, interval, score, fillPrice, tpPrice, slStopPrice, qty: ocoQty, bot: botName },
    "auto-compra executada",
  );

  // 6. Aplica trailing, metadades, Telegram
  await applyOcoSuccess(
    ocoResult, symbol, ocoQty, tpPrice, slStopPrice,
    fillPrice, trailAct, trailDst, trailMode, tickSize, atr,
    interval, botName, quoteQty, score, journalId, tradeCode,
  );
}

/* ── Per-bot scan ────────────────────────────────────────────── */

async function runBotScan(bot: Bot, simConfig: SavedConfig): Promise<void> {
  const { config, effectiveConfig } = simConfig;
  const interval   = config.interval;
  const symbols    = config.symbols ?? [];
  const tpAtr      = config.tpAtr      ?? 2.5;
  const slAtr      = config.slAtr      ?? 1.0;
  const trailAct   = config.trailActivateAtr  ?? 1.5;
  const trailDst   = config.trailDistanceAtr  ?? 1.0;
  const trailMode  = settingGet("trailing_sl_mode") || "ATR";
  // Jerarquia: bot (explícit) > effectiveConfig de la sim > default 70
  const minScore   = bot.minProbability ?? effectiveConfig?.minProbability ?? 70;
  const tgScan     = settingGetBool("tg_on_market_scan");

  // Finestra horària (UTC)
  const nowHour = new Date().getUTCHours();
  // hoursTo=24 significa "tot el dia" — getUTCHours() mai retorna 24
  if (nowHour < bot.hoursFrom || (bot.hoursTo < 24 && nowHour >= bot.hoursTo)) {
    log.auto.debug({ bot: bot.name, nowHour, from: bot.hoursFrom, to: bot.hoursTo }, "bot fora de finestra horària");
    if (tgScan) notifyMarketScan({ botName: bot.name, interval, minScore, skipReason: "fora de finestra horària", results: [] }).catch(() => {});
    return;
  }

  // Màxim diari per-bot
  if (getBotTodayCount(bot.id) >= bot.maxDaily) {
    log.auto.debug({ bot: bot.name, count: getBotTodayCount(bot.id), max: bot.maxDaily }, "bot: màxim diari assolit");
    if (tgScan) notifyMarketScan({ botName: bot.name, interval, minScore, skipReason: `màxim diari assolit (${bot.maxDaily})`, results: [] }).catch(() => {});
    return;
  }

  // Pressupost: compta OCO oberts × USDT/op ≤ pressupost del bot
  let usdtPer: number;
  if (config.capitalMode === "FIXED") {
    usdtPer = config.capitalFixed ?? 100;
  } else if (config.capitalMode === "PCT") {
    usdtPer = bot.budgetUsdt * (config.capitalPct ?? 10) / 100;
  } else if (config.capitalMode === "ANTI_MARTINGALE") {
    usdtPer = bot.budgetUsdt * (config.amBasePct ?? 60) / 100;
  } else {
    usdtPer = config.capitalFixed ?? 100;
  }

  const openOrders = await getOpenOrders();
  const openOcoCount = new Set(
    openOrders.filter(o => o.orderListId !== -1).map(o => o.orderListId)
  ).size;
  const trailingCount = trailingActiveGetAll().length;
  const totalOpen = openOcoCount + trailingCount;

  // Límit de posicions simultànies (bot > effectiveConfig > sense límit)
  const maxOpen = bot.maxOpen ?? effectiveConfig?.maxOpen ?? null;
  if (maxOpen !== null && totalOpen >= maxOpen) {
    log.auto.debug({ bot: bot.name, totalOpen, maxOpen }, "bot: màx. posicions simultànies assolit");
    if (tgScan) notifyMarketScan({ botName: bot.name, interval, minScore, skipReason: `màx. posicions assolit (${totalOpen}/${maxOpen})`, results: [] }).catch(() => {});
    return;
  }

  const committed = totalOpen * usdtPer;
  if (committed + usdtPer > bot.budgetUsdt) {
    log.auto.debug({ bot: bot.name, committed, openOcoCount, trailingCount, budget: bot.budgetUsdt }, "bot: pressupost exhaurit");
    if (tgScan) notifyMarketScan({ botName: bot.name, interval, minScore, skipReason: `pressupost exhaurit (${openOcoCount} OCO + ${trailingCount} trailing actius)`, results: [] }).catch(() => {});
    return;
  }

  log.auto.info({ bot: bot.name, interval, symbols: symbols.length, minScore }, "iniciant scan de bot");

  const scanResults: ScanSymbolResult[] = [];

  for (const symbol of symbols) {
    // Re-comprova límit diari
    if (getBotTodayCount(bot.id) >= bot.maxDaily) break;

    try {
      const analysis = await fetchAndAnalyze(symbol, interval);

      const bestStrategy = analysis.strategies.find(s => s.active && s.type !== "bearish");
      const probability  = bestStrategy
        ? computeProbability(analysis.score, interval, bestStrategy.confidence)
        : 0;

      if (analysis.verdict !== "BUY" || !bestStrategy || probability < minScore) {
        log.auto.debug({ bot: bot.name, symbol, score: analysis.score, probability, verdict: analysis.verdict }, "sense senyal");
        scanResults.push({ symbol, price: analysis.price, score: analysis.score, verdict: analysis.verdict, decision: "NO_SIGNAL" });
        continue;
      }

      // Multi-TF check (opcional)
      if (bot.requireMultiTf) {
        const higherTf: Record<string, string> = { "5m": "1h", "15m": "1h", "30m": "1h", "1h": "4h", "4h": "1d" };
        const confirmTf = higherTf[interval];
        if (confirmTf) {
          const confirm = await fetchAndAnalyze(symbol, confirmTf);
          const confirmStrategy = confirm.strategies.find(s => s.active && s.type !== "bearish");
          const confirmProb     = confirmStrategy
            ? computeProbability(confirm.score, confirmTf, confirmStrategy.confidence)
            : 0;
          if (confirm.verdict !== "BUY" || !confirmStrategy || confirmProb < minScore) {
            log.auto.debug({ bot: bot.name, symbol, interval, confirmTf }, "multi-TF no confirmat");
            scanResults.push({ symbol, price: analysis.price, score: analysis.score, verdict: analysis.verdict, decision: "MULTI_TF_FAIL" });
            continue;
          }
        }
      }

      // No comprar si ja tenim un trailing SL actiu per aquest símbol
      if (hasActiveTrailing(symbol)) {
        log.auto.info({ bot: bot.name, symbol }, "bot: trailing SL actiu — ometent senyal");
        scanResults.push({ symbol, price: analysis.price, score: analysis.score, verdict: analysis.verdict, decision: "TRAILING_ACTIVE" });
        continue;
      }

      log.auto.info({ bot: bot.name, symbol, interval, score: analysis.score }, "senyal → comprant");
      scanResults.push({ symbol, price: analysis.price, score: analysis.score, verdict: analysis.verdict, decision: "BUY_EXECUTED" });

      await executeBuy({
        symbol, quoteQty: usdtPer, score: analysis.score, interval,
        atr: analysis.atr, fillRef: analysis.price,
        tpAtr, slAtr, trailAct, trailDst, trailMode,
        botName: bot.name,
      });

      incBotTodayCount(bot.id);

      await new Promise(r => setTimeout(r, 2000));

    } catch (err) {
      log.auto.error({ bot: bot.name, symbol, interval, err: (err as Error).message }, "error en bot scan");
    }
  }

  if (tgScan && scanResults.length > 0) {
    notifyMarketScan({ botName: bot.name, interval, minScore, results: scanResults })
      .catch(err => log.auto.warn({ err: (err as Error).message }, "notifyMarketScan fallida"));
  }
}

/* ── Reintent OCO pendent ────────────────────────────────────── */

const MAX_PENDING_ATTEMPTS = 10;

async function retryPendingOcos(): Promise<void> {
  const pending = pendingOcoGetAll();
  if (pending.length === 0) return;

  for (const p of pending) {
    if (p.attempts >= MAX_PENDING_ATTEMPTS) {
      log.auto.error({ symbol: p.symbol, id: p.id, attempts: p.attempts }, "OCO pendent: màxim d'intents assolit, eliminant");
      pendingOcoDelete(p.id);
      continue;
    }

    pendingOcoIncAttempts(p.id);
    log.auto.info({ symbol: p.symbol, id: p.id, attempt: p.attempts + 1 }, "reintentant OCO pendent…");

    try {
      const ocoResult = await placeOcoOrder({
        symbol:       p.symbol,
        side:         "SELL",
        quantity:     p.ocoQty,
        tpPrice:      p.tpPrice,
        slStopPrice:  p.slStopPrice,
        slLimitPrice: p.slLimitPrice,
      }) as Record<string, unknown>;

      await applyOcoSuccess(
        ocoResult, p.symbol, p.ocoQty, p.tpPrice, p.slStopPrice,
        p.fillPrice, 0, p.trailDist, p.trailMode, p.tickSize, p.atr,
        p.intervalTf, p.botName, p.quoteQty, p.score, p.journalId, p.tradeCode,
      );

      // Reconstrueix trailing amb els valors originals
      const orderListId = typeof ocoResult.orderListId === "number" ? ocoResult.orderListId : -1;
      if (orderListId !== -1) {
        trailingSet(orderListId, {
          symbol:      p.symbol,
          activateAt:  p.trailActAt,
          distance:    p.trailDist,
          activateAtr: 0,
          distanceAtr: 0,
          logic:       p.trailMode,
          quantity:    p.ocoQty,
          side:        "SELL",
          tickSize:    p.tickSize,
          entryPrice:  p.fillPrice,
        });
        ensureTrailingEngine();
      }

      pendingOcoDelete(p.id);
      log.auto.info({ symbol: p.symbol, id: p.id }, "OCO pendent col·locada amb èxit");
    } catch (err) {
      log.auto.warn({ symbol: p.symbol, id: p.id, err: (err as Error).message }, "reintent OCO pendent fallat");
    }
  }
}

/* ── Detecció i correcció de posicions sense SL ──────────────── */

const STABLES        = new Set(["USDT","USDC","BUSD","TUSD","DAI","FDUSD"]);
const ORPHAN_MIN_USD = 10;
const ORPHAN_FIX_MS  = 5 * 60 * 1000;  // 5 minuts

async function checkOrphanPositions(): Promise<void> {
  let openOrders: Awaited<ReturnType<typeof getOpenOrders>>;
  let account:    Awaited<ReturnType<typeof getAccount>>;
  try {
    [openOrders, account] = await Promise.all([getOpenOrders(), getAccount()]);
  } catch (err) {
    log.auto.warn({ err: (err as Error).message }, "checkOrphanPositions: error obtenint dades");
    return;
  }

  // Quantitat SELL coberta per símbol (suma de totes les ordres SELL obertes)
  const coveredQty = new Map<string, number>();
  for (const o of openOrders) {
    if (o.side !== "SELL") continue;
    const rem = parseFloat(o.origQty) - parseFloat(o.executedQty);
    coveredQty.set(o.symbol, (coveredQty.get(o.symbol) ?? 0) + rem);
  }

  // Afegeix la quantitat coberta per trailing actius (sl_order_id ja comptat a openOrders,
  // però hasActiveTrailing serveix com a indicador addicional)

  // Símbols que ja estan en pending_oco (ja gestionats)
  const pendingSymbols = new Set(pendingOcoGetAll().map(p => p.symbol));

  const now = Date.now();

  for (const bal of account.balances) {
    if (STABLES.has(bal.asset)) continue;

    const total = parseFloat(bal.free) + parseFloat(bal.locked);
    if (total <= 0) continue;

    const symbol = `${bal.asset}USDT`;

    // Obté preu de mercat per calcular valor USD
    let price: number;
    try { price = await getTickerPrice(symbol); }
    catch { continue; }

    const valueUsd = total * price;
    if (valueUsd < ORPHAN_MIN_USD) continue;

    // Quantitat desprotegida: posició total menys el que cobreixen les ordres SELL
    const covered      = coveredQty.get(symbol) ?? 0;
    const uncovered    = Math.max(0, total - covered);
    const uncoveredUsd = uncovered * price;

    // Totalment protegit (marge 2% per comissions/arrodoniments)
    if (uncoveredUsd < ORPHAN_MIN_USD || uncovered < total * 0.02) {
      orphanWatchDelete(symbol);
      continue;
    }

    if (pendingSymbols.has(symbol)) continue;  // ja s'està gestionant via pending_oco

    const watch = orphanWatchGet(symbol);

    if (!watch) {
      // Primera detecció: registrar i avisar
      orphanWatchUpsert(symbol);
      const meta = journalGetLastEntryMeta(symbol);
      log.auto.warn({ symbol, uncoveredUsd, uncovered }, "posició parcialment sense SL — esperant 5 min per corregir");
      notifyOrphanDetected({
        symbol,
        valueUsd:    uncoveredUsd,
        qty:         uncovered.toFixed(6),
        entryPrice:  meta?.price ?? null,
        fixIn:       5,
        orderId:     meta?.orderId     ?? null,
        orderListId: meta?.orderListId ?? null,
        tradeCode:   meta?.tradeCode   ?? null,
      }).catch(err => log.auto.warn({ err: (err as Error).message }, "notifyOrphanDetected fallida"));
      orphanWatchMarkNotified(symbol);
      continue;
    }

    // Ja detectada: esperar 5 minuts
    if (now - watch.detectedAt < ORPHAN_FIX_MS) continue;

    // Han passat 5 minuts: aplicar lògica del bot per fixar SL/TP
    log.auto.info({ symbol }, "aplicant correcció OCO a posició òrfena…");

    // Trobar el bot actiu per aquest símbol
    const bots = botGetAll().filter(b => b.enabled);
    let botConfig: SavedConfig | null = null;
    let activBot:  Bot | null = null;
    for (const bot of bots) {
      const cfg = loadSimConfig(bot.simId);
      if (cfg && cfg.config.symbols?.includes(symbol)) {
        botConfig = cfg;
        activBot  = bot;
        break;
      }
    }

    if (!botConfig || !activBot) {
      log.auto.warn({ symbol, uncoveredUsd }, "no s'ha trobat cap bot actiu — venent posició òrfena a mercat");
      try {
        let stepSize = cacheGet<{ stepSize: string }>(`exchange-info:${symbol}`)?.data.stepSize;
        if (!stepSize) {
          // Cache miss: fetch directly from Binance public API
          try {
            const infoRes = await fetch(
              `https://demo-api.binance.com/api/v3/exchangeInfo?symbol=${symbol}`,
              { cache: "no-store", signal: AbortSignal.timeout(5_000) },
            );
            const info = await infoRes.json() as { symbols?: { filters?: { filterType: string; stepSize?: string }[] }[] };
            const lot = info.symbols?.[0]?.filters?.find(f => f.filterType === "LOT_SIZE");
            stepSize = lot?.stepSize ?? "0.00001";
          } catch { stepSize = "0.00001"; }
        }
        const sellQty     = roundQty(uncovered, stepSize);
        const sellRes     = await placeMarketSell(symbol, sellQty);
        const executedQty = parseFloat(sellRes.executedQty);
        const receivedUsd = parseFloat(sellRes.cummulativeQuoteQty);
        const fillPrice   = executedQty > 0 ? receivedUsd / executedQty : price;
        const meta = journalGetLastEntryMeta(symbol);
        log.auto.info({ symbol, sellQty, receivedUsd, fillPrice }, "venda òrfena executada");
        notifyOrphanNoBot({
          symbol,
          qty:         sellQty,
          fillPrice,
          receivedUsd,
          entryPrice:  meta?.price       ?? null,
          orderId:     meta?.orderId     ?? null,
          orderListId: meta?.orderListId ?? null,
          tradeCode:   meta?.tradeCode   ?? null,
        }).catch(err => log.auto.warn({ err: (err as Error).message }, "notifyOrphanNoBot fallida"));
      } catch (sellErr) {
        log.auto.error({ symbol, err: (sellErr as Error).message }, "error en venda òrfena a mercat");
      }
      orphanWatchDelete(symbol);
      continue;
    }

    const { config } = botConfig;
    const interval   = config.interval;
    const tpAtr      = config.tpAtr      ?? 2.5;
    const slAtr      = config.slAtr      ?? 1.0;
    const trailAct   = config.trailActivateAtr  ?? 1.5;
    const trailDst   = config.trailDistanceAtr  ?? 1.0;
    const trailMode  = settingGet("trailing_sl_mode") || "ATR";

    // Obté ATR actual
    let analysis: Awaited<ReturnType<typeof fetchAndAnalyze>>;
    try { analysis = await fetchAndAnalyze(symbol, interval); }
    catch (err) {
      log.auto.warn({ symbol, err: (err as Error).message }, "correcció òrfena: error obtenint ATR");
      continue;
    }

    // Preu d'entrada: des del journal o preu actual com a fallback
    const journalEntry = journalGetLastEntryPrice(symbol, null);
    const fillPrice    = journalEntry?.price ?? price;

    // tickSize / stepSize — Binance públic (no requereix auth)
    let tickSize = "0.01";
    let stepSize = "0.00001";
    const cachedInfo = cacheGet<{ tickSize: string; stepSize: string }>(`exchange-info:${symbol}`);
    if (cachedInfo) {
      tickSize = cachedInfo.data.tickSize ?? tickSize;
      stepSize = cachedInfo.data.stepSize ?? stepSize;
    } else {
      try {
        const eiRes = await fetch(
          `https://api.binance.com/api/v3/exchangeInfo?symbol=${symbol}`,
          { signal: AbortSignal.timeout(10_000) },
        );
        if (eiRes.ok) {
          const eiData = await eiRes.json() as { symbols?: Array<{ filters: Array<{ filterType: string; stepSize?: string; tickSize?: string }> }> };
          const filters = eiData.symbols?.[0]?.filters ?? [];
          const lot   = filters.find(f => f.filterType === "LOT_SIZE");
          const price = filters.find(f => f.filterType === "PRICE_FILTER");
          if (lot?.stepSize)   stepSize = lot.stepSize;
          if (price?.tickSize) tickSize = price.tickSize;
        }
      } catch {
        log.auto.warn({ symbol }, "correcció òrfena: no s'ha pogut obtenir exchange-info, usant defaults BTC");
      }
    }

    // Quantitat desprotegida arrodonida al stepSize
    const stepNum = parseFloat(stepSize);
    const stepDp  = stepSize.includes(".") ? stepSize.length - stepSize.indexOf(".") - 1 : 0;
    const ocoQty  = (Math.floor(uncovered / stepNum) * stepNum).toFixed(stepDp);

    // Preus TP / SL
    const tickNum      = parseFloat(tickSize);
    const tpPrice      = roundPriceUp(Math.max(fillPrice + tpAtr * analysis.atr, price + 2 * tickNum), tickSize);
    const slStopPrice  = roundPriceDown(Math.min(fillPrice - slAtr * analysis.atr, price - 2 * tickNum), tickSize);
    const slLimitPrice = roundPriceDown(parseFloat(slStopPrice) * 0.999, tickSize);

    try {
      const ocoResult = await placeOcoOrder({
        symbol, side: "SELL", quantity: ocoQty,
        tpPrice, slStopPrice, slLimitPrice,
      }) as Record<string, unknown>;

      const journalId = journalAdd({
        type: "ENTRY_OCO", symbol, side: "SELL",
        qty: ocoQty, price: String(fillPrice), quoteQty: "0",
        commission: "0", commissionAsset: "BNB",
        entryPrice: null, pnlUsdt: null, pnlPct: null,
        orderId: null,
        orderListId: typeof ocoResult.orderListId === "number" ? ocoResult.orderListId : null,
        strategy: null, interval, entryType: "MARKET", trailingMode: trailMode,
        exitReason: null, capitalUsdt: null, capitalMode: settingGet("capital_mode"),
        notes: `Correcció automàtica OCO òrfena · Bot: ${activBot.name}`,
        tradeCode: journalGetLastEntryPrice(symbol, null) ? journalGetLastTradeCode(symbol) : null,
        source: "AUTO", executedAt: now,
      });

      await applyOcoSuccess(
        ocoResult, symbol, ocoQty, tpPrice, slStopPrice,
        fillPrice, trailAct, trailDst, trailMode, tickSize, analysis.atr,
        interval, activBot.name, valueUsd, 0, journalId, null,
      );

      orphanWatchDelete(symbol);
      log.auto.info({ symbol, tpPrice, slStopPrice }, "OCO correctora col·locada amb èxit");
    } catch (err) {
      log.auto.error({ symbol, err: (err as Error).message }, "error en col·locar OCO correctora");
      // Reset the orphan watch so next cycle it starts fresh with a new 5-min timer,
      // instead of hammering every 60s indefinitely.
      orphanWatchDelete(symbol);
    }
  }
}

/* ── Global poll ─────────────────────────────────────────────── */

let _polling = false;

async function globalPoll(): Promise<void> {
  if (_polling) return;
  _polling = true;
  try {
    // Reintenta OCO pendents i detecta posicions sense SL (independentment del master switch)
    await retryPendingOcos();
    await checkOrphanPositions();

    // Master switch
    if (!settingGetBool("auto_trade_enabled")) return;

    const bots = botGetAll().filter(b => b.enabled);
    if (bots.length === 0) return;

    for (const bot of bots) {
      const simConfig = loadSimConfig(bot.simId);
      if (!simConfig) {
        log.auto.warn({ bot: bot.name, simId: bot.simId }, "bot: simulació no trobada, saltant");
        continue;
      }

      const interval = simConfig.config.interval;
      // MTF: for bots with interval ≥ 1h, check every 1h using closed higher-TF candles
      const checkInterval = (INTERVAL_MS[interval] ?? 0) >= INTERVAL_MS["1h"] ? "1h" : interval;
      if (!candleJustClosed(checkInterval)) continue;

      // Run in background (non-blocking for other bots)
      runBotScan(bot, simConfig).catch(err =>
        log.auto.error({ bot: bot.name, err: (err as Error).message }, "error en globalPoll runBotScan"),
      );
    }
  } finally {
    _polling = false;
    global.__autoTraderLastRun    = Date.now();
    global.__autoTraderLastResult = "ok";
  }
}

/* ── Singleton entry point ───────────────────────────────────── */

export function ensureAutoTrader(): void {
  if (global.__autoTraderStarted) return;
  global.__autoTraderStarted = true;
  log.auto.info("auto-trader multi-bot iniciat (poll 60s)");

  // Poll every 60s
  global.__autoTraderTimer = setInterval(() => {
    globalPoll().catch(err =>
      log.auto.error({ err: (err as Error).message }, "error en globalPoll"),
    );
  }, 60_000);

  // Also run immediately after 5s to catch any missed candle
  setTimeout(() => {
    globalPoll().catch(err => log.auto.warn({ err: (err as Error).message }, "error en globalPoll inicial"));
  }, 5_000);
}
