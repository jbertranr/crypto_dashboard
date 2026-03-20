/**
 * GET /api/debug/audit
 *
 * Informe de diagnòstic complet: compara fonts de dades i detecta discrepàncies.
 * No té TTL de cache — sempre retorna dades fresques.
 */
import { NextResponse } from "next/server";
import { getAccount, getMyTrades, BinanceTrade } from "../../../lib/binance-auth";
import { getSnapshots } from "../../../lib/snapshot-store";
import { journalStats, journalGetAll } from "../../../lib/journal-store";
import { apiError } from "../../../lib/api-error";
import { STABLES, BINANCE_BASE } from "../../../lib/constants";
import { calcSymbolPnl, type PnlPoint } from "../../../lib/pnl-calc";

interface Ticker { lastPrice: string; }

/* ── Cost basis FIFO (amb comissions base-asset) ─────────────────── */

interface CbEntry {
  asset: string;
  avgCost: number;
  totalQty: number;
  currentPrice: number | null;
  unrealizedPnl: number | null;
}

function calcCostBasis(asset: string, trades: BinanceTrade[], price: number | null): CbEntry {
  let totalQty = 0;
  let avgCost  = 0;

  for (const t of trades) {
    const qty   = parseFloat(t.qty);
    const p     = parseFloat(t.price);
    if (t.isBuyer) {
      const commBase = t.commissionAsset === asset ? parseFloat(t.commission) : 0;
      const netQty   = qty - commBase;
      if (netQty > 0) {
        avgCost  = (avgCost * totalQty + p * netQty) / (totalQty + netQty);
        totalQty += netQty;
      }
    } else {
      totalQty = Math.max(0, totalQty - qty);
    }
  }

  const unrealizedPnl = (totalQty > 0 && avgCost > 0 && price != null)
    ? (price - avgCost) * totalQty
    : null;

  return { asset, avgCost, totalQty, currentPrice: price, unrealizedPnl };
}

/* ── GET handler ─────────────────────────────────────────────────── */

export async function GET() {
  try {
    // 1. Account balances
    const account = await getAccount();
    const nonZero = account.balances.filter(b =>
      parseFloat(b.free) + parseFloat(b.locked) > 1e-8
    );
    const cryptoAssets = nonZero.filter(b => !STABLES.has(b.asset)).map(b => b.asset);

    // 2. Tickers per crypto assets
    const tickerResults = await Promise.allSettled(
      cryptoAssets.map(a =>
        fetch(`${BINANCE_BASE}/ticker/price?symbol=${a}USDT`, { cache: "no-store", signal: AbortSignal.timeout(10_000) })
          .then(r => r.json() as Promise<Ticker>)
      )
    );
    const priceMap = new Map<string, number>();
    cryptoAssets.forEach((a, i) => {
      const r = tickerResults[i];
      if (r.status === "fulfilled") priceMap.set(a, parseFloat(r.value.lastPrice));
    });

    // 3. Balances amb valor USD
    const balances = nonZero.map(b => {
      const qty    = parseFloat(b.free) + parseFloat(b.locked);
      const price  = priceMap.get(b.asset) ?? (STABLES.has(b.asset) ? 1 : null);
      return {
        asset:    b.asset,
        free:     parseFloat(b.free),
        locked:   parseFloat(b.locked),
        total:    qty,
        valueUSD: price != null ? qty * price : null,
      };
    }).sort((a, b) => (b.valueUSD ?? 0) - (a.valueUSD ?? 0));

    // 4. Trades per tots els assets del compte + simbols del journal
    const journalSymbols = new Set<string>(
      journalGetAll({ limit: 2000 }).map(e => e.symbol)
    );
    const allPairs = new Set<string>([
      ...cryptoAssets.map(a => `${a}USDT`),
      ...journalSymbols,
    ]);

    const tradeResults = await Promise.allSettled(
      [...allPairs].map(p => getMyTrades(p, 500).then(t => ({ pair: p, trades: t })))
    );

    const tradesByAsset = new Map<string, BinanceTrade[]>();
    const pnlByPair: Array<{
      pair: string;
      tradeCount: number;
      realizedPnl: number;
      firstTrade: number | null;
      lastTrade:  number | null;
    }> = [];

    for (const r of tradeResults) {
      if (r.status !== "fulfilled") continue;
      const { pair, trades } = r.value;
      if (trades.length === 0) continue;
      const asset = pair.replace(/USDT$/, "");
      tradesByAsset.set(asset, trades);

      const points = calcSymbolPnl(trades);
      const realizedPnl = points.reduce((s, p) => s + p.pnl, 0);
      const times = trades.map(t => t.time);
      pnlByPair.push({
        pair,
        tradeCount:  trades.length,
        realizedPnl,
        // C6: guard against empty arrays (Math.min/max of [] returns ±Infinity)
        firstTrade:  times.length > 0 ? Math.min(...times) : null,
        lastTrade:   times.length > 0 ? Math.max(...times) : null,
      });
    }
    pnlByPair.sort((a, b) => b.realizedPnl - a.realizedPnl);

    // 5. Cost basis
    const costBasis: CbEntry[] = [];
    for (const asset of cryptoAssets) {
      const trades = tradesByAsset.get(asset);
      if (!trades || trades.length === 0) continue;
      const entry = calcCostBasis(asset, trades, priceMap.get(asset) ?? null);
      if (entry.totalQty > 1e-8 && entry.avgCost > 0) costBasis.push(entry);
    }
    costBasis.sort((a, b) => (b.unrealizedPnl ?? 0) - (a.unrealizedPnl ?? 0));

    // 6. PnL summary per períodes
    const allPoints: PnlPoint[] = pnlByPair.flatMap(() => []);
    for (const r of tradeResults) {
      if (r.status === "fulfilled" && r.value.trades.length > 0) {
        allPoints.push(...calcSymbolPnl(r.value.trades));
      }
    }
    const now    = Date.now();
    const since  = (d: number) => now - d * 86_400_000;
    const sumPnl = (minT: number) =>
      allPoints.filter(p => p.time >= minT).reduce((s, p) => s + p.pnl, 0);

    const pnlSummary = {
      d1:   sumPnl(since(1)),
      d7:   sumPnl(since(7)),
      d30:  sumPnl(since(30)),
      d365: sumPnl(since(365)),
    };

    // 7. Journal stats
    const jStats = journalStats();

    // 8. Snapshots
    const snaps = getSnapshots();
    const snapInfo = {
      count:     snaps.length,
      firstTime: snaps.length > 0 ? snaps[0].time : null,
      lastTime:  snaps.length > 0 ? snaps[snaps.length - 1].time : null,
      rangeHours: snaps.length > 1
        ? Math.round((snaps[snaps.length - 1].time - snaps[0].time) / 3_600_000)
        : 0,
    };

    // 9. Discrepàncies detectades
    const discrepancies: string[] = [];

    // Journal vs PnL de Binance
    const pnlDiff = Math.abs(jStats.totalPnlUsdt - pnlSummary.d365);
    if (jStats.totalEntries > 0 && pnlDiff > 50) {
      discrepancies.push(
        `PnL journal (${jStats.totalPnlUsdt.toFixed(2)} USDT) vs PnL Binance 365d (${pnlSummary.d365.toFixed(2)} USDT) — diferència de ${pnlDiff.toFixed(2)} USDT`
      );
    }

    // Assets sense cost basis però amb saldo significant
    for (const b of balances) {
      if (!STABLES.has(b.asset) && (b.valueUSD ?? 0) > 10) {
        const cb = costBasis.find(c => c.asset === b.asset);
        if (!cb) {
          discrepancies.push(`${b.asset}: saldo de ${b.total.toFixed(4)} (≈$${(b.valueUSD ?? 0).toFixed(0)}) però sense historial de trades`);
        }
      }
    }

    // Snapshots escassos
    if (snapInfo.count < 2) {
      discrepancies.push("Menys de 2 snapshots disponibles — el gràfic d'evolució no es pot mostrar");
    } else if (snapInfo.rangeHours < 1) {
      discrepancies.push("Tots els snapshots estan dins d'1 hora — cobertura temporal molt baixa");
    }

    // Cost basis vs saldo actual
    for (const cb of costBasis) {
      const bal = balances.find(b => b.asset === cb.asset);
      if (!bal) continue;
      const diff = Math.abs(cb.totalQty - bal.total) / Math.max(bal.total, 1e-10);
      if (diff > 0.05) {
        discrepancies.push(
          `${cb.asset}: cost basis qty=${cb.totalQty.toFixed(6)} però saldo actual=${bal.total.toFixed(6)} (diferència ${(diff * 100).toFixed(1)}%)`
        );
      }
    }

    return NextResponse.json({
      balances,
      costBasis,
      pnlByPair,
      journalStats: jStats,
      pnlSummary,
      snapshots:    snapInfo,
      discrepancies,
      generatedAt:  new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });

  } catch (e) {
    return apiError(e, "debug/audit");
  }
}
