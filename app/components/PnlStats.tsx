"use client";
import { useEffect, useState } from "react";

type Pnl = { d1: number; d7: number; d30: number; d365: number };

function PnlItem({ label, value }: { label: string; value: number }) {
  const pos = value >= 0;
  return (
    <div className="topbar__stat">
      <span className="topbar__stat-label">{label}</span>
      <span className={`topbar__stat-value topbar__stat-change${pos ? " topbar__stat-change--up" : " topbar__stat-change--down"}`}>
        {pos ? "+" : ""}{value.toFixed(2)} USDC
      </span>
    </div>
  );
}

export default function PnlStats() {
  const [pnl, setPnl] = useState<Pnl | null>(null);

  useEffect(() => {
    fetch("/api/pnl")
      .then(r => r.json())
      .then(d => { if (!d.error) setPnl(d); })
      .catch(() => {});
  }, []);

  if (!pnl) return null;

  return (
    <>
      <div className="topbar__divider" />
      <div className="topbar__pnl-group">
        <span className="topbar__pnl-title">P&amp;L</span>
        <PnlItem label="24h"  value={pnl.d1}   />
        <PnlItem label="7d"   value={pnl.d7}   />
        <PnlItem label="1m"   value={pnl.d30}  />
        <PnlItem label="1a"   value={pnl.d365} />
      </div>
    </>
  );
}
