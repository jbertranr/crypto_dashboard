"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { PieChart, Pie, Cell, Tooltip as ChartTooltip } from "recharts";
import { BinanceBalance, BinanceOrder } from "../lib/binance-auth";
import { CoinRow } from "../lib/types";
import { formatCurrency } from "../lib/format";
import CoinIcon from "./CoinIcon";
import PortfolioChart from "./PortfolioChart";

const SNAPSHOT_INTERVAL = 15 * 60 * 1000; // 15 min

interface AssetRow {
  asset: string;
  free: number;
  locked: number;
  total: number;
  price: number | null;
  change24h: number | null;
  valueUSD: number;
  pnl24h: number;
  lockedOrders: number;
}

const STABLES = new Set(["USDT", "USDC", "BUSD", "TUSD", "DAI"]);

const CRYPTO_BRAND_COLORS: Record<string, string> = {
  BTC:  "#F7931A", ETH:  "#627EEA", BNB:  "#F3BA2F", SOL:  "#00FFA3",
  XRP:  "#00AAE4", DOGE: "#C2A633", ADA:  "#0033AD", AVAX: "#E84142",
  TRX:  "#FF060A", DOT:  "#E6007A", LINK: "#2A5ADA", MATIC:"#8247E5",
  POL:  "#8247E5", LTC:  "#345D9D", SHIB: "#FFA409", UNI:  "#FF007A",
  ATOM: "#6F7390", ETC:  "#328332", XLM:  "#14B6E7", APT:  "#00B4D8",
  NEAR: "#00EC97", USDT: "#26A17B", USDC: "#2775CA", BUSD: "#F0B90B",
  DAI:  "#F5AC37", PEPE: "#47A838", WIF:  "#9B4FFF", BONK: "#F7A51E",
  SUI:  "#6FBCF0", TON:  "#0098EA", FTM:  "#1969FF", ARB:  "#12AAFF",
  OP:   "#FF0420", INJ:  "#00A3FF", RUNE: "#33FF99", FIL:  "#0090FF",
};

const FALLBACK_COLORS = [
  "#64748b", "#7c3aed", "#db2777", "#0891b2",
  "#059669", "#d97706", "#9333ea", "#0369a1",
];

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0)
          : max === g ? (b - r) / d + 2
          :             (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if      (h < 60)  { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else              { r = c; g = 0; b = x; }
  const hex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function hueDiff(h1: number, h2: number): number {
  const d = Math.abs(h1 - h2) % 360;
  return d > 180 ? 360 - d : d;
}

function resolveCryptoColors(items: Array<{ name: string; value: number }>): Record<string, string> {
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const result: Record<string, string> = {};
  const assigned: Array<[number, number, number]> = [];
  let fbIdx = 0;
  for (const item of sorted) {
    const brand = CRYPTO_BRAND_COLORS[item.name];
    let [h, s, l] = brand
      ? hexToHsl(brand)
      : hexToHsl(FALLBACK_COLORS[fbIdx++ % FALLBACK_COLORS.length]);
    for (let i = 0; i < 8; i++) {
      if (assigned.every(([ah]) => hueDiff(h, ah) >= 25)) break;
      h = (h + 35) % 360;
    }
    assigned.push([h, s, l]);
    result[item.name] = hslToHex(h, s, l);
  }
  return result;
}

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

    const price     = coin ? coin.price    : isStable ? 1 : null;
    const change24h = coin ? coin.change24h : 0;
    const valueUSD  = price != null ? total * price : 0;
    const pnl24h    = (coin && price) ? valueUSD * (change24h! / 100) : 0;

    const lockedOrders = openOrders.filter(o =>
      o.symbol.startsWith(b.asset) && parseFloat(o.price) > 0
    ).length;

    return { asset: b.asset, free, locked, total, price, change24h, valueUSD, pnl24h, lockedOrders };
  }).sort((a, b) => b.valueUSD - a.valueUSD);
}

export default function PortfolioTab({
  coins, openOrders, refreshTrigger,
}: {
  coins: CoinRow[];
  openOrders: BinanceOrder[];
  refreshTrigger: number;
}) {
  const [balances, setBalances] = useState<BinanceBalance[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [sortBy,        setSortBy]        = useState<"value" | "pnl" | "change" | "name">("value");
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [snapshotTick,  setSnapshotTick]  = useState(0);
  const lastSnapshotRef = useRef<number>(0);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    fetch("/api/balance").then(r => r.json())
      .then(bal => { if (bal.error) throw new Error(bal.error); setBalances(bal); setLastRefreshed(new Date()); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load, refreshTrigger]);

  // Auto-reload every 15 min to take a fresh snapshot
  useEffect(() => {
    const id = setInterval(load, SNAPSHOT_INTERVAL);
    return () => clearInterval(id);
  }, [load]);

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

  if (loading) return <div className="state-empty">Loading portfolio…</div>;
  if (error)   return <div className="state-error">{error}</div>;

  const DUST_THRESHOLD = 1; // < $1 → dust

  const baseRows = buildRows(balances, coins, openOrders);

  // Split: main assets (≥ $1) vs dust (< $1)
  const mainBase = baseRows.filter(r => r.valueUSD >= DUST_THRESHOLD);
  const dustRows = baseRows.filter(r => r.valueUSD >  0 && r.valueUSD < DUST_THRESHOLD);

  const rows = [...mainBase].sort((a, b) => {
    if (sortBy === "value")  return b.valueUSD - a.valueUSD;
    if (sortBy === "pnl")    return b.pnl24h - a.pnl24h;
    if (sortBy === "change") return (b.change24h ?? 0) - (a.change24h ?? 0);
    if (sortBy === "name")   return a.asset.localeCompare(b.asset);
    return 0;
  });

  // Totals include all (including dust) for accuracy
  const totalValue = baseRows.reduce((s, r) => s + r.valueUSD, 0);
  const totalPnl   = baseRows.reduce((s, r) => s + r.pnl24h, 0);
  const pnlPct     = totalValue > 0 ? (totalPnl / (totalValue - totalPnl)) * 100 : 0;
  const pnlUp      = totalPnl >= 0;

  // Middle-section: exclude dust
  const resolvedColors = resolveCryptoColors(mainBase.map(r => ({ name: r.asset, value: r.valueUSD })));
  const chartData = mainBase
    .map(r => ({
      name:  r.asset,
      value: r.valueUSD,
      pct:   totalValue > 0 ? (r.valueUSD / totalValue) * 100 : 0,
      color: resolvedColors[r.asset],
    }));

  const top3 = rows.filter(r => r.valueUSD > 0 && !STABLES.has(r.asset)).slice(0, 3);

  const pnlRanking = [...rows]
    .filter(r => !STABLES.has(r.asset) && r.pnl24h !== 0)
    .sort((a, b) => b.pnl24h - a.pnl24h);

  const ocoCount   = new Set(openOrders.filter(o => o.orderListId !== -1).map(o => o.orderListId)).size;
  const limitCount = openOrders.filter(o => o.orderListId === -1).length;

  return (
    <div className="portfolio">

      {/* Summary cards */}
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

        <div className={`portfolio__card portfolio__card--${pnlUp ? "green" : "red"}`}>
          <span className="portfolio__card-label">
            <i className={`fa-solid fa-arrow-trend-${pnlUp ? "up" : "down"}`} /> Net P&L
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
            <i className="fa-solid fa-list-check" /> Ordres obertes
          </span>
          <span className="portfolio__card-value">{openOrders.length}</span>
          <span className="portfolio__card-sub">
            {ocoCount} OCO / {limitCount} LIMIT actives
          </span>
        </div>
      </div>

      {/* Middle section: donut chart + top assets + 24H P&L rank */}
      {totalValue > 0 && (
        <div className="portfolio__mid">

          {/* Donut chart */}
          <div className="portfolio__donut-section">
            <div className="portfolio__section-title">Portfolio distribució</div>
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
            <PortfolioChart refreshTick={snapshotTick} />
          </div>

          {/* 24H P&L ranking */}
          <div className="portfolio__pnl-rank">
            <div className="portfolio__section-title">24H P&L</div>
            {pnlRanking.slice(0, 6).map(row => {
              const up = row.pnl24h >= 0;
              return (
                <div key={row.asset} className="portfolio__pnl-rank-row">
                  <span className="portfolio__pnl-rank-name">{row.asset}</span>
                  <span className={`portfolio__pnl-rank-val portfolio__pnl-rank-val--${up ? "up" : "down"}`}>
                    {up ? "+" : ""}{formatCurrency(row.pnl24h)}
                  </span>
                </div>
              );
            })}
          </div>

        </div>
      )}

      {/* Sort controls */}
      <div className="portfolio__sort-bar">
        <span className="portfolio__sort-label">Ordenar per</span>
        {([
          { key: "value",  label: "Valor",   icon: "fa-dollar-sign"    },
          { key: "pnl",    label: "P&L 24h", icon: "fa-arrow-trend-up" },
          { key: "change", label: "% 24h",   icon: "fa-percent"        },
          { key: "name",   label: "Nom",     icon: "fa-arrow-down-a-z" },
        ] as { key: typeof sortBy; label: string; icon: string }[]).map(opt => (
          <button key={opt.key}
            className={`portfolio__sort-btn${sortBy === opt.key ? " portfolio__sort-btn--active" : ""}`}
            onClick={() => setSortBy(opt.key)}>
            <i className={`fa-solid ${opt.icon}`} />
            {opt.label}
          </button>
        ))}
      </div>

      {/* Asset grid */}
      {(() => {
        const nonStableRows = rows.filter(r => !STABLES.has(r.asset));
        const stableRows    = rows.filter(r =>  STABLES.has(r.asset));

        // Map asset → donut color (same as chart legend)
        const colorMap: Record<string, string> = {};
        chartData.forEach(d => { colorMap[d.name] = d.color; });

        const weightOf = (pct: number) =>
          pct >= 25 ? "xl" : pct >= 10 ? "lg" : pct >= 3 ? "md" : "sm";

        const iconSizeOf = (w: string) =>
          w === "xl" ? 28 : w === "lg" ? 22 : w === "md" ? 18 : 14;

        const renderCard = (row: typeof rows[0]) => {
          const up       = (row.change24h ?? 0) >= 0;
          const isStable = STABLES.has(row.asset);
          const pct      = totalValue > 0 ? (row.valueUSD / totalValue) * 100 : 0;
          const color    = colorMap[row.asset] ?? "#94a3b8";
          const weight   = isStable ? "md" : weightOf(pct);
          const iconSize = iconSizeOf(weight);

          return (
            <div
              key={row.asset}
              className={`portfolio__asset-card portfolio__asset-card--${weight}`}
              style={{
                "--card-color": color,
                borderTop: `3px solid ${color}`,
                background: `linear-gradient(160deg, ${color}18 0%, var(--bg-card) 45%)`,
              } as React.CSSProperties}
            >
              <div className="portfolio__asset-card-header">
                <div className="portfolio__asset-card-identity">
                  <CoinIcon symbol={row.asset} size={iconSize} />
                  <span className="portfolio__asset-card-name">{row.asset}</span>
                </div>
                {pct > 0 && (
                  <span className="portfolio__asset-card-pct" style={{ color, background: `${color}18` }}>
                    {pct.toFixed(1)}%
                  </span>
                )}
              </div>

              <div className="portfolio__asset-card-price mono">
                {row.valueUSD > 0 ? formatCurrency(row.valueUSD) : "—"}
              </div>

              {!isStable && row.change24h != null && (
                <span className={`portfolio__asset-card-change portfolio__asset-card-change--${up ? "up" : "down"}`}>
                  {up ? "+" : ""}{row.change24h.toFixed(2)}%
                </span>
              )}

              <div className="portfolio__asset-card-stats">
                <div className="portfolio__asset-card-stat">
                  <span>Total</span>
                  <span className="mono">{row.total.toFixed(row.total < 1 ? 6 : 4)}</span>
                </div>
                {row.price != null && !isStable && (
                  <div className="portfolio__asset-card-stat">
                    <span>Preu</span>
                    <span className="mono">{formatCurrency(row.price)}</span>
                  </div>
                )}
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
        };

        return (
          <>
            {nonStableRows.length > 0 && (
              <div className="portfolio__grid">
                {nonStableRows.map(renderCard)}
              </div>
            )}

            {stableRows.length > 0 && (
              <div className="portfolio__stables">
                <div className="portfolio__stables-header">
                  <i className="fa-solid fa-dollar-sign" />
                  Stablecoins
                </div>
                <div className="portfolio__grid portfolio__grid--stables">
                  {stableRows.map(renderCard)}
                </div>
              </div>
            )}
          </>
        );
      })()}

      {/* Dust section — assets < $1 */}
      {dustRows.length > 0 && (
        <div className="portfolio__dust">
          <div className="portfolio__dust-header">
            <i className="fa-solid fa-coins" />
            Dust · {dustRows.length} assets amb valor &lt; $1
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
        Binance Demo · P&amp;L basat en variació 24h
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
