/**
 * Scheduler — tasques periòdiques de Telegram
 *
 * • Cada hora en punt: canvi real de saldo vs snapshot 1h
 * • Cada hora en punt: comprovació consistència ordres Binance vs DB local
 * • Cada dia a les 7:30: resum 24h amb gràfic de portfolio
 * • Cada 15 min: snapshot del portfolio (per calcular deltes)
 */

import { getAccount, getOpenOrders } from "./binance-auth";
import { getSnapshots, addSnapshot } from "./snapshot-store";
import { sendPortfolioReport, sendHourlyPortfolioReport, sendTelegram, isConfigured } from "./telegram";
import { db, orderMetaGet } from "./cache-store";
import { log }                        from "./logger";
import { STABLES, BINANCE_BASE }      from "./constants";
import { getQuoteAsset, settingGetBool } from "./settings-store";
import type { TradingMode } from "./binance-auth";

const schedulerEnabled = () =>
  settingGetBool("scheduler_enabled") || settingGetBool("scheduler_enabled_real");
declare global {
  var __schedulerStarted:      boolean | undefined;
  var __schedulerLastSnapshot: number  | undefined;
  var __schedulerLastHourly:   number  | undefined;
  var __schedulerLastDaily:    number  | undefined;
}

export function getSchedulerStatus() {
  return {
    started:      !!global.__schedulerStarted,
    lastSnapshot: global.__schedulerLastSnapshot ?? null,
    lastHourly:   global.__schedulerLastHourly   ?? null,
    lastDaily:    global.__schedulerLastDaily     ?? null,
  };
}

function msUntilNextHour(): number {
  const now  = new Date();
  const next = new Date(now);
  next.setHours(next.getHours() + 1, 0, 0, 0);
  return next.getTime() - now.getTime();
}

function msUntilNext(hour: number, min: number): number {
  const now  = new Date();
  const next = new Date(now);
  next.setHours(hour, min, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

// ── Dades del portfolio ───────────────────────────────────────────────────────

interface PortfolioData {
  totalValue:   number;
  cryptoValue:  number;
  stableValue:  number;
  pnl24h:       number;   // variació de mercat 24h (NO guanys realitzats)
  pnlPct:       number;
  openOrders:   number;
  ocoCount:     number;
  limitCount:   number;
  top:     Array<{ asset: string; valueUSD: number; pct: number; change24h: number }>;
  stables: Array<{ asset: string; valueUSD: number; pct: number }>;
}

interface Ticker { symbol: string; lastPrice: string; priceChangePercent: string; }

async function fetchPortfolioData(mode: TradingMode = "paper"): Promise<PortfolioData> {
  const [account, openOrders] = await Promise.all([getAccount(mode), getOpenOrders(mode)]);

  const assets = account.balances.filter(b => parseFloat(b.free) + parseFloat(b.locked) > 0.000001);
  const qa     = getQuoteAsset();
  const pairs  = assets.filter(b => !STABLES.has(b.asset)).map(b => `${b.asset}${qa}`);

  const tickerMap = new Map<string, Ticker>();
  const results = await Promise.allSettled(
    pairs.map(p =>
      fetch(`${BINANCE_BASE}/ticker/24hr?symbol=${p}`, { cache: "no-store" })
        .then(r => r.json() as Promise<Ticker>)
    )
  );
  results.forEach((r, i) => { if (r.status === "fulfilled") tickerMap.set(pairs[i], r.value); });

  let totalValue = 0;
  let totalPnl24 = 0;

  const rows = assets.map(b => {
    const qty       = parseFloat(b.free) + parseFloat(b.locked);
    const isStable  = STABLES.has(b.asset);
    const ticker    = tickerMap.get(`${b.asset}${qa}`);
    const price     = ticker?.lastPrice ? parseFloat(ticker.lastPrice) : (isStable ? 1 : 0);
    const change24h = ticker?.priceChangePercent ? parseFloat(ticker.priceChangePercent) : 0;
    const valueUSD  = qty * price;
    const pnl24h    = valueUSD * (change24h / 100);
    totalValue += valueUSD;
    totalPnl24 += pnl24h;
    return { asset: b.asset, valueUSD, pct: 0, change24h };
  });

  rows.forEach(r => { r.pct = totalValue > 0 ? (r.valueUSD / totalValue) * 100 : 0; });

  const pnlPct   = totalValue > 0 ? (totalPnl24 / (totalValue - totalPnl24)) * 100 : 0;
  const ocoCount = new Set(openOrders.filter(o => o.orderListId !== -1).map(o => o.orderListId)).size;
  const limCount = openOrders.filter(o => o.orderListId === -1).length;

  // Cryptos >= $10, ordenades per valor
  const top = [...rows]
    .filter(r => r.valueUSD >= 10 && !STABLES.has(r.asset))
    .sort((a, b) => b.valueUSD - a.valueUSD)
    .slice(0, 8);

  // Stables amb saldo > $0.01
  const stables = [...rows]
    .filter(r => STABLES.has(r.asset) && r.valueUSD > 0.01)
    .sort((a, b) => b.valueUSD - a.valueUSD);

  const cryptoValue = rows.filter(r => !STABLES.has(r.asset)).reduce((s, r) => s + r.valueUSD, 0);
  const stableValue = stables.reduce((s, r) => s + r.valueUSD, 0);

  return { totalValue, cryptoValue, stableValue, pnl24h: totalPnl24, pnlPct, openOrders: openOrders.length, ocoCount, limitCount: limCount, top, stables };
}

/** Snapshot més proper a `targetMs` en el passat. */
function snapshotNear(targetMs: number, mode: TradingMode = "paper") {
  const snaps = getSnapshots(mode).filter(s => s.time <= targetMs);
  return snaps.length > 0 ? snaps[snaps.length - 1] : null;
}

// ── Comprovació consistència ordres (cada hora) ───────────────────────────────

async function checkOrderConsistencyForMode(mode: TradingMode): Promise<{ orphanTrailing: number[]; binanceCount: number }> {
  const binanceOrders = await getOpenOrders(mode);
  const binanceIds    = new Set(binanceOrders.map(o => o.orderId));

  const trailingRows = db.prepare(
    "SELECT sl_order_id FROM trailing_active WHERE status = 'active' AND mode = ?"
  ).all(mode) as Array<{ sl_order_id: number }>;

  const orphanTrailing: number[] = [];
  for (const { sl_order_id } of trailingRows) {
    if (!binanceIds.has(sl_order_id)) orphanTrailing.push(sl_order_id);
  }

  return { orphanTrailing, binanceCount: binanceOrders.length };
}

async function checkOrderConsistency(): Promise<void> {
  if (!schedulerEnabled() || !isConfigured()) return;
  try {
    const modes: TradingMode[] = ["paper", "real"];
    const allOrphans: { mode: TradingMode; ids: number[]; binanceCount: number }[] = [];

    for (const mode of modes) {
      try {
        const { orphanTrailing, binanceCount } = await checkOrderConsistencyForMode(mode);
        if (orphanTrailing.length > 0)
          allOrphans.push({ mode, ids: orphanTrailing, binanceCount });
        else
          log.telegram.debug({ mode, total: binanceCount }, "comprovació ordres OK");
      } catch (err) {
        log.telegram.warn({ mode, err: (err as Error).message }, "checkOrderConsistency: error obtenint ordres");
      }
    }

    if (allOrphans.length === 0) return;

    const lines: string[] = ["⚠️ *Divergència d'ordres detectada*", ""];
    for (const { mode, ids, binanceCount } of allOrphans) {
      const modeLabel = mode === "real" ? "🔴 REAL" : "📄 Paper";
      lines.push(`${modeLabel} — Binance té *${binanceCount}* ordres obertes.`);
      lines.push(`🔴 Trailing actiu a la DB però absent a Binance (${ids.length}):`);
      for (const id of ids) {
        const meta = orderMetaGet(`order:${id}`);
        lines.push(`  • orderId=${id}${meta?.tradeCode ? ` tradeCode=${meta.tradeCode}` : ""}`);
      }
      lines.push("");
    }

    lines.push(`_${new Date().toLocaleString("ca-ES")}_`);
    await sendTelegram(lines.join("\n"));
    log.telegram.warn({ allOrphans }, "divergència d'ordres detectada");
  } catch (err) {
    log.telegram.error({ err: (err as Error).message }, "error comprovació ordres");
  }
}

// ── Informe horari ────────────────────────────────────────────────────────────
// Mostra canvi REAL de saldo (snapshot delta), NO variació de mercat.
// La variació de mercat 24h és correcta al resum diari, no cada hora.

// ── Informe horari ────────────────────────────────────────────────────────────

function activeModes(): TradingMode[] {
  const modes: TradingMode[] = [];
  if (settingGetBool("scheduler_enabled")) modes.push("paper");
  if (settingGetBool("scheduler_enabled_real") && process.env.BINANCE_API_KEY_REAL) modes.push("real");
  return modes;
}

async function sendHourlyReport(): Promise<void> {
  if (!isConfigured()) return;
  const modes = activeModes();
  if (modes.length === 0) return;

  for (const mode of modes) {
    try {
      const portfolio = await fetchPortfolioData(mode);
      const snap1h    = snapshotNear(Date.now() - 60 * 60 * 1000, mode);
      const delta1h   = snap1h ? portfolio.totalValue - snap1h.value : null;

      await sendHourlyPortfolioReport({
        totalValue:  portfolio.totalValue,
        delta1h,
        openOrders:  portfolio.openOrders,
        ocoCount:    portfolio.ocoCount,
        limitCount:  portfolio.limitCount,
        top:         portfolio.top,
        stables:     portfolio.stables,
        mode,
      });
      log.telegram.info({ mode }, "informe horari enviat");
    } catch (err) {
      log.telegram.error({ err: (err as Error).message, mode }, "error informe horari");
    }
  }
  global.__schedulerLastHourly = Date.now();
}

// ── Informe diari (7:30) amb gràfic ──────────────────────────────────────────

async function sendDailyReport(): Promise<void> {
  if (!isConfigured()) return;
  const modes = activeModes();
  if (modes.length === 0) return;

  for (const mode of modes) {
    try {
      const portfolio = await fetchPortfolioData(mode);
      const snap24h   = snapshotNear(Date.now() - 24 * 60 * 60 * 1000, mode);
      const delta24h  = snap24h ? portfolio.totalValue - snap24h.value : null;

      await sendPortfolioReport({
        totalValue:  portfolio.totalValue,
        cryptoValue: portfolio.cryptoValue,
        stableValue: portfolio.stableValue,
        pnl24h:      portfolio.pnl24h,
        pnlPct:      portfolio.pnlPct,
        delta24h,
        openOrders:  portfolio.openOrders,
        ocoCount:    portfolio.ocoCount,
        limitCount:  portfolio.limitCount,
        top:         portfolio.top,
        stables:     portfolio.stables,
        mode,
      });
      log.telegram.info({ mode }, "informe diari enviat");
    } catch (err) {
      log.telegram.error({ err: (err as Error).message, mode }, "error informe diari");
    }
  }
  global.__schedulerLastDaily = Date.now();
}

// ── Snapshot del portfolio (cada 15 min) ─────────────────────────────────────

const SNAPSHOT_INTERVAL_MS = 15 * 60 * 1000;

async function takeSnapshotForMode(mode: TradingMode): Promise<number | null> {
  const account = await getAccount(mode);
  const assets  = account.balances.filter(b => parseFloat(b.free) + parseFloat(b.locked) > 1e-8);
  const qa2     = getQuoteAsset();
  const pairs   = assets.filter(b => !STABLES.has(b.asset)).map(b => `${b.asset}${qa2}`);

  const tickerResults = await Promise.allSettled(
    pairs.map(p =>
      fetch(`${BINANCE_BASE}/ticker/24hr?symbol=${p}`, { cache: "no-store" })
        .then(r => r.json() as Promise<{ lastPrice: string }>)
    )
  );

  const priceMap = new Map<string, number>();
  pairs.forEach((p, i) => {
    const r = tickerResults[i];
    if (r.status === "fulfilled") priceMap.set(p.replace(new RegExp(`${qa2}$`), ""), parseFloat(r.value.lastPrice));
  });

  let total = 0;
  for (const b of assets) {
    const qty   = parseFloat(b.free) + parseFloat(b.locked);
    const price = priceMap.get(b.asset) ?? (STABLES.has(b.asset) ? 1 : 0);
    total += qty * price;
  }
  return total > 0 ? total : null;
}

async function takePortfolioSnapshot(): Promise<void> {
  const modes = activeModes();
  if (modes.length === 0) return;

  for (const mode of modes) {
    try {
      const total = await takeSnapshotForMode(mode);
      if (total !== null) {
        addSnapshot({ time: Date.now(), value: total }, mode);
        log.telegram.debug({ total, mode }, "snapshot del portfolio desat");
      }
    } catch (err) {
      log.telegram.warn({ err: (err as Error).message, mode }, "error en prendre snapshot");
    }
  }
  global.__schedulerLastSnapshot = Date.now();
}

// ── Arrencada ─────────────────────────────────────────────────────────────────

export function ensureScheduler(): void {
  if (global.__schedulerStarted) return;
  global.__schedulerStarted = true;

  const msHour = msUntilNextHour();
  const msDay  = msUntilNext(7, 30);

  log.telegram.info(
    { nextHourIn: Math.round(msHour / 60000), nextDailyIn: Math.round(msDay / 60000) },
    "scheduler iniciat"
  );

  // Snapshot cada 15 min (usa 24hr ticker, consistent amb els informes)
  takePortfolioSnapshot();
  setInterval(takePortfolioSnapshot, SNAPSHOT_INTERVAL_MS);

  // Informe horari + comprovació ordres: alineats al pròxim toc d'hora
  setTimeout(() => {
    sendHourlyReport();
    checkOrderConsistency();
    setInterval(() => { sendHourlyReport(); checkOrderConsistency(); }, 60 * 60 * 1000);
  }, msHour);

  // Informe diari: 7:30 cada dia
  setTimeout(() => {
    sendDailyReport();
    setInterval(sendDailyReport, 24 * 60 * 60 * 1000);
  }, msDay);
}
