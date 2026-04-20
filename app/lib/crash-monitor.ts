/**
 * crash-monitor.ts
 * Monitors BTC price for extreme drops and triggers emergency exit automatically.
 *
 * Thresholds (configurable via env):
 *   CRASH_PCT_5M  = drop % in 5 minutes  (default 5%)
 *   CRASH_PCT_15M = drop % in 15 minutes (default 8%)
 *   CRASH_PCT_60M = drop % in 60 minutes (default 12%)
 */

import { getTickerPrice, getOpenOrders, cancelOrder, cancelOcoOrder, getAccount, placeMarketSell, roundPriceDown, type TradingMode } from "./binance-auth";
import { cacheGet } from "./cache-store";
import { log } from "./logger";
import { sendTelegram } from "./telegram";
import { getQuoteAsset, settingGetBool, settingGetBoolForMode } from "./settings-store";

const NEVER_SELL = new Set(["USDT", "USDC", "BUSD", "FDUSD", "TUSD", "BNB"]);

declare global {
  var __crashMonitorStarted:    boolean | undefined;
  var __crashMonitorLastRun:    number  | undefined;
  var __crashMonitorLastResult: string  | undefined;
}

export function getCrashMonitorStatus() {
  return {
    started:       !!global.__crashMonitorStarted,
    lastRun:       global.__crashMonitorLastRun    ?? null,
    lastResult:    global.__crashMonitorLastResult ?? null,
    historyPoints: history.length,
    lastAlertTs:   lastAlertTs > 0 ? lastAlertTs : null,
  };
}

const POLL_MS      = 60_000;          // check every minute
const WINDOW_SIZE  = 60;             // keep 60 minutes of history
const MONITOR_SYMBOL = "BTCUSDC";

// C5: validate threshold env vars at module load time; fall back to safe defaults
function parseThreshold(val: string | undefined, defaultVal: number): number {
  const n = parseFloat(val ?? String(defaultVal));
  return Number.isFinite(n) && n > 0 ? n : defaultVal;
}

const THRESHOLDS = [
  { windowMin: 5,  pct: parseThreshold(process.env.CRASH_PCT_5M,  5)  },
  { windowMin: 15, pct: parseThreshold(process.env.CRASH_PCT_15M, 8)  },
  { windowMin: 60, pct: parseThreshold(process.env.CRASH_PCT_60M, 12) },
];

interface PricePoint { ts: number; price: number; }

const history: PricePoint[] = [];
let lastAlertTs = 0;
const ALERT_COOLDOWN_MS = 30 * 60_000; // 30 min between alerts

async function emergencyExitForMode(mode: TradingMode, drop: number, windowMin: number, price: number, oldPrice: number): Promise<void> {
  const modeLabel = mode === "real" ? "REAL" : "PAPER";
  log.orders.error(
    { mode, symbol: MONITOR_SYMBOL, windowMin, drop: drop.toFixed(2), price, oldPrice },
    `🚨 CRASH DETECTAT [${modeLabel}] — iniciando sortida d'emergència`,
  );

  // 1. Cancel all open orders
  const orders = await getOpenOrders(mode);
  const canceledOcos = new Set<number>();
  let canceledCount = 0;

  for (const order of orders) {
    try {
      if (order.orderListId !== -1) {
        if (!canceledOcos.has(order.orderListId)) {
          canceledOcos.add(order.orderListId);
          await cancelOcoOrder(order.symbol, order.orderListId, mode);
          canceledCount++;
        }
      } else {
        await cancelOrder(order.symbol, order.orderId, mode);
        canceledCount++;
      }
    } catch (e) {
      log.orders.warn({ mode, orderId: order.orderId, err: (e as Error).message }, "crash monitor: error cancel·lant ordre");
    }
  }

  log.orders.warn({ mode, canceled: canceledCount }, "Crash monitor: ordres cancel·lades");

  // 2. Wait for locked balances to release, then sell all crypto
  await new Promise(r => setTimeout(r, 1500));

  const account = await getAccount(mode);
  const sellResults: { symbol: string; qty: string; quoteQty: string }[] = [];

  for (const bal of account.balances) {
    const free = parseFloat(bal.free);
    if (free <= 0 || NEVER_SELL.has(bal.asset)) continue;
    const symbol = `${bal.asset}${getQuoteAsset()}`;
    try {
      const exInfo   = cacheGet<{ stepSize: string }>(`exchange-info:${symbol}`);
      const stepSize = exInfo?.data.stepSize ?? "0.001";
      const qty      = roundPriceDown(free, stepSize);
      if (parseFloat(qty) <= 0) continue;
      const result = await placeMarketSell(symbol, qty, mode);
      sellResults.push({ symbol, qty, quoteQty: result.cummulativeQuoteQty });
      log.orders.warn({ mode, symbol, qty, quoteQty: result.cummulativeQuoteQty }, "crash monitor: venda d'emergència executada");
    } catch (e) {
      log.orders.error({ mode, symbol, err: (e as Error).message }, "crash monitor: error venent posició");
    }
  }

  // 3. Notify
  const soldSummary = sellResults.length > 0
    ? `\n\n💸 <b>Posicions venudes [${modeLabel}]:</b>\n${sellResults.map(s => `• ${s.symbol}: ${s.qty} → ${parseFloat(s.quoteQty).toFixed(2)} USDC`).join("\n")}`
    : `\n\n⚠️ Cap posició oberta per vendre [${modeLabel}].`;

  await sendTelegram(
    `✅ <b>Sortida d'emergència completada [${modeLabel}]</b>\n` +
    `Ordres cancel·lades: ${canceledCount}\n` +
    `Posicions venudes: ${sellResults.length}` +
    soldSummary,
  ).catch(err => log.orders.warn({ err: (err as Error).message }, "crash monitor: sendTelegram (confirm) fallida"));
}

async function checkCrash(): Promise<void> {
  const now   = Date.now();
  // Use paper mode (testnet) for price monitoring — testnet BTC price tracks real price closely enough for crash detection
  // For production accuracy, prefer real mode if available
  const price = await getTickerPrice(MONITOR_SYMBOL, "real").catch(
    () => getTickerPrice(MONITOR_SYMBOL, "paper").catch(() => null)
  );
  if (!price) return;

  history.push({ ts: now, price });

  // Keep only last WINDOW_SIZE minutes
  const cutoff = now - WINDOW_SIZE * 60_000;
  while (history.length > 0 && history[0].ts < cutoff) history.shift();

  if (history.length < 2) return;

  for (const { windowMin, pct } of THRESHOLDS) {
    const windowCutoff = now - windowMin * 60_000;
    const oldest = history.find(p => p.ts >= windowCutoff);
    if (!oldest) continue;

    const drop = ((oldest.price - price) / oldest.price) * 100;
    if (drop >= pct) {
      if (now - lastAlertTs < ALERT_COOLDOWN_MS) return; // already alerted recently
      lastAlertTs = now;

      await sendTelegram(
        `🚨 <b>CRASH DETECTAT</b>\n\n` +
        `BTC ha caigut <b>${drop.toFixed(2)}%</b> en els últims ${windowMin} minuts\n` +
        `Preu ara: <code>${price.toFixed(2)} USDC</code>\n` +
        `Preu fa ${windowMin}m: <code>${oldest.price.toFixed(2)} USDC</code>\n\n` +
        `⚠️ Iniciant cancel·lació automàtica de totes les ordres (paper + real)…`,
      ).catch(err => log.orders.warn({ err: (err as Error).message }, "crash monitor: sendTelegram (alert) fallida"));

      // Execute emergency exit per mode (only if enabled for that mode)
      const paperEnabled = settingGetBoolForMode("crash_monitor_enabled", "paper");
      const realEnabled  = settingGetBoolForMode("crash_monitor_enabled", "real");
      if (!paperEnabled && !realEnabled) {
        log.orders.warn({ drop: drop.toFixed(2), windowMin }, "Crash monitor: crash detectat però motor DESACTIVAT — no s'executa sortida d'emergència");
        await sendTelegram(
          `🚨 <b>CRASH DETECTAT — motor desactivat</b>\n\n` +
          `BTC ha caigut <b>${drop.toFixed(2)}%</b> en ${windowMin}m però el <b>Crash monitor</b> està desactivat.\n` +
          `⚠️ Activa'l a Configuració → Motors i processos per habilitar la sortida automàtica.`,
        ).catch(() => {});
        global.__crashMonitorLastResult = `crash: ${drop.toFixed(1)}% en ${windowMin}m — MOTOR DESACTIVAT`;
        global.__crashMonitorLastRun    = Date.now();
        return;
      }
      try {
        await Promise.all([
          paperEnabled
            ? emergencyExitForMode("paper", drop, windowMin, price, oldest.price).catch(e =>
                log.orders.error({ err: (e as Error).message }, "Crash monitor: error sortida paper")
              )
            : Promise.resolve(),
          realEnabled
            ? emergencyExitForMode("real", drop, windowMin, price, oldest.price).catch(e =>
                log.orders.error({ err: (e as Error).message }, "Crash monitor: error sortida real")
              )
            : Promise.resolve(),
        ]);
      } catch (e) {
        log.orders.error({ err: (e as Error).message }, "Crash monitor: error en sortida d'emergència");
      }

      global.__crashMonitorLastResult = `crash: ${drop.toFixed(1)}% en ${windowMin}m`;
      global.__crashMonitorLastRun    = Date.now();
      return; // don't check more thresholds after triggering
    }
  }

  global.__crashMonitorLastRun    = Date.now();
  global.__crashMonitorLastResult = `ok: ${history.length} punts`;
}

export function ensureCrashMonitor(): void {
  if (global.__crashMonitorStarted) return;
  global.__crashMonitorStarted = true;

  log.orders.info(
    { symbol: MONITOR_SYMBOL, thresholds: THRESHOLDS, pollMs: POLL_MS },
    "Crash monitor iniciat",
  );

  // Initial check, then every minute
  checkCrash().catch(err => log.orders.warn({ err: (err as Error).message }, "crash monitor: error inicial"));
  setInterval(() => checkCrash().catch(err => log.orders.warn({ err: (err as Error).message }, "crash monitor: error poll")), POLL_MS);
}
