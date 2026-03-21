"use client";
import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { PieChart, Pie, Cell, Tooltip as ChartTooltip } from "recharts";
import { BinanceBalance, BinanceOrder } from "../lib/binance-auth";
import { CoinRow } from "../lib/types";
import { formatCurrency } from "../lib/format";
import CoinIcon, { coinColor } from "./CoinIcon";
import PortfolioChart, { Period } from "./PortfolioChart";
import { STABLES } from "../lib/constants";

const SNAPSHOT_INTERVAL = 15 * 60 * 1000; // 15 min

interface AssetRow {
  asset: string;
  free: number;
  locked: number;
  total: number;
  price: number | null;
  change1h:  number | null;
  change4h:  number | null;
  change24h: number | null;
  change72h: number | null;
  change7d:  number | null;
  change4w:  number | null;
  change6m:  number | null;
  valueUSD: number;
  pnl1h:  number;
  pnl4h:  number;
  pnl24h: number;
  pnl72h: number;
  pnl7d:  number;
  pnl4w:  number;
  pnl6m:  number;
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
    const change1h  = coin ? coin.change1h  : null;
    const change4h  = coin ? coin.change4h  : null;
    const change24h = coin ? coin.change24h : null;
    const change72h = coin ? coin.change72h : null;
    const change7d  = coin ? coin.change7d  : null;
    const change4w  = coin ? coin.change4w  : null;
    const change6m  = coin ? coin.change6m  : null;
    const valueUSD  = price != null ? total * price : 0;
    // Correct formula: valueUSD × c/(100+c) = qty × (currentPrice − priceAtWindowStart)
    // Using valueUSD × c/100 overstates gains because it applies % to the already-higher current value
    const pnlW = (c: number | null) =>
      (coin && price && c != null) ? valueUSD * c / (100 + c) : 0;
    const pnl1h  = pnlW(change1h);
    const pnl4h  = pnlW(change4h);
    const pnl24h = pnlW(change24h);
    const pnl72h = pnlW(change72h);
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

    return { asset: b.asset, free, locked, total, price, change1h, change4h, change24h, change72h, change7d, change4w, change6m, valueUSD, pnl1h, pnl4h, pnl24h, pnl72h, pnl7d, pnl4w, pnl6m, lockedOrders, ocoCount, slCount, avgCost, firstBuyTime, unrealizedPnl };
  }).sort((a, b) => b.valueUSD - a.valueUSD);
}

type PnlData = { d1: number; d7: number; d30: number; d365: number };

interface UnrealizedRow { asset: string; pnl: number; valueUSD: number; }

function PnlSummaryPanel({ unrealizedRows }: {
  unrealizedRows: UnrealizedRow[];
}) {
  const [snapshots, setSnapshots] = useState<{ time: number; value: number }[]>([]);
  const [loadingSnap, setLoadingSnap] = useState(true);

  useEffect(() => {
    fetch("/api/portfolio-snapshot")
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setSnapshots(d); })
      .catch(() => {})
      .finally(() => setLoadingSnap(false));
  }, []);

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
  coins, openOrders, refreshTrigger,
}: {
  coins: CoinRow[];
  openOrders: BinanceOrder[];
  refreshTrigger: number;
}) {
  const [balances,  setBalances]  = useState<BinanceBalance[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [costBasis, setCostBasis] = useState<Record<string, CostBasisEntry>>({});
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
    fetch("/api/balance", { cache: "no-store" }).then(r => r.json())
      .then(bal => { if (bal.error) throw new Error(bal.error); setBalances(bal); setLastRefreshed(new Date()); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load, refreshTrigger]);

  useEffect(() => {
    fetch("/api/cost-basis")
      .then(r => r.json())
      .then(d => { if (!d.error) setCostBasis(d); })
      .catch(err => console.warn("[PortfolioTab] cost-basis:", (err as Error).message));
  }, [refreshTrigger]);

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
      body: JSON.stringify({ time: now, value: total }),
    }).then(() => setSnapshotTick(t => t + 1));
  }, [balances, coins]);

  const cancelOcoAndSell = async (asset: string) => {
    const symbol = `${asset}USDT`;
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
      const balRes = await fetch("/api/balance", { cache: "no-store" });
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
        body: JSON.stringify({ asset, quantity: quantity.toString() }),
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
      pnl1h:  baseRows.filter(r => !STABLES.has(r.asset)).reduce((s, r) => s + r.pnl1h,  0),
      pnl4h:  baseRows.filter(r => !STABLES.has(r.asset)).reduce((s, r) => s + r.pnl4h,  0),
      pnl24h: baseRows.filter(r => !STABLES.has(r.asset)).reduce((s, r) => s + r.pnl24h, 0),
      pnl72h: baseRows.filter(r => !STABLES.has(r.asset)).reduce((s, r) => s + r.pnl72h, 0),
      pnl7d:  baseRows.filter(r => !STABLES.has(r.asset)).reduce((s, r) => s + r.pnl7d,  0),
      pnl4w:  baseRows.filter(r => !STABLES.has(r.asset)).reduce((s, r) => s + r.pnl4w,  0),
      pnl6m:  baseRows.filter(r => !STABLES.has(r.asset)).reduce((s, r) => s + r.pnl6m,  0),
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
            <PortfolioChart refreshTick={snapshotTick} period={period} setPeriod={setPeriod} onStats={handleChartStats} />
          </div>

          {/* P&L: realitzat + si tanques ara */}
          <PnlSummaryPanel unrealizedRows={unrealizedRows} />

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
          <span className={`pf-row__change ${pnl >= 0 ? "pf-row__change--up" : "pf-row__change--dn"}`}>
            <span className="pf-row__change-usd">{pnl >= 0 ? "+" : ""}{formatCurrency(pnl, 2)}</span>
          </span>
        );

        const renderPnlCell = (pnl: number, chg: number | null, valid = true) => (
          <span className={`pf-row__change ${!valid ? "" : pnl >= 0 ? "pf-row__change--up" : "pf-row__change--dn"}`}>
            {!valid ? (
              <span className="pf-row__change-usd" style={{ opacity: 0.25 }}>—</span>
            ) : pnl !== 0 ? (
              <>
                <span className="pf-row__change-usd">{pnl >= 0 ? "+" : ""}{formatCurrency(pnl, 2)}</span>
                <span className="pf-row__change-pct">{(chg ?? 0) >= 0 ? "+" : ""}{(chg ?? 0).toFixed(2)}%</span>
              </>
            ) : <span className="pf-row__change-usd" style={{ opacity: 0.3 }}>—</span>}
          </span>
        );

        const renderLockedPnlCell = (pnl: number, chg: number | null) => (
          <span className={`pf-row__change ${pnl >= 0 ? "pf-row__change--up" : "pf-row__change--dn"}`}>
            {chg != null && pnl !== 0 ? (
              <>
                <span className="pf-row__change-usd">{pnl >= 0 ? "+" : ""}{formatCurrency(pnl, 2)}</span>
                <span className="pf-row__change-pct">{chg >= 0 ? "+" : ""}{chg.toFixed(2)}%</span>
              </>
            ) : <span className="pf-row__change-usd" style={{ opacity: 0.3 }}>—</span>}
          </span>
        );

        const renderRow = (row: typeof rows[0]) => {
          const up       = (row.change24h ?? 0) >= 0;
          const isStable = STABLES.has(row.asset);
          const pct      = totalValue > 0 ? (row.valueUSD / totalValue) * 100 : 0;
          const color    = colorMap[row.asset] ?? "#94a3b8";
          const pnlPct   = row.avgCost && row.price && !isStable
            ? ((row.price - row.avgCost) / row.avgCost) * 100
            : null;

          const isSelling        = !!selling[row.asset];
          const isConfirm        = sellConfirm === row.asset;
          const isCancelConfirm  = cancelSellConfirm === row.asset;
          const canSell          = !isStable && row.free > 0;
          const hasOcoBlocking   = !isStable && row.free === 0 && row.locked > 0;

          const accentColor = isStable
            ? "var(--text-3)"
            : pnlPct == null
              ? "var(--text-3)"
              : pnlPct > 0
                ? "var(--green)"
                : "var(--red)";

          const now = Date.now();
          const heldMs = row.firstBuyTime > 0 ? now - row.firstBuyTime : 0;
          // validWindow: user must have held >= minMs AND (if we have avgCost) must have bought
          // BEFORE the window started — avgCost > priceAtWindowStart means bought during the window.
          const validWindow = (change: number | null, minMs: number) => {
            if (!row.price || change == null) return false;
            if (heldMs < minMs) return false;
            if (row.avgCost != null) {
              const histPrice = row.price / (1 + change / 100);
              if (row.avgCost > histPrice) return false;
            }
            return true;
          };
          const v1h  = validWindow(row.change1h,  1   * 3600_000);
          const v4h  = validWindow(row.change4h,  4   * 3600_000);
          const v24h = validWindow(row.change24h, 24  * 3600_000);
          const v3d  = validWindow(row.change72h, 3   * 86_400_000);
          const v7d  = validWindow(row.change7d,  7   * 86_400_000);
          const v4w  = validWindow(row.change4w,  30  * 86_400_000);
          const v6m  = validWindow(row.change6m,  180 * 86_400_000);

          // Orders sub-row (only for non-stable with locked qty)
          const hasLockedOrders = !isStable && row.locked > 0;
          const lockedValue     = hasLockedOrders && row.price != null ? row.locked * row.price : 0;
          const lockedPnlW = (c: number | null) =>
            (hasLockedOrders && row.price && c != null) ? lockedValue * c / (100 + c) : 0;
          const lockedSempre = (row.avgCost != null && row.price != null && hasLockedOrders)
            ? row.locked * (row.price - row.avgCost)
            : null;
          const lockedSemprePct = (lockedSempre != null && row.avgCost != null && row.avgCost > 0)
            ? ((row.price! - row.avgCost) / row.avgCost) * 100
            : null;

          return (
            <React.Fragment key={row.asset}>
            <div
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
                <span className="pf-row__qty">{row.total.toFixed(row.total < 1 ? 5 : 4)} {row.asset}</span>
                {!isStable && row.free > 0 && (row.ocoCount > 0 || row.slCount > 0) && (
                  <span className="pf-row__unprotected" title="Quantitat lliure sense ordre de protecció">
                    <i className="fa-solid fa-triangle-exclamation" />
                    {row.free.toFixed(row.free < 1 ? 4 : 3)} {row.asset} lliure
                  </span>
                )}
              </div>

              {!isStable ? renderPnlCell(row.pnl1h,  row.change1h,  v1h)  : null}
              {!isStable ? renderPnlCell(row.pnl4h,  row.change4h,  v4h)  : null}
              {!isStable ? renderPnlCell(row.pnl24h, row.change24h, v24h) : null}
              {!isStable ? renderPnlCell(row.pnl72h, row.change72h, v3d)  : null}
              {!isStable ? renderPnlCell(row.pnl7d,  row.change7d,  v7d)  : null}
              {!isStable ? renderPnlCell(row.pnl4w,  row.change4w,  v4w)  : null}
              {!isStable ? renderPnlCell(row.pnl6m,  row.change6m,  v6m)  : null}

              <div className="pf-row__pnl-block">
                {row.unrealizedPnl != null && pnlPct != null ? (
                  <>
                    <span className={`pf-row__pnl-val ${row.unrealizedPnl >= 0 ? "pf-row--up" : "pf-row--dn"}`}>
                      {row.unrealizedPnl >= 0 ? "+" : ""}{formatCurrency(row.unrealizedPnl)}
                    </span>
                    <span className={`pf-row__pnl-pct ${pnlPct >= 0 ? "pf-row--up" : "pf-row--dn"}`}>
                      {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%
                    </span>
                  </>
                ) : null}
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
                      <button className="pf-row__sell-yes"
                        onClick={() => sellToUsdt(row.asset, row.free)}>
                        <i className="fa-solid fa-check" /> Sí
                      </button>
                      <button className="pf-row__sell-no"
                        onClick={() => setSellConfirm(null)}>
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
                      <button className="pf-row__sell-yes"
                        onClick={() => cancelOcoAndSell(row.asset)}>
                        <i className="fa-solid fa-check" /> Sí
                      </button>
                      <button className="pf-row__sell-no"
                        onClick={() => setCancelSellConfirm(null)}>
                        <i className="fa-solid fa-xmark" />
                      </button>
                    </div>
                  ) : hasOcoBlocking ? (
                    <button className="pf-row__sell-btn pf-row__sell-btn--oco"
                      onClick={() => setCancelSellConfirm(row.asset)}
                      title="Tot el saldo està bloquejat en un OCO. Cal cancel·lar-lo per vendre.">
                      <i className="fa-solid fa-triangle-exclamation" /> Cancel OCO
                    </button>
                  ) : null
                )}
              </div>
            </div>

            {/* Orders sub-row */}
            {hasLockedOrders && (
              <div className="pf-orders-row"
                style={{ "--pf-color": color } as React.CSSProperties}>
                <span className="pf-orders-row__accent" />
                <div className="pf-orders-row__identity">
                  <i className="fa-solid fa-lock pf-orders-row__icon" />
                  <span className="pf-orders-row__qty">{row.locked.toFixed(row.locked < 1 ? 5 : 4)}</span>
                  <span style={{ color: "var(--text-3)" }}>{row.asset} bloquejat</span>
                </div>
                <div className="pf-orders-row__value">
                  {formatCurrency(lockedValue)}
                </div>
                {renderLockedPnlCell(lockedPnlW(row.change1h),  row.change1h)}
                {renderLockedPnlCell(lockedPnlW(row.change4h),  row.change4h)}
                {renderLockedPnlCell(lockedPnlW(row.change24h), row.change24h)}
                {renderLockedPnlCell(lockedPnlW(row.change72h), row.change72h)}
                {renderLockedPnlCell(lockedPnlW(row.change7d),  row.change7d)}
                {renderLockedPnlCell(lockedPnlW(row.change4w),  row.change4w)}
                {renderLockedPnlCell(lockedPnlW(row.change6m),  row.change6m)}
                <div className="pf-orders-row__semprepnl">
                  {lockedSempre != null ? (
                    <>
                      <span className={`pf-row__pnl-val ${lockedSempre >= 0 ? "pf-row--up" : "pf-row--dn"}`}>
                        {lockedSempre >= 0 ? "+" : ""}{formatCurrency(lockedSempre)}
                      </span>
                      {lockedSemprePct != null && (
                        <span className={`pf-row__pnl-pct ${lockedSemprePct >= 0 ? "pf-row--up" : "pf-row--dn"}`}>
                          {lockedSemprePct >= 0 ? "+" : ""}{lockedSemprePct.toFixed(1)}%
                        </span>
                      )}
                    </>
                  ) : <span style={{ opacity: 0.3, fontSize: "0.7rem" }}>—</span>}
                </div>
                <div />
                <div className="pf-orders-row__badges">
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
              </div>
            )}
            </React.Fragment>
          );
        };

        const TableHeader = () => (
          <div className="pf-header">
            <div />
            <span>Asset</span>
            <span className="r">Valor</span>
            <span className="r">1h</span>
            <span className="r">4h</span>
            <span className="r">1d</span>
            <span className="r">3d</span>
            <span className="r">7d</span>
            <span className="r">1m</span>
            <span className="r">6m</span>
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
                  {renderTotalCell(totals.pnl1h)}
                  {renderTotalCell(totals.pnl4h)}
                  {renderTotalCell(totals.pnl24h)}
                  {renderTotalCell(totals.pnl72h)}
                  {renderTotalCell(totals.pnl7d)}
                  {renderTotalCell(totals.pnl4w)}
                  {renderTotalCell(totals.pnl6m)}
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

            {/* Gràfic de distribució crypto / stables */}
            {nonStableRows.length > 0 && stableRows.length > 0 && splitTotal > 0 && (
              <div className="pf-split-col">
                <div className="section-title pf-split-col__title"><i className="fa-solid fa-chart-pie" /> Distribució</div>
                <PieChart width={100} height={100}>
                  <Pie data={splitData} cx={50} cy={50}
                    innerRadius={30} outerRadius={46}
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
            )}

            {stableRows.length > 0 && (
              <div className="pf-list pf-list--stables">
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
        <span className="panel-footer__dot" style={{ background: "var(--blue)" }} />
        Binance Demo · Variació 24h = canvi de preu de mercat aplicat als holdings actuals
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
