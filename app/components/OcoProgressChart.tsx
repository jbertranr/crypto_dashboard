"use client";
import { useEffect, useState } from "react";
import {
  ResponsiveContainer, AreaChart, Area,
  XAxis, YAxis, Tooltip, ReferenceLine, ReferenceArea,
} from "recharts";
import { formatCurrency } from "../lib/format";

interface Point { time: number; close: number; }
type TF = "1h" | "4h" | "1d" | "tot";

const TF_LABELS: Record<TF, string> = { "1h": "1h", "4h": "4h", "1d": "1D", "tot": "Tot" };

export default function OcoProgressChart({
  symbol, startTime, tpPrice, slPrice, side, onEntryPrice,
}: {
  symbol: string;
  startTime: number;
  tpPrice: number;
  slPrice: number;
  side: "BUY" | "SELL";
  onEntryPrice?: (price: number) => void;
}) {
  const [data,      setData]      = useState<Point[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [tf,        setTf]        = useState<TF>("tot");
  const [showZones, setShowZones] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    const qs = tf === "tot"
      ? `symbol=${symbol}&startTime=${startTime}`
      : `symbol=${symbol}&startTime=${startTime}&window=${tf}`;
    fetch(`/api/klines-range?${qs}`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        if (d.error) throw new Error(d.error);
        setData(d);
        if (d.length > 0) onEntryPrice?.(d[0].close);
      })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [symbol, startTime, tf]); // eslint-disable-line react-hooks/exhaustive-deps

  const fmt = (ts: number) => {
    const elapsed = Date.now() - ts;
    const H = 3_600_000;
    const d = new Date(ts);
    if (elapsed < 24 * H)
      return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  // Computed chart values (only when data is ready)
  const prices  = data.map(d => d.close);
  const minP    = data.length ? Math.min(...prices, slPrice)  : slPrice;
  const maxP    = data.length ? Math.max(...prices, tpPrice)  : tpPrice;
  const range   = maxP - minP || minP * 0.01;
  const pad     = range * 0.08;
  const yDomain: [number, number] = [minP - pad, maxP + pad];
  const current = data.length ? data[data.length - 1].close : 0;
  const entryP  = data.length ? data[0].close : 0;
  const pnlPct  = entryP ? ((current - entryP) / entryP) * 100 : 0;
  const pnlUp   = pnlPct >= 0;
  const color   = pnlUp ? "#059669" : "#dc2626";
  const gradId  = `og-${symbol}-${startTime}`;

  return (
    <div className="oco-chart">
      {/* Toolbar */}
      <div className="oco-chart__toolbar">
        <div className="oco-chart__tfs">
          {(["1h", "4h", "1d", "tot"] as TF[]).map(t => (
            <button key={t}
              className={`oco-chart__tf${tf === t ? " oco-chart__tf--active" : ""}`}
              onClick={() => setTf(t)}>
              {TF_LABELS[t]}
            </button>
          ))}
        </div>
        <button
          className={`oco-chart__zone-toggle${showZones ? " oco-chart__zone-toggle--on" : ""}`}
          onClick={() => setShowZones(z => !z)}>
          <i className="fa-solid fa-layer-group" />
          <span className="oco-chart__zone-label">Zones TP/SL</span>
        </button>
        {loading && data.length > 0 && (
          <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: "0.7rem", color: "var(--text-3)", marginLeft: 4 }} />
        )}
      </div>

      {/* Canvas */}
      {error ? (
        <div className="oco-chart__error">{error}</div>
      ) : loading && !data.length ? (
        <div className="oco-chart__loading">Carregant…</div>
      ) : !data.length ? (
        <div className="oco-chart__loading">Sense dades per a aquest rang</div>
      ) : (
        <div className="oco-chart__canvas">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 56, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={color} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={color} stopOpacity={0}   />
                </linearGradient>
              </defs>
              <XAxis dataKey="time" tickFormatter={fmt}
                tick={{ fill: "#94a3b8", fontSize: 9 }} tickLine={false} axisLine={false}
                interval="preserveStartEnd" />
              <YAxis domain={yDomain} tickFormatter={v => formatCurrency(v)}
                tick={{ fill: "#94a3b8", fontSize: 9 }} tickLine={false} axisLine={false} width={68} />
              <Tooltip
                contentStyle={{ background: "#fff", border: "1px solid #e2e8f0",
                  borderRadius: 8, fontSize: 11, boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}
                labelFormatter={v => fmt(v as number)}
                formatter={(v) => [v != null ? formatCurrency(v as number) : "", "Preu"]}
              />

              {/* TP/SL zones */}
              {showZones && side === "SELL" && <>
                <ReferenceArea y1={tpPrice} y2={maxP + pad} fill="#059669" fillOpacity={0.10} />
                <ReferenceArea y1={minP - pad} y2={slPrice} fill="#dc2626" fillOpacity={0.10} />
              </>}
              {showZones && side === "BUY" && <>
                <ReferenceArea y1={minP - pad} y2={tpPrice} fill="#059669" fillOpacity={0.10} />
                <ReferenceArea y1={slPrice} y2={maxP + pad} fill="#dc2626" fillOpacity={0.10} />
              </>}

              {/* Entry reference (only in "Tot" view) */}
              {tf === "tot" && entryP > 0 && (
                <ReferenceLine y={entryP} stroke="#94a3b8" strokeDasharray="3 3" strokeWidth={1}
                  label={{ value: "E", position: "right", fill: "#94a3b8", fontSize: 9 }} />
              )}

              {/* TP line */}
              <ReferenceLine y={tpPrice} stroke="#059669" strokeDasharray="5 3" strokeWidth={1.5}
                label={{ value: "TP", position: "right", fill: "#059669", fontSize: 10, fontWeight: 700 }} />
              {/* SL line */}
              <ReferenceLine y={slPrice} stroke="#dc2626" strokeDasharray="5 3" strokeWidth={1.5}
                label={{ value: "SL", position: "right", fill: "#dc2626", fontSize: 10, fontWeight: 700 }} />

              <Area type="monotone" dataKey="close"
                stroke={color} strokeWidth={2}
                fill={`url(#${gradId})`} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
