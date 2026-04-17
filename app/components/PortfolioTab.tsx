"use client";
import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { PieChart, Pie, Cell, Tooltip as ChartTooltip } from "recharts";
import { BinanceBalance, BinanceOrder, type TradingMode } from "../lib/binance-auth";
import { CoinRow } from "../lib/types";
import { formatCurrency } from "../lib/format";
import CoinIcon, { coinColor } from "./CoinIcon";
import PortfolioChart, { Period } from "./PortfolioChart";
import { STABLES } from "../lib/constants";
import { useTradingMode } from "../contexts/TradingModeContext";

const SNAPSHOT_INTERVAL = 15 * 60 * 1000; // 15 min

interface AssetRow {
  asset: string;
  free: number;
  locked: number;
  total: number;
  price: number | null;
  change4h:  number | null;
  change24h: number | null;
  change7d:  number | null;
  change4w:  number | null;
  change6m:  number | null;
  change1y:  number | null;
  valueUSD: number;
  pnl4h:  number;
  pnl24h: number;
  pnl7d:  number;
  pnl4w:  number;
  pnl6m:  number;
  pnl1y:  number;
  lockedOrders: number;
  ocoCount: number;
  slCount: number;
  avgCost: number | null;
  firstBuyTime: number;   // 0 = unknown
  unrealizedPnl: number | null;
}

interface CostBasisEntry {
  avgCost: number;
  totalQty: number;
  firstBuyTime: number;
}


const PERIOD_OPTIONS: { key: Period; label: string }[] = [
  { key: "24h", label: "24h" },
  { key: "7d",  label: "7d"  },
  { key: "30d", label: "30d" },
  { key: "all", label: "Tot" },
];

function buildRows(
  balances: BinanceBalance[],
  coins: CoinRow[],
  openOrders: BinanceOrder[],
  costBasis: Record<string, CostBasisEntry> = {}
): AssetRow[] {
  return balances.map(b => {
    const free   = parseFloat(b.free);
    const locked = parseFloat(b.locked);
    const total  = free + locked;
    const coin   = coins.find(c => c.symbol === b.asset);
    const isStable = STABLES.has(b.asset);

    const price     = coin ? coin.price    : isStable ? 1 : null;
    const change4h  = coin ? coin.change4h  : null;
    const change24h = coin ? coin.change24h : null;
    const change7d  = coin ? coin.change7d  : null;
    const change4w  = coin ? coin.change4w  : null;
    const change6m  = coin ? coin.change6m  : null;
    const change1y  = coin ? coin.change1y  : null;
    const valueUSD  = price != null ? total * price : 0;
    // Correct formula: valueUSD × c/(100+c) = qty × (currentPrice − priceAtWindowStart)
    // Using valueUSD × c/100 overstates gains because it applies % to the already-higher current value
    const pnlW = (c: number | null) =>
      (coin && price && c != null) ? valueUSD * c / (100 + c) : 0;
    const pnl4h  = pnlW(change4h);
    const pnl24h = pnlW(change24h);
    const pnl7d  = pnlW(change7d);
    const pnl4w  = pnlW(change4w);
    const pnl6m  = pnlW(change6m);

    const assetOrders = openOrders.filter(o => o.symbol.startsWith(b.asset));
    const lockedOrders = assetOrders.filter(o => parseFloat(o.price) > 0).length;
    const ocoCount     = new Set(assetOrders.filter(o => o.orderListId !== -1).map(o => o.orderListId)).size;
    const slCount      = assetOrders.filter(o => o.orderListId === -1 &&
      (o.type === "STOP_LOSS_LIMIT" || o.type === "STOP_LOSS")).length;

    const cb = !isStable ? costBasis[b.asset] : undefined;
    const avgCost      = cb ? cb.avgCost : null;
    const firstBuyTime = cb ? cb.firstBuyTime : 0;
    const unrealizedPnl = (avgCost != null && price != null)
      ? (price - avgCost) * total
      : null;

    const pnl1y = pnlW(change1y);
    return { asset: b.asset, free, locked, total, price, change4h, change24h, change7d, change4w, change6m, change1y, valueUSD, pnl4h, pnl24h, pnl7d, pnl4w, pnl6m, pnl1y, lockedOrders, ocoCount, slCount, avgCost, firstBuyTime, unrealizedPnl };
  }).sort((a, b) => b.valueUSD - a.valueUSD);
}

type PnlData = { d1: number; d7: number; d30: number; d365: number };

interface UnrealizedRow { asset: string; pnl: number; valueUSD: number; }

function PnlSummaryPanel({ unrealizedRows, mode, refreshTick }: {
  unrealizedRows: UnrealizedRow[];
  mode: "paper" | "real";
  refreshTick: number;
}) {
  const [snapshots, setSnapshots] = useState<{ time: number; value: number }[]>([]);
  const [loadingSnap, setLoadingSnap] = useState(true);

  useEffect(() => {
    fetch(`/api/portfolio-snapshot?mode=${mode}`)
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setSnapshots(d); })
      .catch(() => {})
      .finally(() => setLoadingSnap(false));
  }, [mode, refreshTick]);

  const totalUnrealized = unrealizedRows.reduce((s, r) => s + r.pnl, 0);

  const fmtPnl = (v: number) => `${v >= 0 ? "+" : ""}${formatCurrency(v, 2)}`;

  // Compute portfolio diff over a window: find value at windowStart, compare to last
  function snapDiff(ms: number): { diff: number; pct: number } | null {
    if (snapshots.length < 2) return null;
    const last     = snapshots[snapshots.length - 1].value;
    const cutoff   = Date.now() - ms;
    // find the snapshot closest to (but not after) cutoff
    const inWindow = snapshots.filter(s => s.time <= cutoff);
    const ref      = inWindow.length > 0 ? inWindow[inWindow.length - 1].value
                   : snapshots[0].value; // fallback to oldest
    const diff = last - ref;
    const pct  = ref > 0 ? (diff / ref) * 100 : 0;
    return { diff, pct };
  }

  const evo = [
    { label: "24h", ms: 24 * 3_600_000 },
    { label: "7d",  ms: 7  * 86_400_000 },
    { label: "1m",  ms: 30 * 86_400_000 },
    { label: "1a",  ms: 365 * 86_400_000 },
  ].map(({ label, ms }) => ({ label, result: snapDiff(ms) }));

  const pnlRow = (key: string, left: React.ReactNode, val: number, pct?: number) => (
    <div key={key} className="pf-pnl-row">
      <span className={`pf-pnl-row__accent pf-pnl-row__accent--${val >= 0 ? "up" : "dn"}`} />
      <span className="pf-pnl-row__label">{left}</span>
      <span className={`pf-pnl-row__val pf-pnl-row__val--${val >= 0 ? "up" : "dn"}`}>
        {fmtPnl(val)}
        {pct !== undefined && (
          <span className="pf-pnl-row__pct"> ({pct >= 0 ? "+" : ""}{pct.toFixed(2)}%)</span>
        )}
      </span>
    </div>
  );

  return (
    <div className="pf-pnl-summary">
      {/* Portfolio evolution from snapshots */}
      <div className="section-title">
        <i className="fa-solid fa-chart-line" /> Valor del portfolio
      </div>
      {loadingSnap && <div className="pf-pnl-row pf-pnl-row--empty"><i className="fa-solid fa-spinner fa-spin" /></div>}
      {!loadingSnap && snapshots.length < 2 && (
        <div className="pf-pnl-row pf-pnl-row--empty">Sense dades de snapshots</div>
      )}
      {!loadingSnap && snapshots.length >= 2 && evo.map(({ label, result }) =>
        result ? pnlRow(label, label, result.diff, result.pct)
               : <div key={label} className="pf-pnl-row pf-pnl-row--empty" style={{ opacity: 0.4 }}>{label}: —</div>
      )}

      {/* Si tanques ara */}
      <div className="section-title">
        <i className="fa-solid fa-door-open" /> Si tanques ara
        <span className={`section-title__right pf-pnl-row__val--${totalUnrealized >= 0 ? "up" : "dn"}`}>
          {fmtPnl(totalUnrealized)}
        </span>
      </div>
      {unrealizedRows.filter(r => r.pnl !== 0).sort((a, b) => b.pnl - a.pnl).map(r =>
        pnlRow(
          r.asset,
          <span className="pf-pnl-row__coin"><CoinIcon symbol={r.asset} size={14} />{r.asset}</span>,
          r.pnl
        )
      )}
      {unrealizedRows.every(r => r.pnl === 0) && (
        <div className="pf-pnl-row pf-pnl-row--empty">Sense cost basis</div>
      )}
    </div>
  );
}

export default function PortfolioTab({
  coins, openOrders, refreshTrigger, mode: modeProp,
}: {
  coins: CoinRow[];
  openOrders: BinanceOrder[];
  refreshTrigger: number;
  mode?: TradingMode;
}) {
  const [balances,  setBalances]  = useState<BinanceBalance[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [costBasis, setCostBasis] = useState<Record<string, CostBasisEntry>>({});
  const { viewMode: ctxMode, quoteAsset } = useTradingMode();
  const viewMode = modeProp ?? ctxMode;
  const [selling,   setSelling]   = useState<Record<string, boolean>>({});
  const [sellConfirm, setSellConfirm] = useState<string | null>(null); // asset awaiting confirm
  const [cancelSellConfirm, setCancelSellConfirm] = useState<string | null>(null); // asset awaiting OCO cancel+sell confirm
  const [sellResult,  setSellResult]  = useState<{ asset: string; usdt: string } | null>(null);
  const [period,        setPeriod]        = useState<Period>("7d");
  const [sortBy,        setSortBy]        = useState<"value" | "pnl" | "change" | "name">("value");
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [snapshotTick,  setSnapshotTick]  = useState(0);
  const [chartStats,    setChartStats]    = useState({ diff: 0, pct: 0 });
  const lastSnapshotRef = useRef<number>(0);
  const loadTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChartStats = useCallback((diff: number, pct: number) => {
    setChartStats({ diff, pct });
  }, []);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    fetch(`/api/balance?mode=${viewMode}`, { cache: "no-store" }).then(r => r.json())
      .then(bal => { if (bal.error) throw new Error(bal.error); setBalances(bal); setLastRefreshed(new Date()); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [viewMode]);

  useEffect(() => { load(); }, [load, refreshTrigger]);

  useEffect(() => {
    fetch(`/api/cost-basis?mode=${viewMode}`)
      .then(r => r.json())
      .then(d => { if (!d.error) setCostBasis(d); })
      .catch(err => console.warn("[PortfolioTab] cost-basis:", (err as Error).message));
  }, [viewMode, refreshTrigger]);

  // Auto-reload every 15 min to take a fresh snapshot
  useEffect(() => {
    const id = setInterval(load, SNAPSHOT_INTERVAL);
    return () => clearInterval(id);
  }, [load]);

  // D2: cleanup the deferred reload timer on unmount
  useEffect(() => () => { if (loadTimerRef.current) clearTimeout(loadTimerRef.current); }, []);

  // Post snapshot when balances are fresh, throttled to SNAPSHOT_INTERVAL
  useEffect(() => {
    if (!balances.length) return;
    const now = Date.now();
    if (now - lastSnapshotRef.current < SNAPSHOT_INTERVAL) return;
    const total = balances.reduce((sum, b) => {
      const qty  = parseFloat(b.free) + parseFloat(b.locked);
      const coin = coins.find(c => c.symbol === b.asset);
      const price = coin ? coin.price : (["USDT","USDC","BUSD","TUSD","DAI"].includes(b.asset) ? 1 : 0);
      return sum + qty * price;
    }, 0);
    if (total <= 0) return;
    lastSnapshotRef.current = now;
    fetch("/api/portfolio-snapshot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ time: now, value: total, mode: viewMode }),
    }).then(() => setSnapshotTick(t => t + 1));
  }, [balances, coins]);

  const cancelOcoAndSell = async (asset: string) => {
    const symbol = `${asset}${quoteAsset}`;
    const ocoListIds = [...new Set(
      openOrders
        .filter(o => o.symbol === symbol && o.orderListId !== -1)
        .map(o => o.orderListId)
    )];
    setSelling(p => ({ ...p, [asset]: true }));
    setCancelSellConfirm(null);
    try {
      for (const orderListId of ocoListIds) {
        const r = await fetch("/api/orders/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol, orderListId }),
        });
        const d = await r.json();
        if (d.error) throw new Error(d.error);
      }
      // Wait for Binance to release the locked qty
      await new Promise(res => setTimeout(res, 1500));
      const balRes = await fetch(`/api/balance?mode=${viewMode}`, { cache: "no-store" });
      const bals = await balRes.json();
      const bal = bals.find((b: { asset: string; free: string }) => b.asset === asset);
      const freeQty = bal ? parseFloat(bal.free) : 0;
      if (freeQty <= 0) throw new Error(`Saldo lliure 0 per a ${asset} després de cancel·lar l'OCO`);
      setSelling(p => { const n = { ...p }; delete n[asset]; return n; });
      await sellToUsdt(asset, freeQty);
    } catch (e) {
      alert(`Error: ${(e as Error).message}`);
      setSelling(p => { const n = { ...p }; delete n[asset]; return n; });
    }
  };

  const sellToUsdt = async (asset: string, quantity: number) => {
    setSelling(p => ({ ...p, [asset]: true }));
    setSellConfirm(null);
    setSellResult(null);
    try {
      const res = await fetch("/api/orders/sell-to-usdt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asset, quantity: quantity.toString(), mode: viewMode }),
      });
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      setSellResult({ asset, usdt: parseFloat(d.receivedUSDT).toFixed(2) });
      // Small delay so Binance has time to update the account before we re-fetch
      loadTimerRef.current = setTimeout(load, 1500);
    } catch (e) {
      alert(`Error venent ${asset}: ${(e as Error).message}`);
    } finally {
      setSelling(p => { const n = { ...p }; delete n[asset]; return n; });
    }
  };

  const DUST_THRESHOLD = 10; // < $10 → dust

  const { baseRows, mainBase, dustRows, rows, totalValue, totalPnl, pnlPct, pnlUp, chartData, top3, pnlRanking, ocoCount, limitCount, unrealizedRows, totalUnrealizedPnl, totals } = useMemo(() => {
    const baseRows = buildRows(balances, coins, openOrders, costBasis);
    const mainBase = baseRows.filter(r => r.valueUSD >= DUST_THRESHOLD);
    const dustRows = baseRows.filter(r => r.valueUSD >  0 && r.valueUSD < DUST_THRESHOLD);

    const rows = [...mainBase].sort((a, b) => {
      if (sortBy === "value")  return b.valueUSD - a.valueUSD;
      if (sortBy === "pnl")    return b.pnl24h - a.pnl24h;
      if (sortBy === "change") return (b.change24h ?? 0) - (a.change24h ?? 0);
      if (sortBy === "name")   return a.asset.localeCompare(b.asset);
      return 0;
    });

    const totalValue = baseRows.reduce((s, r) => s + r.valueUSD, 0);
    const totalPnl   = baseRows.reduce((s, r) => s + r.pnl24h, 0);
    const pnlPct     = totalValue > 0 ? (totalPnl / totalValue) * 100 : 0;
    const pnlUp      = totalPnl >= 0;

    const totals = {
      pnl4h:  baseRows.filter(r => !STABLES.has(r.asset)).reduce((s, r) => s + r.pnl4h,  0),
      pnl24h: baseRows.filter(r => !STABLES.has(r.asset)).reduce((s, r) => s + r.pnl24h, 0),
      pnl7d:  baseRows.filter(r => !STABLES.has(r.asset)).reduce((s, r) => s + r.pnl7d,  0),
      pnl4w:  baseRows.filter(r => !STABLES.has(r.asset)).reduce((s, r) => s + r.pnl4w,  0),
      pnl6m:  baseRows.filter(r => !STABLES.has(r.asset)).reduce((s, r) => s + r.pnl6m,  0),
      pnl1y:  baseRows.filter(r => !STABLES.has(r.asset)).reduce((s, r) => s + r.pnl1y,  0),
    };

    const chartData = mainBase.map(r => ({
      name:  r.asset,
      value: r.valueUSD,
      pct:   totalValue > 0 ? (r.valueUSD / totalValue) * 100 : 0,
      color: coinColor(r.asset),
    }));

    const top3 = rows.filter(r => r.valueUSD > 0 && !STABLES.has(r.asset)).slice(0, 3);

    const pnlRanking = [...rows]
      .filter(r => !STABLES.has(r.asset) && r.pnl24h !== 0)
      .sort((a, b) => b.pnl24h - a.pnl24h);

    const ocoCount   = new Set(openOrders.filter(o => o.orderListId !== -1).map(o => o.orderListId)).size;
    const limitCount = openOrders.filter(o => o.orderListId === -1).length;

    const unrealizedRows: UnrealizedRow[] = baseRows
      .filter(r => r.unrealizedPnl !== null && !STABLES.has(r.asset) && r.valueUSD >= DUST_THRESHOLD)
      .map(r => ({ asset: r.asset, pnl: r.unrealizedPnl!, valueUSD: r.valueUSD }));
    const totalUnrealizedPnl = unrealizedRows.reduce((s, r) => s + r.pnl, 0);

    return { baseRows, mainBase, dustRows, rows, totalValue, totalPnl, pnlPct, pnlUp, chartData, top3, pnlRanking, ocoCount, limitCount, unrealizedRows, totalUnrealizedPnl, totals };
  }, [balances, coins, openOrders, costBasis, sortBy]);

  if (loading) return <div className="state-empty">Loading portfolio…</div>;
  if (error)   return <div className="state-error">{error}</div>;

  return (
    <div className="portfolio">

      {/* Summary cards */}
      <div className="section-title">
        <i className="fa-solid fa-gauge-high" /> Resum del portfolio
      </div>
      <div className="portfolio__cards">
        <div className="portfolio__card portfolio__card--blue">
          <span className="portfolio__card-label">
            <i className="fa-solid fa-wallet" /> Portfolio Total
          </span>
          <span className="portfolio__card-value">{formatCurrency(totalValue)}</span>
          <span className="portfolio__card-sub">
            {rows.length} assets{dustRows.length > 0 ? ` + ${dustRows.length} dust` : ""}
          </span>
        </div>

        {(() => {
          const up    = chartStats.diff >= 0;
          const label = PERIOD_OPTIONS.find(o => o.key === period)?.label ?? period;
          return (
            <div className={`portfolio__card portfolio__card--${up ? "green" : "red"}`}>
              <span className="portfolio__card-label">
                <i className={`fa-solid fa-arrow-trend-${up ? "up" : "down"}`} /> Variació {label}
              </span>
              <span className="portfolio__card-value">
                {up ? "+" : ""}{formatCurrency(chartStats.diff)}
              </span>
              <span className={`portfolio__card-sub portfolio__card-sub--${up ? "up" : "down"}`}>
                {up ? "+" : ""}{chartStats.pct.toFixed(2)}%
              </span>
            </div>
          );
        })()}

        {/* Millor actiu 24h */}
        {(() => {
          const best = pnlRanking[0] ?? null;
          const up   = best ? best.pnl24h >= 0 : true;
          return (
            <div className={`portfolio__card portfolio__card--${best ? (up ? "green" : "red") : "neutral"}`}>
              <span className="portfolio__card-label">
                <i className="fa-solid fa-trophy" /> Millor 24h
              </span>
              <span className="portfolio__card-value">
                {best ? best.asset : "—"}
              </span>
              <span className={`portfolio__card-sub${best ? ` portfolio__card-sub--${up ? "up" : "down"}` : ""}`}>
                {best ? `${up ? "+" : ""}${formatCurrency(best.pnl24h)} (${(best.change24h ?? 0) >= 0 ? "+" : ""}${(best.change24h ?? 0).toFixed(2)}%)` : "—"}
              </span>
            </div>
          );
        })()}

        {/* Pitjor actiu 24h */}
        {(() => {
          const worst = pnlRanking.length > 1 ? pnlRanking[pnlRanking.length - 1] : null;
          const up    = worst ? worst.pnl24h >= 0 : false;
          return (
            <div className={`portfolio__card portfolio__card--${worst ? (up ? "green" : "red") : "neutral"}`}>
              <span className="portfolio__card-label">
                <i className="fa-solid fa-arrow-down-wide-short" /> Pitjor 24h
              </span>
              <span className="portfolio__card-value">
                {worst ? worst.asset : "—"}
              </span>
              <span className={`portfolio__card-sub${worst ? ` portfolio__card-sub--${up ? "up" : "down"}` : ""}`}>
                {worst ? `${up ? "+" : ""}${formatCurrency(worst.pnl24h)} (${(worst.change24h ?? 0) >= 0 ? "+" : ""}${(worst.change24h ?? 0).toFixed(2)}%)` : "—"}
              </span>
            </div>
          );
        })()}

        <div className="portfolio__card portfolio__card--neutral">
          <span className="portfolio__card-label">
            <i className="fa-solid fa-list-check" /> Ordres obertes
          </span>
          <span className="portfolio__card-value">{openOrders.length}</span>
          <span className="portfolio__card-sub">
            {ocoCount} OCO / {limitCount} LIMIT actives
          </span>
        </div>

        {(() => {
          const hasData = unrealizedRows.length > 0;
          const up = totalUnrealizedPnl >= 0;
          return (
            <div className={`portfolio__card portfolio__card--${hasData ? (up ? "green" : "red") : "neutral"}`}>
              <span className="portfolio__card-label">
                <i className="fa-solid fa-door-open" /> Si tanques ara
              </span>
              <span className="portfolio__card-value">
                {hasData ? `${up ? "+" : ""}${formatCurrency(totalUnrealizedPnl)}` : "—"}
              </span>
              <span className={`portfolio__card-sub${hasData ? ` portfolio__card-sub--${up ? "up" : "down"}` : ""}`}>
                {hasData ? `vs cost basis · ${unrealizedRows.length} actius` : "sense cost basis"}
              </span>
            </div>
          );
        })()}
      </div>

      {/* Middle section: donut chart + top assets + 24H P&L rank */}
      {totalValue > 0 && (
        <>
        <div className="portfolio__mid">

          {/* Donut chart */}
          <div className="portfolio__donut-section">
            <div className="section-title"><i className="fa-solid fa-chart-pie" /> Portfolio distribució</div>
            <div className="portfolio__donut-row">
              <div className="portfolio__donut-chart-wrap">
                <PieChart width={160} height={160}>
                  <Pie
                    data={chartData}
                    cx={80} cy={80}
                    innerRadius={52} outerRadius={72}
                    paddingAngle={2} dataKey="value"
                  >
                    {chartData.map(e => <Cell key={e.name} fill={e.color} />)}
                  </Pie>
                  <ChartTooltip
                    formatter={(v) => [formatCurrency(v as number), ""]}
                    contentStyle={{
                      background: "#fff", border: "1px solid #e2e8f0",
                      borderRadius: 8, fontSize: 11,
                    }}
                  />
                </PieChart>
                <div className="portfolio__donut-center">
                  <div className="portfolio__donut-center-val">{formatCurrency(totalValue)}</div>
                  <div className="portfolio__donut-center-label">total</div>
                </div>
              </div>

              <div className="portfolio__legend">
                {chartData.slice(0, 8).map(d => (
                  <div key={d.name} className="portfolio__legend-item">
                    <span className="portfolio__legend-dot" style={{ background: d.color }} />
                    <span className="portfolio__legend-name">{d.name}</span>
                    <span className="portfolio__legend-pct">{d.pct.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Portfolio evolution chart */}
          <div className="portfolio__evolution">
            <PortfolioChart refreshTick={snapshotTick} period={period} setPeriod={setPeriod} onStats={handleChartStats} mode={viewMode} />
          </div>

          {/* P&L: realitzat + si tanques ara */}
          <PnlSummaryPanel unrealizedRows={unrealizedRows} mode={viewMode} refreshTick={snapshotTick} />

        </div>
        </>
      )}

      {/* Sell result toast */}
      {sellResult && (
        <div className="pf-sell-toast">
          <i className="fa-solid fa-circle-check" />
          {sellResult.asset} venut correctament · rebut {sellResult.usdt} USDT
          <button onClick={() => setSellResult(null)}><i className="fa-solid fa-xmark" /></button>
        </div>
      )}

      {/* Asset list */}
      {(() => {
        const nonStableRows = rows.filter(r => !STABLES.has(r.asset));
        const stableRows    = rows.filter(r =>  STABLES.has(r.asset));

        const colorMap: Record<string, string> = {};
        chartData.forEach(d => { colorMap[d.name] = d.color; });

        const renderTotalCell = (pnl: number) => (
          <span className={`pf-pct-cell pf-pct-cell--${pnl >= 0 ? "up" : "dn"}`} style={{ fontSize: "0.7rem" }}>
            {pnl !== 0 ? `${pnl >= 0 ? "+" : ""}${formatCurrency(pnl, 0)}` : <span style={{ opacity: 0.3 }}>—</span>}
          </span>
        );

        const renderPctCell = (chg: number | null, valid = true) => {
          if (!valid || chg == null) return <span className="pf-pct-cell pf-pct-cell--empty">—</span>;
          const up = chg >= 0;
          return (
            <span className={`pf-pct-cell pf-pct-cell--${up ? "up" : "dn"}`}>
              {up ? "+" : ""}{chg.toFixed(2)}%
            </span>
          );
        };

        const renderRow = (row: typeof rows[0]) => {
          const isStable = STABLES.has(row.asset);
          const pct      = totalValue > 0 ? (row.valueUSD / totalValue) * 100 : 0;
          const color    = colorMap[row.asset] ?? "#94a3b8";
          const pnlPct   = row.avgCost && row.price && !isStable
            ? ((row.price - row.avgCost) / row.avgCost) * 100
            : null;

          const isSelling       = !!selling[row.asset];
          const isConfirm       = sellConfirm === row.asset;
          const isCancelConfirm = cancelSellConfirm === row.asset;
          const canSell         = !isStable && row.free > 0;
          const hasOcoBlocking  = !isStable && row.free === 0 && row.locked > 0;

          const accentColor = isStable ? "var(--text-3)"
            : pnlPct == null ? "var(--text-3)"
            : pnlPct > 0    ? "var(--green)"
            :                  "var(--red)";

          const now = Date.now();
          const heldMs = row.firstBuyTime > 0 ? now - row.firstBuyTime : 0;
          const validWindow = (change: number | null, minMs: number) => {
            if (!row.price || change == null) return false;
            if (heldMs < minMs) return false;
            if (row.avgCost != null) {
              const histPrice = row.price / (1 + change / 100);
              if (row.avgCost > histPrice) return false;
            }
            return true;
          };

          return (
            <div key={row.asset}
              className={`pf-row${isStable ? " pf-row--stable" : ""}`}
              style={{ "--pf-color": color, "--pf-accent": accentColor } as React.CSSProperties}
            >
              <div className="pf-row__accent" />

              <div className="pf-row__identity">
                <CoinIcon symbol={row.asset} size={16} />
                <span className="pf-row__name">{row.asset}</span>
                {pct >= 0.5 && (
                  <span className="pf-row__pct" style={{ color, background: `${color}1a` }}>
                    {pct.toFixed(1)}%
                  </span>
                )}
                {row.ocoCount > 0 && (
                  <span className="pf-order-badge pf-order-badge--oco"
                    title={`${row.ocoCount} OCO obert${row.ocoCount > 1 ? "s" : ""}`}>
                    <span className="pf-order-badge__count">{row.ocoCount}×</span>OCO
                  </span>
                )}
                {row.slCount > 0 && (
                  <span className="pf-order-badge pf-order-badge--sl"
                    title={`${row.slCount} Stop-Loss standalone`}>
                    <span className="pf-order-badge__count">{row.slCount}×</span>SL
                  </span>
                )}
              </div>

              <div className="pf-row__value">
                <span className="pf-row__usd mono">{row.valueUSD > 0 ? formatCurrency(row.valueUSD) : "—"}</span>
                <span className="pf-row__qty">
                  {row.total.toFixed(row.total < 1 ? 5 : 4)} {row.asset}
                  {row.locked > 0 && (
                    <span className="pf-row__locked" title={`${row.locked.toFixed(4)} bloquejat en ordres`}>
                      {" "}<i className="fa-solid fa-lock" style={{ fontSize: "0.55rem", opacity: 0.6 }} />
                    </span>
                  )}
                </span>
              </div>

                  {!isStable ? renderPctCell(row.change4h)  : <span />}
              {!isStable ? renderPctCell(row.change24h) : <span />}
              {!isStable ? renderPctCell(row.change7d)  : <span />}
              {!isStable ? renderPctCell(row.change4w)  : <span />}
              {!isStable ? renderPctCell(row.change6m)  : <span />}
              {!isStable ? renderPctCell(row.change1y)  : <span />}

              <div className="pf-row__pnl-block">
                {pnlPct != null ? (
                  <div className={`pf-pct-cell pf-pct-cell--${pnlPct >= 0 ? "up" : "dn"} pf-pct-cell--sempre`}
                    title={`vs cost basis ${row.avgCost ? formatCurrency(row.avgCost) : ""}`}>
                    <span>{pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%</span>
                    {row.unrealizedPnl != null && (
                      <span className="pf-pct-cell__sub">
                        {row.unrealizedPnl >= 0 ? "+" : ""}{formatCurrency(row.unrealizedPnl, 0)}
                      </span>
                    )}
                  </div>
                ) : <span className="pf-pct-cell pf-pct-cell--empty">—</span>}
              </div>

              <span className="pf-row__price mono">
                {row.price != null && !isStable ? formatCurrency(row.price) : ""}
              </span>

              <div className="pf-row__orders">
                {(canSell || hasOcoBlocking) && (
                  isSelling ? (
                    <button className="pf-row__sell-btn pf-row__sell-btn--loading" disabled>
                      <i className="fa-solid fa-spinner fa-spin" /> Venent…
                    </button>
                  ) : canSell && isConfirm ? (
                    <div className="pf-row__sell-confirm">
                      <span className="pf-row__sell-confirm-label">
                        Vendre {row.free.toFixed(4)} {row.asset}?
                      </span>
                      <button className="pf-row__sell-yes" onClick={() => sellToUsdt(row.asset, row.free)}>
                        <i className="fa-solid fa-check" /> Sí
                      </button>
                      <button className="pf-row__sell-no" onClick={() => setSellConfirm(null)}>
                        <i className="fa-solid fa-xmark" />
                      </button>
                    </div>
                  ) : canSell ? (
                    <button className="pf-row__sell-btn"
                      onClick={() => setSellConfirm(row.asset)}
                      title={`Vendre ${row.free.toFixed(4)} ${row.asset} a mercat → USDT`}>
                      <i className="fa-solid fa-right-left" /> → USDT
                    </button>
                  ) : hasOcoBlocking && isCancelConfirm ? (
                    <div className="pf-row__sell-confirm">
                      <span className="pf-row__sell-confirm-label">Cancel·lar OCO i vendre?</span>
                      <button className="pf-row__sell-yes" onClick={() => cancelOcoAndSell(row.asset)}>
                        <i className="fa-solid fa-check" /> Sí
                      </button>
                      <button className="pf-row__sell-no" onClick={() => setCancelSellConfirm(null)}>
                        <i className="fa-solid fa-xmark" />
                      </button>
                    </div>
                  ) : hasOcoBlocking ? (
                    <button className="pf-row__sell-btn pf-row__sell-btn--oco"
                      onClick={() => setCancelSellConfirm(row.asset)}
                      title="Tot el saldo bloquejat en OCO. Cal cancel·lar per vendre.">
                      <i className="fa-solid fa-triangle-exclamation" /> Cancel OCO
                    </button>
                  ) : null
                )}
              </div>
            </div>
          );
        };

        const TableHeader = () => (
          <div className="pf-header">
            <div />
            <span>Asset</span>
            <span className="r">Valor</span>
            <span className="r">4h</span>
            <span className="r">1d</span>
            <span className="r">7d</span>
            <span className="r">1M</span>
            <span className="r">6M</span>
            <span className="r">1A</span>
            <span className="r">Sempre</span>
            <span className="r">Preu</span>
            <span className="r">Ordres</span>
          </div>
        );

        const StableHeader = () => (
          <div className="section-title pf-header--stable">
            <i className="fa-solid fa-circle-dollar-to-slot" />
            Stablecoin
            <span className="section-title__right">Valor</span>
          </div>
        );

        const cryptoTotal = nonStableRows.reduce((s, r) => s + r.valueUSD, 0);
        const stableTotal = stableRows.reduce((s, r) => s + r.valueUSD, 0);
        const splitTotal  = cryptoTotal + stableTotal;
        const splitData   = [
          { name: "Crypto",   value: cryptoTotal, color: "#6366f1" },
          { name: "Stables",  value: stableTotal, color: "#26A17B" },
        ];

        return (
          <div className="pf-two-col">
            {nonStableRows.length > 0 && (
              <div className="pf-list">
                <TableHeader />
                {nonStableRows.map(renderRow)}
                {/* Total row */}
                <div className="pf-row pf-row--total">
                  <div />
                  <div className="pf-row__identity">
                    <span className="pf-row__name" style={{ color: "var(--text-2)", fontWeight: 800 }}>TOTAL</span>
                  </div>
                  <div className="pf-row__value">
                    <span className="pf-row__usd mono">{formatCurrency(nonStableRows.reduce((s, r) => s + r.valueUSD, 0))}</span>
                  </div>
                  {renderTotalCell(totals.pnl4h)}
                  {renderTotalCell(totals.pnl24h)}
                  {renderTotalCell(totals.pnl7d)}
                  {renderTotalCell(totals.pnl4w)}
                  {renderTotalCell(totals.pnl6m)}
                  {renderTotalCell(totals.pnl1y)}
                  <div className="pf-row__pnl-block">
                    {totalUnrealizedPnl !== 0 && (() => {
                      const up = totalUnrealizedPnl >= 0;
                      return (
                        <span className={`pf-row__pnl-val ${up ? "pf-row--up" : "pf-row--dn"}`}>
                          {up ? "+" : ""}{formatCurrency(totalUnrealizedPnl)}
                        </span>
                      );
                    })()}
                  </div>
                  <div />
                  <div />
                </div>
              </div>
            )}

            {stableRows.length > 0 && (
              <div className="pf-list pf-list--stables">
                {nonStableRows.length > 0 && splitTotal > 0 && (
                  <div className="pf-split-col">
                    <div className="section-title pf-split-col__title"><i className="fa-solid fa-chart-pie" /> Distribució</div>
                    <div className="pf-split-col__body">
                      <PieChart width={110} height={110}>
                        <Pie data={splitData} cx={55} cy={55}
                          innerRadius={32} outerRadius={50}
                          paddingAngle={4} dataKey="value" startAngle={90} endAngle={-270}>
                          {splitData.map((d, i) => <Cell key={i} fill={d.color} />)}
                        </Pie>
                      </PieChart>
                      <div className="pf-split-col__legend">
                        {splitData.map(d => (
                          <div key={d.name} className="pf-split-col__item">
                            <span className="pf-split-col__dot" style={{ background: d.color }} />
                            <div className="pf-split-col__info">
                              <span className="pf-split-col__name">{d.name}</span>
                              <span className="pf-split-col__pct" style={{ color: d.color }}>
                                {((d.value / splitTotal) * 100).toFixed(1)}%
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                <StableHeader />
                {stableRows.map(renderRow)}
              </div>
            )}
          </div>
        );
      })()}

      {/* Dust section — assets < $1 */}
      {dustRows.length > 0 && (
        <div className="portfolio__dust">
          <div className="section-title">
            <i className="fa-solid fa-coins" />
            Dust · {dustRows.length} assets amb valor &lt; ${DUST_THRESHOLD}
          </div>
          <div className="portfolio__dust-list">
            {dustRows.map(row => (
              <div key={row.asset} className="portfolio__dust-row">
                <CoinIcon symbol={row.asset} size={14} />
                <span className="portfolio__dust-name">{row.asset}</span>
                <span className="portfolio__dust-qty mono">
                  {row.total.toFixed(row.total < 1 ? 6 : 4)}
                </span>
                <span className="portfolio__dust-val mono dim">
                  {row.valueUSD > 0 ? formatCurrency(row.valueUSD) : "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="portfolio__footer">
        <span className="panel-footer__dot" style={{ background: viewMode === "real" ? "var(--accent)" : "var(--blue)" }} />
        {viewMode === "real" ? "Binance Real" : "Binance Demo"} · Variació 24h = canvi de preu de mercat aplicat als holdings actuals
        {lastRefreshed && (
          <span className="panel-footer__right">
            <span className="panel-footer__refreshed">
              <i className="fa-solid fa-clock" />
              {lastRefreshed.toLocaleTimeString("ca-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
