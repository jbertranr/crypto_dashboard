"use client";
import { useEffect, useState } from "react";
import { CoinRow } from "../lib/types";
import { formatCurrency } from "../lib/api";
import CoinIcon from "./CoinIcon";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from "recharts";

interface ChartPoint { time: number; close: number; }

const TIMEFRAMES = [
  { label: "1D", interval: "1h",  limit: "24" },
  { label: "1W", interval: "4h",  limit: "42" },
  { label: "1M", interval: "1d",  limit: "30" },
  { label: "3M", interval: "1d",  limit: "90" },
] as const;

type TFLabel = (typeof TIMEFRAMES)[number]["label"];

export default function CoinModal({ coin, onClose }: { coin: CoinRow; onClose: () => void }) {
  const [tf, setTf]           = useState<TFLabel>("1D");
  const [chart, setChart]     = useState<ChartPoint[]>([]);
  const [loading, setLoading] = useState(true);

  const up    = coin.change24h >= 0;
  const color = up ? "#00c076" : "#f6465d";

  useEffect(() => {
    const { interval, limit } = TIMEFRAMES.find(t => t.label === tf)!;
    setLoading(true);
    fetch(`/api/klines?pair=${coin.pair}&interval=${interval}&limit=${limit}`)
      .then(r => r.json()).then(d => { setChart(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [coin.pair, tf]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const fmt = (ts: number) => {
    const d = new Date(ts);
    if (tf === "1D") return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return (
    <div className="coin-modal__backdrop" onClick={onClose}>
      <div className="coin-modal__box" onClick={e => e.stopPropagation()}>

        <div className="coin-modal__header">
          <div className="coin-modal__identity">
            <CoinIcon symbol={coin.symbol} size={40} />
            <div>
              <p className="coin-modal__name">{coin.symbol} / USDT</p>
              <p className="coin-modal__meta">Binance Demo · {coin.pair}</p>
            </div>
          </div>
          <button className="coin-modal__close" onClick={onClose}>×</button>
        </div>

        <p className="coin-modal__price">{formatCurrency(coin.price)}</p>
        <p className={`coin-modal__change ${up ? "coin-modal__change--up" : "coin-modal__change--down"}`}>
          {up ? "▲" : "▼"} {Math.abs(coin.change24h).toFixed(2)}% (24h)
        </p>

        <div className="coin-modal__tfs">
          {TIMEFRAMES.map(({ label }) => (
            <button key={label} onClick={() => setTf(label)}
              className={`coin-modal__tf${tf === label ? " coin-modal__tf--active" : ""}`}>
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="coin-modal__chart-loading">Loading chart…</div>
        ) : (
          <div className="coin-modal__chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart}>
                <defs>
                  <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={color} stopOpacity={0.2} />
                    <stop offset="95%" stopColor={color} stopOpacity={0}   />
                  </linearGradient>
                </defs>
                <XAxis dataKey="time" tickFormatter={fmt}
                  tick={{ fill: "#4a5568", fontSize: 10 }} tickLine={false} axisLine={false}
                  interval="preserveStartEnd" />
                <YAxis domain={["auto","auto"]} tickFormatter={v => formatCurrency(v)}
                  tick={{ fill: "#4a5568", fontSize: 10 }} tickLine={false} axisLine={false} width={72} />
                <Tooltip
                  contentStyle={{ background: "#ffffff", border: "1px solid #e2e8f0",
                    borderRadius: 8, color: "#0f172a", fontSize: 12, boxShadow: "0 4px 16px rgba(0,0,0,0.08)" }}
                  labelFormatter={v => fmt(v as number)}
                  formatter={v => [v != null ? formatCurrency(v as number) : "", "Price"]}
                />
                <Area type="monotone" dataKey="close"
                  stroke={color} strokeWidth={2} fill="url(#cg)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="coin-modal__stats">
          {[
            ["24h High",    formatCurrency(coin.high24h)],
            ["24h Low",     formatCurrency(coin.low24h)],
            ["Volume USDT", formatCurrency(coin.volumeUSDT)],
            ["Exchange",    "Binance Demo"],
          ].map(([l, v]) => (
            <div key={l} className="coin-modal__stat">
              <p className="coin-modal__stat-label">{l}</p>
              <p className="coin-modal__stat-value">{v}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
