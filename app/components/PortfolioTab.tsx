"use client";
import { useEffect, useState, useCallback } from "react";
import { BinanceBalance, BinanceOrder } from "../lib/binance-auth";
import { CoinRow } from "../lib/types";
import { formatCurrency } from "../lib/api";
import CoinIcon from "./CoinIcon";

interface AssetRow {
  asset: string;
  free: number;
  locked: number;
  total: number;
  price: number | null;
  change24h: number | null;
  valueUSD: number;
  pnl24h: number;
  lockedOrders: number; // count of open orders for this asset
}

const STABLES = new Set(["USDT", "USDC", "BUSD", "TUSD", "DAI"]);

function buildRows(
  balances: BinanceBalance[],
  coins: CoinRow[],
  openOrders: BinanceOrder[]
): AssetRow[] {
  return balances.map(b => {
    const free   = parseFloat(b.free);
    const locked = parseFloat(b.locked);
    const total  = free + locked;
    const coin   = coins.find(c => c.symbol === b.asset);
    const isStable = STABLES.has(b.asset);

    const price    = coin ? coin.price   : isStable ? 1 : null;
    const change24h = coin ? coin.change24h : 0;
    const valueUSD = price != null ? total * price : 0;
    const pnl24h   = (coin && price) ? valueUSD * (change24h! / 100) : 0;

    const lockedOrders = openOrders.filter(o =>
      o.symbol.startsWith(b.asset) && parseFloat(o.price) > 0
    ).length;

    return { asset: b.asset, free, locked, total, price, change24h, valueUSD, pnl24h, lockedOrders };
  }).sort((a, b) => b.valueUSD - a.valueUSD);
}

export default function PortfolioTab({
  coins, openOrderCount,
}: {
  coins: CoinRow[];
  openOrderCount: number;
}) {
  const [balances,    setBalances]    = useState<BinanceBalance[]>([]);
  const [openOrders,  setOpenOrders]  = useState<BinanceOrder[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [sortBy,      setSortBy]      = useState<"value" | "pnl" | "change" | "name">("value");

  const load = useCallback(() => {
    setLoading(true); setError(null);
    Promise.all([
      fetch("/api/balance").then(r => r.json()),
      fetch("/api/orders").then(r => r.json()),
    ]).then(([bal, ord]) => {
      if (bal.error) throw new Error(bal.error);
      if (ord.error) throw new Error(ord.error);
      setBalances(bal);
      setOpenOrders(ord);
    }).catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="state-empty">Loading portfolio…</div>;
  if (error)   return <div className="state-error">{error}</div>;

  const rows       = buildRows(balances, coins, openOrders);
  const totalValue = rows.reduce((s, r) => s + r.valueUSD, 0);
  const totalPnl   = rows.reduce((s, r) => s + r.pnl24h, 0);
  const pnlPct     = totalValue > 0 ? (totalPnl / (totalValue - totalPnl)) * 100 : 0;
  const pnlUp      = totalPnl >= 0;

  return (
    <div className="portfolio">

      {/* Summary cards */}
      <div className="portfolio__cards">
        <div className="portfolio__card portfolio__card--blue">
          <span className="portfolio__card-label">
            <i className="fa-solid fa-wallet" /> Portfolio Total
          </span>
          <span className="portfolio__card-value">{formatCurrency(totalValue)}</span>
          <span className="portfolio__card-sub">{rows.filter(r => r.valueUSD > 0).length} assets</span>
        </div>

        <div className={`portfolio__card portfolio__card--${pnlUp ? "green" : "red"}`}>
          <span className="portfolio__card-label">
            <i className={`fa-solid fa-arrow-trend-${pnlUp ? "up" : "down"}`} /> 24h P&L
          </span>
          <span className="portfolio__card-value">
            {pnlUp ? "+" : ""}{formatCurrency(totalPnl)}
          </span>
          <span className={`portfolio__card-sub portfolio__card-sub--${pnlUp ? "up" : "down"}`}>
            {pnlUp ? "+" : ""}{pnlPct.toFixed(2)}%
          </span>
        </div>

        <div className="portfolio__card portfolio__card--neutral">
          <span className="portfolio__card-label">
            <i className="fa-solid fa-list-check" /> Open Orders
          </span>
          <span className="portfolio__card-value">{openOrderCount}</span>
          <span className="portfolio__card-sub">OCO / LIMIT actives</span>
        </div>
      </div>

      {/* Asset grid */}
      <div className="portfolio__grid">
        {rows.map(row => {
          const up      = (row.change24h ?? 0) >= 0;
          const isStable = STABLES.has(row.asset);
          const pct     = totalValue > 0 ? (row.valueUSD / totalValue) * 100 : 0;
          return (
            <div key={row.asset} className="portfolio__asset-card">
              {/* Header */}
              <div className="portfolio__asset-card-header">
                <div className="portfolio__asset-card-identity">
                  <CoinIcon symbol={row.asset} size={20} />
                  <span className="portfolio__asset-card-name">{row.asset}</span>
                </div>
                {pct > 0 && (
                  <span className="portfolio__asset-card-pct">{pct.toFixed(1)}%</span>
                )}
              </div>

              {/* Current price — big */}
              <div className="portfolio__asset-card-price mono">
                {row.price != null ? formatCurrency(row.price) : "—"}
              </div>

              {/* 24h change badge */}
              {!isStable && row.change24h != null && (
                <span className={`portfolio__asset-card-change portfolio__asset-card-change--${up ? "up" : "down"}`}>
                  {up ? "+" : ""}{row.change24h.toFixed(2)}%
                </span>
              )}

              {/* Stats */}
              <div className="portfolio__asset-card-stats">
                <div className="portfolio__asset-card-stat">
                  <span>Valor</span>
                  <span className="mono">{row.valueUSD > 0 ? formatCurrency(row.valueUSD) : "—"}</span>
                </div>
                <div className="portfolio__asset-card-stat">
                  <span>Total</span>
                  <span className="mono">{row.total.toFixed(row.total < 1 ? 6 : 4)}</span>
                </div>
                {row.locked > 0 && (
                  <div className="portfolio__asset-card-stat">
                    <span>Bloquejat</span>
                    <span className="mono">
                      {row.locked.toFixed(row.locked < 1 ? 6 : 4)}
                      {row.lockedOrders > 0 && <span className="symbol-col__tag" style={{ marginLeft: 4 }}>OCO</span>}
                    </span>
                  </div>
                )}
                {!isStable && row.pnl24h !== 0 && (
                  <div className="portfolio__asset-card-stat">
                    <span>P&L 24h</span>
                    <span style={{ color: row.pnl24h >= 0 ? "var(--green)" : "var(--red)", fontWeight: 600 }}>
                      {row.pnl24h >= 0 ? "+" : ""}{formatCurrency(row.pnl24h)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="portfolio__footer">
        <span className="panel-footer__dot" style={{ background: "var(--blue)" }} />
        Binance Demo · P&amp;L basat en variació 24h
        <button className="tabs__action" onClick={load} style={{ marginLeft: "auto" }}>↻ Refresh</button>
      </div>
    </div>
  );
}
