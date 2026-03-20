"use client";
import { useEffect, useState } from "react";

type TickerItem = { label: string; value: string; up?: boolean; down?: boolean };

function buildMarketItems(btc: number, vol: number, gainerSym: string, gainerPct: number, loserSym: string, loserPct: number): TickerItem[] {
  const fmt = (n: number) => n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(0)}M` : `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return [
    { label: "BTC",     value: fmt(btc) },
    { label: "Vol 24h", value: fmt(vol) },
    { label: "Gainer",  value: `${gainerSym}  +${gainerPct.toFixed(2)}%`, up: true },
    { label: "Loser",   value: `${loserSym}  ${loserPct.toFixed(2)}%`,    down: true },
  ];
}

function buildPnlItems(d1: number, d7: number, d30: number, d365: number): TickerItem[] {
  const fmt = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)} USDT`;
  return [
    { label: "P&L 24h", value: fmt(d1),   up: d1   >= 0, down: d1   < 0 },
    { label: "P&L 7d",  value: fmt(d7),   up: d7   >= 0, down: d7   < 0 },
    { label: "P&L 1m",  value: fmt(d30),  up: d30  >= 0, down: d30  < 0 },
    { label: "P&L 1a",  value: fmt(d365), up: d365 >= 0, down: d365 < 0 },
  ];
}

export default function TopbarTicker({ btcPrice, totalVol, gainerSym, gainerPct, loserSym, loserPct }: {
  btcPrice: number; totalVol: number;
  gainerSym: string; gainerPct: number;
  loserSym: string;  loserPct: number;
}) {
  const [pnlItems, setPnlItems] = useState<TickerItem[]>([]);

  useEffect(() => {
    fetch("/api/pnl")
      .then(r => r.json())
      .then(d => { if (!d.error) setPnlItems(buildPnlItems(d.d1, d.d7, d.d30, d.d365)); })
      .catch(err => console.warn("[TopbarTicker] pnl:", (err as Error).message));
  }, []);

  const marketItems = buildMarketItems(btcPrice, totalVol, gainerSym, gainerPct, loserSym, loserPct);
  const items: TickerItem[] = [...marketItems, ...pnlItems];

  // Duplicate for seamless loop
  const track = [...items, ...items];

  return (
    <div className="ticker">
      <div className="ticker__track" style={{ animationDuration: `${Math.max(20, track.length * 3)}s` }}>
        {track.map((item, i) => (
          <span key={i} className="ticker__item">
            <span className="ticker__label">{item.label}</span>
            <span className={`ticker__value${item.up ? " ticker__value--up" : item.down ? " ticker__value--down" : ""}`}>
              {item.value}
            </span>
            <span className="ticker__sep">·</span>
          </span>
        ))}
      </div>
    </div>
  );
}
