"use client";
import { useEffect, useState, useMemo } from "react";
import {
  ResponsiveContainer, ComposedChart, Area, Line,
  XAxis, YAxis, Tooltip, ReferenceLine,
} from "recharts";
import { formatCurrency } from "../lib/format";

interface Snapshot { time: number; value: number; }

export type Period = "24h" | "7d" | "30d" | "all";

/**
 * Detecta l'interval predominant entre snapshots (mediana dels primers gaps).
 * Ignora gaps < 1 min (duplicats) i > 4h (reinicis del servidor).
 */
function detectInterval(snaps: Snapshot[]): number {
  const diffs: number[] = [];
  for (let i = 1; i < snaps.length && diffs.length < 20; i++) {
    const d = snaps[i].time - snaps[i - 1].time;
    if (d >= 60_000 && d <= 4 * 3_600_000) diffs.push(d);
  }
  if (diffs.length === 0) return 15 * 60_000;
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)];
}

/**
 * Genera una sèrie temporal completa a intervalMs regulars entre el primer i
 * l'últim snapshot, omplint els buits amb el darrer valor disponible (forward-fill).
 */
function forwardFill(snaps: Snapshot[], intervalMs: number): Snapshot[] {
  if (snaps.length < 2) return snaps;
  const result: Snapshot[] = [];
  const end = snaps[snaps.length - 1].time;
  let si = 0;
  let lastVal = snaps[0].value;

  for (let t = snaps[0].time; t <= end; t += intervalMs) {
    // Avança l'índex mentre el snapshot seguent encara és <= t
    while (si + 1 < snaps.length && snaps[si + 1].time <= t) {
      si++;
      lastVal = snaps[si].value;
    }
    result.push({ time: t, value: lastVal });
  }
  return result;
}

const PERIOD_OPTIONS: { key: Period; label: string; ms: number | null }[] = [
  { key: "24h", label: "24h",  ms: 24  * 3_600_000 },
  { key: "7d",  label: "7d",   ms: 7   * 86_400_000 },
  { key: "30d", label: "30d",  ms: 30  * 86_400_000 },
  { key: "all", label: "Tot",  ms: null },
];

export default function PortfolioChart({ refreshTick, period, setPeriod, onStats }: {
  refreshTick: number;
  period: Period;
  setPeriod: (p: Period) => void;
  onStats?: (diff: number, pct: number) => void;
}) {
  const [allData, setAllData] = useState<Snapshot[]>([]);
  const [btcRaw,  setBtcRaw]  = useState<{ time: number; close: number }[]>([]);
  const [showBtc, setShowBtc] = useState(true);

  useEffect(() => {
    fetch("/api/portfolio-snapshot")
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setAllData(d); });
  }, [refreshTick]);

  const btcInterval = period === "24h" ? "15m" : period === "7d" ? "1h" : period === "30d" ? "4h" : "1d";
  const btcLimit    = period === "24h" ? 96    : period === "7d" ? 168 : period === "30d" ? 180 : 200;

  useEffect(() => {
    fetch(`/api/klines?pair=BTCUSDT&interval=${btcInterval}&limit=${btcLimit}`)
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setBtcRaw(d); });
  }, [btcInterval, btcLimit]);

  // Filtre de període
  const opt = PERIOD_OPTIONS.find(o => o.key === period)!;
  const data = opt.ms
    ? allData.filter(s => s.time >= Date.now() - opt.ms!)
    : allData;

  const fmt = (ts: number) => {
    const d   = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString())
      return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " "
      + d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  };

  const rawDisplay  = allData.length >= 2 ? (data.length >= 2 ? data : allData) : [];
  const intervalMs  = rawDisplay.length >= 2 ? detectInterval(rawDisplay) : 0;
  const displayData = rawDisplay.length >= 2 ? forwardFill(rawDisplay, intervalMs) : rawDisplay;
  const first  = displayData.length > 0 ? displayData[0].value : 0;
  const last   = displayData.length > 0 ? displayData[displayData.length - 1].value : 0;
  const diff   = last - first;
  const pct    = first > 0 ? (diff / first) * 100 : 0;

  // Normalize BTC to portfolio starting value so both fit the same Y-axis
  const mergedData = useMemo(() => {
    if (!showBtc || btcRaw.length < 2 || displayData.length < 2) return displayData;
    const btcFirst = btcRaw[0].close;
    return displayData.map(pt => {
      let btcClose = btcRaw[0].close;
      for (let i = 0; i < btcRaw.length; i++) {
        if (btcRaw[i].time <= pt.time) btcClose = btcRaw[i].close;
        else break;
      }
      return { ...pt, btc: first + (btcClose / btcFirst - 1) * first };
    });
  }, [displayData, btcRaw, showBtc, first]);

  const btcFirst = mergedData.length > 0 && "btc" in mergedData[0] ? ((mergedData[0] as unknown) as { btc: number }).btc : 0;
  const btcLast  = mergedData.length > 0 && "btc" in mergedData[mergedData.length - 1]
    ? ((mergedData[mergedData.length - 1] as unknown) as { btc: number }).btc : 0;
  const btcPct   = btcFirst > 0 ? ((btcLast - btcFirst) / btcFirst) * 100 : 0;

  // Notify parent when stats change — must be before any conditional return
  useEffect(() => { onStats?.(diff, pct); }, [diff, pct, onStats]);

  const periodBtns = (
    <div className="pchart__period-btns">
      {PERIOD_OPTIONS.map(o => (
        <button key={o.key}
          className={`portfolio__period-btn${period === o.key ? " portfolio__period-btn--active" : ""}`}
          onClick={() => setPeriod(o.key)}>
          {o.label}
        </button>
      ))}
      <button
        className={`portfolio__period-btn pchart__btc-toggle${showBtc ? " portfolio__period-btn--active" : ""}`}
        onClick={() => setShowBtc(v => !v)}
        title="BTC overlay">
        ₿
      </button>
    </div>
  );

  if (allData.length < 2) {
    return (
      <div className="pchart">
        <div className="pchart__header">
          <span className="pchart__title">
            <i className="fa-solid fa-chart-line" /> Evolució del portfolio
          </span>
          {periodBtns}
        </div>
        <div className="pchart__empty">
          <i className="fa-solid fa-hourglass-half" />
          Recollint dades… el gràfic s&apos;activarà quan hi hagi almenys 2 snapshots
          {allData.length === 1 && (
            <span className="pchart__empty-sub">
              1 snapshot registrat · pròxim en {15} min
            </span>
          )}
        </div>
      </div>
    );
  }

  const up     = diff >= 0;
  const color  = up ? "#059669" : "#dc2626";
  const prices = displayData.map(d => d.value);
  const minV   = Math.min(...prices);
  const maxV   = Math.max(...prices);
  const pad    = (maxV - minV) * 0.1 || maxV * 0.01;
  const yDomain: [number, number] = [minV - pad, maxV + pad];

  return (
    <div className="pchart">
      <div className="pchart__header">
        <span className="pchart__title">
          <i className="fa-solid fa-chart-line" /> Evolució del portfolio
        </span>
        {periodBtns}
        <div className="pchart__stats">
          <span className="pchart__current mono">{formatCurrency(last)}</span>
          <span className={`pchart__change pchart__change--${up ? "up" : "down"}`}>
            {up ? "+" : ""}{formatCurrency(diff)}
            <span className="pchart__change-pct">
              ({up ? "+" : ""}{pct.toFixed(2)}%)
            </span>
          </span>
          {showBtc && btcRaw.length >= 2 && (
            <span className={`pchart__btc-stat pchart__change--${btcPct >= 0 ? "up" : "down"}`}>
              ₿ {btcPct >= 0 ? "+" : ""}{btcPct.toFixed(2)}%
            </span>
          )}
          <span className="pchart__snapshots dim">
            {displayData.length} snapshots
          </span>
        </div>
      </div>

      <div className="pchart__canvas">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={mergedData} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
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
              formatter={(v, name) => {
                if (name === "btc") {
                  const btcPrice = btcRaw.length > 0 ? btcRaw[btcRaw.length - 1].close : 0;
                  // reverse-normalize to get actual BTC price at this point
                  const norm = v as number;
                  const scaledBtcPrice = first > 0 && btcRaw.length >= 2
                    ? btcRaw[0].close + ((norm - first) / first) * btcRaw[0].close
                    : btcPrice;
                  return [formatCurrency(scaledBtcPrice), "BTC"];
                }
                return [formatCurrency(v as number), "Portfolio"];
              }}
            />
            <ReferenceLine y={first} stroke="#94a3b8" strokeDasharray="3 3" strokeWidth={1}
              label={{ value: "inici", position: "right", fill: "#94a3b8", fontSize: 9 }} />
            <Area type="monotone" dataKey="value"
              stroke={color} strokeWidth={2}
              fill="url(#pchart-grad)" dot={false} activeDot={{ r: 4 }} />
            {showBtc && btcRaw.length >= 2 && (
              <Line type="monotone" dataKey="btc"
                stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 2"
                dot={false} activeDot={{ r: 3 }} connectNulls />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
