"use client";
import { useEffect, useState } from "react";
import {
  ResponsiveContainer, AreaChart, Area,
  XAxis, YAxis, Tooltip, ReferenceLine,
} from "recharts";
import { formatCurrency } from "../lib/format";

interface Snapshot { time: number; value: number; }

export default function PortfolioChart({ refreshTick }: { refreshTick: number }) {
  const [data, setData] = useState<Snapshot[]>([]);

  useEffect(() => {
    fetch("/api/portfolio-snapshot")
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setData(d); });
  }, [refreshTick]);

  const fmt = (ts: number) => {
    const d   = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString())
      return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " "
      + d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  };

  if (data.length < 2) {
    return (
      <div className="pchart">
        <div className="pchart__header">
          <span className="pchart__title">
            <i className="fa-solid fa-chart-line" /> Evolució del portfolio
          </span>
        </div>
        <div className="pchart__empty">
          <i className="fa-solid fa-hourglass-half" />
          Recollint dades… el gràfic s&apos;activarà quan hi hagi almenys 2 snapshots
          {data.length === 1 && (
            <span className="pchart__empty-sub">
              1 snapshot registrat · pròxim en {15} min
            </span>
          )}
        </div>
      </div>
    );
  }

  const first   = data[0].value;
  const last    = data[data.length - 1].value;
  const diff    = last - first;
  const pct     = first > 0 ? (diff / first) * 100 : 0;
  const up      = diff >= 0;
  const color   = up ? "#059669" : "#dc2626";
  const prices  = data.map(d => d.value);
  const minV    = Math.min(...prices);
  const maxV    = Math.max(...prices);
  const pad     = (maxV - minV) * 0.1 || maxV * 0.01;
  const yDomain: [number, number] = [minV - pad, maxV + pad];

  return (
    <div className="pchart">
      <div className="pchart__header">
        <span className="pchart__title">
          <i className="fa-solid fa-chart-line" /> Evolució del portfolio
        </span>
        <div className="pchart__stats">
          <span className="pchart__current mono">{formatCurrency(last)}</span>
          <span className={`pchart__change pchart__change--${up ? "up" : "down"}`}>
            {up ? "+" : ""}{formatCurrency(diff)}
            <span className="pchart__change-pct">
              ({up ? "+" : ""}{pct.toFixed(2)}%)
            </span>
          </span>
          <span className="pchart__snapshots dim">
            {data.length} snapshots
          </span>
        </div>
      </div>

      <div className="pchart__canvas">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="pchart-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={color} stopOpacity={0.18} />
                <stop offset="95%" stopColor={color} stopOpacity={0}    />
              </linearGradient>
            </defs>
            <XAxis dataKey="time" tickFormatter={fmt}
              tick={{ fill: "#94a3b8", fontSize: 9 }} tickLine={false} axisLine={false}
              interval="preserveStartEnd" />
            <YAxis domain={yDomain} tickFormatter={v => formatCurrency(v as number)}
              tick={{ fill: "#94a3b8", fontSize: 9 }} tickLine={false} axisLine={false} width={76} />
            <Tooltip
              contentStyle={{ background: "#fff", border: "1px solid #e2e8f0",
                borderRadius: 8, fontSize: 11, boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}
              labelFormatter={v => fmt(v as number)}
              formatter={(v) => [formatCurrency(v as number), "Valor"]}
            />
            <ReferenceLine y={first} stroke="#94a3b8" strokeDasharray="3 3" strokeWidth={1}
              label={{ value: "inici", position: "right", fill: "#94a3b8", fontSize: 9 }} />
            <Area type="monotone" dataKey="value"
              stroke={color} strokeWidth={2}
              fill="url(#pchart-grad)" dot={false} activeDot={{ r: 4 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
