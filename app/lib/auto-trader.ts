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
import { settingGet, settingGetBool } from "./settings-store";
import { botGetAll, type Bot } from "./bot-store";
import {
  placeMarketBuy, placeOcoOrder, getTickerPrice,
  roundPriceUp, roundPriceDown, getOpenOrders,
} from "./binance-auth";
import { cacheGet, trailingSet, nextTradeCode, orderMetaSet } from "./cache-store";
import { ensureTrailingEngine } from "./trailing-engine";
import { journalAdd } from "./journal-store";
import { notifyNewOrder } from "./telegram";
import { log } from "./logger";
import path from "path";
import fs from "fs";

declare global {
  var __autoTraderStarted: boolean | undefined;
  var __autoTraderTimer:   ReturnType<typeof setInterval> | undefined;
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
    `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=250`,
    { cache: "no-store", signal: AbortSignal.timeout(10_000) },
  );
  // B4: backoff on rate limit
  if (res.status === 429 && retry < 3) {
    await new Promise(r => setTimeout(r, Math.pow(2, retry) * 1000));
    return fetchAndAnalyze(symbol, interval, retry + 1);
  }
  if (!res.ok) throw new Error(`Binance klines ${symbol}/${interval}: ${res.status}`);
  const raw: unknown[][] = await res.json();
  const candles: OHLCV[] = raw.map(k => ({
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

  // 4. Col·loca l'OCO de sortida
  const ocoResult = await placeOcoOrder({
    symbol, side: "SELL", quantity: ocoQty,
    tpPrice, slStopPrice, slLimitPrice,
  }) as Record<string, unknown>;

  log.auto.info(
    { symbol, interval, score, fillPrice, tpPrice, slStopPrice, qty: ocoQty, bot: botName },
    "auto-compra executada",
  );

  // 5. Notificació Telegram
  if (settingGetBool("tg_on_new_order")) {
    notifyNewOrder({
      symbol, type: "BUY_AND_EXIT",
      quoteQty,
      fillPrice,
      tpPrice,
      slStopPrice,
      orderListId: typeof ocoResult.orderListId === "number" ? ocoResult.orderListId : -1,
    }).catch(err => log.auto.warn({ err: (err as Error).message }, "notifyNewOrder fallida"));
  }

  // 6. Codi d'operació + metadades
  let tradeCode: string | null = null;
  if (typeof ocoResult.orderListId === "number" && ocoResult.orderListId > 0) {
    tradeCode = nextTradeCode();
    orderMetaSet(`oco:${ocoResult.orderListId}`, { tradeCode, interval, botName });
  }

  // 7. Trailing stop suggestion
  const activateAt = fillPrice + trailAct * atr;
  const distance   = trailDst * atr;
  if (typeof ocoResult.orderListId === "number" && ocoResult.orderListId !== -1) {
    trailingSet(ocoResult.orderListId, {
      symbol,
      activateAt, distance,
      activateAtr: trailAct, distanceAtr: trailDst, logic: trailMode,
      quantity: ocoQty, side: "SELL", tickSize, entryPrice: fillPrice,
    });
    ensureTrailingEngine();
  }

  // 8. Journal
  journalAdd({
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
    orderListId:     typeof ocoResult.orderListId === "number" ? ocoResult.orderListId : null,
    strategy:        null,
    interval,
    entryType:       "MARKET",
    trailingMode:    trailMode,
    exitReason:      null,
    capitalUsdt:     quoteQty,
    capitalMode:     settingGet("capital_mode"),
    notes:           `Auto-trade · Bot: ${botName} · score ${score} · ${interval}`,
    tradeCode,
    source:          "AUTO",
    executedAt:      Date.now(),
  });
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
  const minScore   = effectiveConfig?.minProbability ?? 80;

  // Finestra horària (UTC)
  const nowHour = new Date().getUTCHours();
  if (nowHour < bot.hoursFrom || nowHour >= bot.hoursTo) {
    log.auto.debug({ bot: bot.name, nowHour, from: bot.hoursFrom, to: bot.hoursTo }, "bot fora de finestra horària");
    return;
  }

  // Màxim diari per-bot
  if (getBotTodayCount(bot.id) >= bot.maxDaily) {
    log.auto.debug({ bot: bot.name, count: getBotTodayCount(bot.id), max: bot.maxDaily }, "bot: màxim diari assolit");
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
  const committed = openOcoCount * usdtPer;
  if (committed + usdtPer > bot.budgetUsdt) {
    log.auto.debug({ bot: bot.name, committed, budget: bot.budgetUsdt }, "bot: pressupost exhaurit");
    return;
  }

  log.auto.info({ bot: bot.name, interval, symbols: symbols.length, minScore }, "iniciant scan de bot");

  for (const symbol of symbols) {
    // Re-comprova límit diari
    if (getBotTodayCount(bot.id) >= bot.maxDaily) break;

    try {
      const analysis = await fetchAndAnalyze(symbol, interval);

      if (analysis.score < minScore || analysis.verdict !== "BUY") {
        log.auto.debug({ bot: bot.name, symbol, score: analysis.score, verdict: analysis.verdict }, "sense senyal");
        continue;
      }

      // Multi-TF check (opcional)
      if (bot.requireMultiTf) {
        // Scan en el TF superior com a confirmació
        const higherTf: Record<string, string> = { "5m": "1h", "15m": "1h", "30m": "1h", "1h": "4h", "4h": "1d" };
        const confirmTf = higherTf[interval];
        if (confirmTf) {
          const confirm = await fetchAndAnalyze(symbol, confirmTf);
          if (confirm.score < minScore || confirm.verdict !== "BUY") {
            log.auto.debug({ bot: bot.name, symbol, interval, confirmTf }, "multi-TF no confirmat");
            continue;
          }
        }
      }

      log.auto.info({ bot: bot.name, symbol, interval, score: analysis.score }, "senyal → comprant");

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
}

/* ── Global poll ─────────────────────────────────────────────── */

let _polling = false;

async function globalPoll(): Promise<void> {
  if (_polling) return;
  _polling = true;
  try {
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
      if (!candleJustClosed(interval)) continue;

      // Run in background (non-blocking for other bots)
      runBotScan(bot, simConfig).catch(err =>
        log.auto.error({ bot: bot.name, err: (err as Error).message }, "error en globalPoll runBotScan"),
      );
    }
  } finally {
    _polling = false;
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
