"use client";
import { useEffect, useState } from "react";
import {
  ResponsiveContainer, ComposedChart, Area,
  XAxis, YAxis, Tooltip, ReferenceLine, ReferenceArea,
} from "recharts";
import { formatCurrency } from "../lib/format";

interface Point { time: number; close: number; }

export default function ClosedOrderChart({
  symbol, startTime, endTime, tpPrice, slPrice, side,
}: {
  symbol: string;
  startTime: number;
  endTime: number;
  tpPrice: number | null;
  slPrice: number | null;
  side: "BUY" | "SELL";
}) {
  const [data,    setData]    = useState<Point[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/klines-range?symbol=${symbol}&startTime=${startTime}&endTime=${endTime}`)
      .then(r => r.json())
      .then((d: Point[] | { error: string }) => {
        if ("error" in d) throw new Error(d.error);
        setData(d);
      })
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [symbol, startTime, endTime]);

  const fmt = (ts: number) => {
    const d = new Date(ts);
    if (endTime - startTime < 24 * 3_600_000)
      return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  if (loading) return <div className="oco-chart__loading">Carregant…</div>;
  if (error)   return <div className="oco-chart__error">{error}</div>;
  if (!data.length) return <div className="oco-chart__loading">Sense dades per a aquest rang</div>;

  const prices = data.map(d => d.close);
  const refs   = [tpPrice ?? 0, slPrice ?? 0].filter(v => v > 0);
  const minP   = Math.min(...prices, ...refs);
  const maxP   = Math.max(...prices, ...refs);
  const range  = maxP - minP || minP * 0.01;
  const pad    = range * 0.08;
  const yDomain: [number, number] = [minP - pad, maxP + pad];

  const entryPoint = data.reduce((b, p) =>
    Math.abs(p.time - startTime) < Math.abs(b.time - startTime) ? p : b
  );
  const exitPoint = data.reduce((b, p) =>
    Math.abs(p.time - endTime) < Math.abs(b.time - endTime) ? p : b
  );

  const gradId = `coc-${symbol}-${startTime}`;
  const exitClose = data[data.length - 1]?.close ?? 0;
  const color = exitClose >= data[0]?.close ? "#059669" : "#dc2626";

  return (
    <div className="oco-chart">
      <div className="oco-chart__canvas">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 4, right: 56, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={color} stopOpacity={0.2} />
                <stop offset="95%" stopColor={color} stopOpacity={0}   />
              </linearGradient>
            </defs>
            <XAxis dataKey="time" tickFormatter={fmt}
              domain={["dataMin", "dataMax"]} type="number" scale="time"
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

            {tpPrice && slPrice && side === "SELL" && <>
              <ReferenceArea y1={tpPrice} y2={maxP + pad} fill="#059669" fillOpacity={0.08} />
              <ReferenceArea y1={minP - pad} y2={slPrice} fill="#dc2626" fillOpacity={0.08} />
            </>}
            {tpPrice && slPrice && side === "BUY" && <>
              <ReferenceArea y1={minP - pad} y2={tpPrice} fill="#059669" fillOpacity={0.08} />
              <ReferenceArea y1={slPrice} y2={maxP + pad} fill="#dc2626" fillOpacity={0.08} />
            </>}

            <ReferenceLine x={entryPoint.time} stroke="#f59e0b" strokeDasharray="4 3" strokeWidth={1.5}
              label={{ value: "Entrada", position: "insideTopRight", fill: "#f59e0b", fontSize: 9, fontWeight: 600 }} />
            <ReferenceLine x={exitPoint.time} stroke="#8b5cf6" strokeDasharray="4 3" strokeWidth={1.5}
              label={{ value: "Sortida", position: "insideTopLeft", fill: "#8b5cf6", fontSize: 9, fontWeight: 600 }} />

            {tpPrice != null && (
              <ReferenceLine y={tpPrice} stroke="#059669" strokeDasharray="5 3" strokeWidth={1.5}
                label={{ value: "TP", position: "right", fill: "#059669", fontSize: 10, fontWeight: 700 }} />
            )}
            {slPrice != null && (
              <ReferenceLine y={slPrice} stroke="#dc2626" strokeDasharray="5 3" strokeWidth={1.5}
                label={{ value: "SL", position: "right", fill: "#dc2626", fontSize: 10, fontWeight: 700 }} />
            )}

            <Area type="monotone" dataKey="close"
              stroke={color} strokeWidth={2}
              fill={`url(#${gradId})`} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
