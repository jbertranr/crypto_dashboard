"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import {
  ResponsiveContainer, ComposedChart, Area, Line,
  XAxis, YAxis, Tooltip, ReferenceLine, ReferenceArea,
} from "recharts";
import { formatCurrency } from "../lib/format";

interface Point { time: number; close: number; trailSl?: number; }
type TF = "1h" | "4h" | "1d" | "tot";

const TF_LABELS: Record<TF, string> = { "1h": "1h", "4h": "4h", "1d": "1D", "tot": "Tot" };

// How many candles to keep visible in the sliding window per TF.
// "tot" always shows all; for windowed TFs we pan the last N candles.
const VISIBLE_CANDLES: Record<TF, number> = {
  "1h": 70, "4h": 60, "1d": 72, "tot": Infinity,
};

const POLL_MS = 60_000; // soft-refresh interval

export default function OcoProgressChart({
  symbol, startTime, tpPrice, slPrice, side, onEntryPrice,
  tpLabel = "TP", slLabel = "SL", trailDist, trailEntryPrice,
}: {
  symbol: string;
  startTime: number;
  tpPrice: number;
  slPrice: number;
  side: "BUY" | "SELL";
  onEntryPrice?: (price: number) => void;
  tpLabel?: string;
  slLabel?: string;
  trailDist?: number;       // if set, renders the theoretical trailing SL history
  trailEntryPrice?: number; // initial peak / entry price for trailing computation
}) {
  const [data,       setData]       = useState<Point[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [panning,    setPanning]    = useState(false); // soft-refresh in progress
  const [error,      setError]      = useState<string | null>(null);
  const [tf,         setTf]         = useState<TF>("tot");
  const [showZones,  setShowZones]  = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback((soft = false) => {
    if (!soft) { setLoading(true); setError(null); }
    else setPanning(true);

    const qs = tf === "tot"
      ? `symbol=${symbol}&startTime=${startTime}`
      : `symbol=${symbol}&startTime=${startTime}&window=${tf}`;

    fetch(`/api/klines-range?${qs}`)
      .then(r => r.json())
      .then((d: Point[]) => {
        if (d && (d as unknown as { error: string }).error)
          throw new Error((d as unknown as { error: string }).error);
        setData(d);
        if (tf === "tot" && d.length > 0) {
          const closest = d.reduce((best, p) =>
            Math.abs(p.time - startTime) < Math.abs(best.time - startTime) ? p : best
          );
          onEntryPrice?.(closest.close);
        }
      })
      .catch(e => { if (!soft) setError((e as Error).message); })
      .finally(() => { setLoading(false); setPanning(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, startTime, tf]);

  // Initial + TF-change fetch
  useEffect(() => {
    fetchData(false);
  }, [fetchData]);

  // Polling: soft-refresh every POLL_MS, pan the chart to show new candle
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => fetchData(true), POLL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchData]);

  const fmt = (ts: number) => {
    const elapsed = Date.now() - ts;
    const H = 3_600_000;
    const d = new Date(ts);
    if (elapsed < 24 * H)
      return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  // Compute trailing SL history from price data when trailDist is provided
  const chartData: Point[] = (() => {
    if (!trailDist || !data.length) return data;
    let peak = trailEntryPrice && trailEntryPrice > 0 ? trailEntryPrice : data[0].close;
    return data.map(p => {
      if (side === "SELL") {
        if (p.close > peak) peak = p.close;
        return { ...p, trailSl: peak - trailDist };
      } else {
        if (p.close < peak) peak = p.close;
        return { ...p, trailSl: peak + trailDist };
      }
    });
  })();

  // Computed chart values (only when data is ready)
  const prices  = chartData.map(d => d.close);
  const trailSlPrices = trailDist ? chartData.map(d => d.trailSl ?? 0).filter(v => v > 0) : [];
  const minP    = data.length ? Math.min(...prices, slPrice, ...trailSlPrices)  : slPrice;
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

  // Sliding-window X-axis domain: clamp to last VISIBLE_CANDLES entries so
  // each soft-refresh naturally pans the chart to the right.
  const xDomain: [number | string, number | string] = (() => {
    const n = VISIBLE_CANDLES[tf];
    if (!isFinite(n) || chartData.length <= n) return ["dataMin", "dataMax"];
    const last  = chartData[chartData.length - 1].time;
    const first = chartData[chartData.length - n].time;
    return [first, last];
  })();

  // Entry moment marker: only meaningful in windowed views (in "tot" mode the chart starts AT startTime)
  const entryMarkerTime: number | null = (() => {
    if (tf === "tot" || data.length === 0) return null;
    if (startTime < data[0].time) return null; // entry is before current window
    const closest = data.reduce((best, p) =>
      Math.abs(p.time - startTime) < Math.abs(best.time - startTime) ? p : best
    );
    return closest.time;
  })();

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
        {(loading && data.length > 0 || panning) && (
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
            <ComposedChart data={chartData} margin={{ top: 4, right: 56, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={color} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={color} stopOpacity={0}   />
                </linearGradient>
              </defs>
              <XAxis dataKey="time" tickFormatter={fmt}
                domain={xDomain}
                type="number" scale="time"
                tick={{ fill: "#94a3b8", fontSize: 9 }} tickLine={false} axisLine={false}
                interval="preserveStartEnd" />
              <YAxis domain={yDomain} tickFormatter={v => formatCurrency(v)}
                tick={{ fill: "#94a3b8", fontSize: 9 }} tickLine={false} axisLine={false} width={68} />
              <Tooltip
                contentStyle={{ background: "#fff", border: "1px solid #e2e8f0",
                  borderRadius: 8, fontSize: 11, boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}
                labelFormatter={v => fmt(v as number)}
                formatter={(v, name) => [
                  v != null ? formatCurrency(v as number) : "",
                  name === "trailSl" ? "SL Trail" : "Preu",
                ]}
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

              {/* Entry moment — vertical line (windowed views only) */}
              {entryMarkerTime !== null && (
                <ReferenceLine x={entryMarkerTime} stroke="#f59e0b" strokeDasharray="4 3" strokeWidth={1.5}
                  label={{ value: "Entrada", position: "insideTopRight", fill: "#f59e0b", fontSize: 9, fontWeight: 600 }} />
              )}

              {/* Entry price — horizontal dashed line (Tot view) */}
              {tf === "tot" && entryP > 0 && (
                <ReferenceLine y={entryP} stroke="#94a3b8" strokeDasharray="3 3" strokeWidth={1}
                  label={{ value: "E", position: "right", fill: "#94a3b8", fontSize: 9 }} />
              )}

              {/* TP line */}
              <ReferenceLine y={tpPrice} stroke="#059669" strokeDasharray="5 3" strokeWidth={1.5}
                label={{ value: tpLabel, position: "right", fill: "#059669", fontSize: 10, fontWeight: 700 }} />
              {/* SL line */}
              <ReferenceLine y={slPrice} stroke="#dc2626" strokeDasharray="5 3" strokeWidth={1.5}
                label={{ value: slLabel, position: "right", fill: "#dc2626", fontSize: 10, fontWeight: 700 }} />

              <Area type="monotone" dataKey="close"
                stroke={color} strokeWidth={2}
                fill={`url(#${gradId})`} dot={false} />

              {/* Trailing SL history — computed from price peaks */}
              {trailDist && (
                <Line type="monotone" dataKey="trailSl"
                  stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 3"
                  dot={false} legendType="none" connectNulls />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
