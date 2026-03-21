/**
 * Scheduler — tasques periòdiques de Telegram
 *
 * • Cada hora en punt: canvi real de saldo vs snapshot 1h
 * • Cada dia a les 7:30: resum 24h amb gràfic de portfolio
 * • Cada 15 min: snapshot del portfolio (per calcular deltes)
 */

import { getAccount, getOpenOrders } from "./binance-auth";
import { getSnapshots, addSnapshot } from "./snapshot-store";
import { sendPortfolioReport, sendHourlyPortfolioReport, isConfigured } from "./telegram";
import { log }                        from "./logger";
import { STABLES, BINANCE_BASE }      from "./constants";
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

async function fetchPortfolioData(): Promise<PortfolioData> {
  const [account, openOrders] = await Promise.all([getAccount(), getOpenOrders()]);

  const assets = account.balances.filter(b => parseFloat(b.free) + parseFloat(b.locked) > 0.000001);
  const pairs  = assets.filter(b => !STABLES.has(b.asset)).map(b => `${b.asset}USDT`);

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
    const ticker    = tickerMap.get(`${b.asset}USDT`);
    const price     = ticker ? parseFloat(ticker.lastPrice) : (isStable ? 1 : 0);
    const change24h = ticker ? parseFloat(ticker.priceChangePercent) : 0;
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
function snapshotNear(targetMs: number) {
  const snaps = getSnapshots().filter(s => s.time <= targetMs);
  return snaps.length > 0 ? snaps[snaps.length - 1] : null;
}

// ── Informe horari ────────────────────────────────────────────────────────────
// Mostra canvi REAL de saldo (snapshot delta), NO variació de mercat.
// La variació de mercat 24h és correcta al resum diari, no cada hora.

// ── Informe horari ────────────────────────────────────────────────────────────

async function sendHourlyReport(): Promise<void> {
  if (!isConfigured()) return;
  try {
    const portfolio = await fetchPortfolioData();
    const snap1h    = snapshotNear(Date.now() - 60 * 60 * 1000);
    const delta1h   = snap1h ? portfolio.totalValue - snap1h.value : null;

    await sendHourlyPortfolioReport({
      totalValue:  portfolio.totalValue,
      delta1h,
      openOrders:  portfolio.openOrders,
      ocoCount:    portfolio.ocoCount,
      limitCount:  portfolio.limitCount,
      top:         portfolio.top,
      stables:     portfolio.stables,
    });
    global.__schedulerLastHourly = Date.now();
    log.telegram.info("informe horari enviat");
  } catch (err) {
    log.telegram.error({ err: (err as Error).message }, "error informe horari");
  }
}

// ── Informe diari (7:30) amb gràfic ──────────────────────────────────────────

async function sendDailyReport(): Promise<void> {
  if (!isConfigured()) return;
  try {
    const portfolio = await fetchPortfolioData();
    const snap24h   = snapshotNear(Date.now() - 24 * 60 * 60 * 1000);
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
    });

    global.__schedulerLastDaily = Date.now();
    log.telegram.info("informe diari enviat");
  } catch (err) {
    log.telegram.error({ err: (err as Error).message }, "error informe diari");
  }
}

// ── Snapshot del portfolio (cada 15 min) ─────────────────────────────────────

const SNAPSHOT_INTERVAL_MS = 15 * 60 * 1000;

async function takePortfolioSnapshot(): Promise<void> {
  try {
    const account = await getAccount();
    const assets  = account.balances.filter(b => parseFloat(b.free) + parseFloat(b.locked) > 1e-8);
    const pairs   = assets.filter(b => !STABLES.has(b.asset)).map(b => `${b.asset}USDT`);

    const tickerResults = await Promise.allSettled(
      pairs.map(p =>
        fetch(`${BINANCE_BASE}/ticker/24hr?symbol=${p}`, { cache: "no-store" })
          .then(r => r.json() as Promise<{ lastPrice: string }>)
      )
    );

    const priceMap = new Map<string, number>();
    pairs.forEach((p, i) => {
      const r = tickerResults[i];
      if (r.status === "fulfilled") priceMap.set(p.replace(/USDT$/, ""), parseFloat(r.value.lastPrice));
    });

    let total = 0;
    for (const b of assets) {
      const qty   = parseFloat(b.free) + parseFloat(b.locked);
      const price = priceMap.get(b.asset) ?? (STABLES.has(b.asset) ? 1 : 0);
      total += qty * price;
    }

    if (total > 0) {
      addSnapshot({ time: Date.now(), value: total });
      log.telegram.debug({ total }, "snapshot del portfolio desat");
    }
    global.__schedulerLastSnapshot = Date.now();
  } catch (err) {
    log.telegram.warn({ err: (err as Error).message }, "error en prendre snapshot");
  }
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

  // Informe horari: alineat al pròxim toc d'hora
  setTimeout(() => {
    sendHourlyReport();
    setInterval(sendHourlyReport, 60 * 60 * 1000);
  }, msHour);

  // Informe diari: 7:30 cada dia
  setTimeout(() => {
    sendDailyReport();
    setInterval(sendDailyReport, 24 * 60 * 60 * 1000);
  }, msDay);
}
