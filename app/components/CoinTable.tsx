"use client";
import { useState } from "react";
import { CoinRow } from "../lib/types";
import { formatCurrency } from "../lib/format";
import Sparkline from "./Sparkline";
import CoinIcon from "./CoinIcon";
import CoinModal from "./CoinModal";

function PctChange({ value }: { value: number }) {
  const positive = value >= 0;
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
        positive ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-500"
      }`}
    >
      {positive ? "+" : ""}
      {value.toFixed(2)}%
    </span>
  );
}

export default function CoinTable({ coins }: { coins: CoinRow[] }) {
  const [selected, setSelected] = useState<CoinRow | null>(null);

  return (
    <>
      <div className="overflow-x-auto rounded-2xl border border-slate-100 shadow-sm bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-slate-400 text-left border-b border-slate-100">
              <th className="px-5 py-3.5 font-medium text-xs uppercase tracking-wide">#</th>
              <th className="px-5 py-3.5 font-medium text-xs uppercase tracking-wide">Coin</th>
              <th className="px-5 py-3.5 font-medium text-xs uppercase tracking-wide text-right">Price</th>
              <th className="px-5 py-3.5 font-medium text-xs uppercase tracking-wide text-right">24h</th>
              <th className="px-5 py-3.5 font-medium text-xs uppercase tracking-wide text-right">High</th>
              <th className="px-5 py-3.5 font-medium text-xs uppercase tracking-wide text-right">Low</th>
              <th className="px-5 py-3.5 font-medium text-xs uppercase tracking-wide text-right">Volume</th>
              <th className="px-5 py-3.5 font-medium text-xs uppercase tracking-wide text-right">7d</th>
            </tr>
          </thead>
          <tbody>
            {coins.map((coin, i) => (
              <tr
                key={coin.pair}
                className="border-t border-slate-50 hover:bg-slate-50 transition-colors cursor-pointer"
                onClick={() => setSelected(coin)}
              >
                <td className="px-5 py-3.5 text-slate-400 text-xs">{i + 1}</td>
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-2.5">
                    <CoinIcon symbol={coin.symbol} />
                    <span className="font-semibold text-slate-800">{coin.symbol}</span>
                    <span className="text-slate-300 text-xs">USDC</span>
                  </div>
                </td>
                <td className="px-5 py-3.5 text-right font-mono font-medium text-slate-800">
                  {formatCurrency(coin.price)}
                </td>
                <td className="px-5 py-3.5 text-right">
                  <PctChange value={coin.change24h} />
                </td>
                <td className="px-5 py-3.5 text-right font-mono text-slate-500 text-xs">
                  {formatCurrency(coin.high24h)}
                </td>
                <td className="px-5 py-3.5 text-right font-mono text-slate-500 text-xs">
                  {formatCurrency(coin.low24h)}
                </td>
                <td className="px-5 py-3.5 text-right font-mono text-slate-500 text-xs">
                  {formatCurrency(coin.volumeUSDT)}
                </td>
                <td className="px-5 py-3.5 flex justify-end">
                  <Sparkline prices={coin.sparkline} positive={coin.change24h >= 0} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <CoinModal coin={selected} onClose={() => setSelected(null)} />
      )}
    </>
  );
}
