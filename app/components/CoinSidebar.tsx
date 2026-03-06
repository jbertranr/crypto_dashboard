"use client";
import { useState } from "react";
import { CoinRow } from "../lib/types";
import { formatCurrency } from "../lib/format";
import CoinIcon from "./CoinIcon";
import CoinModal from "./CoinModal";
import NewOrderModal from "./NewOrderModal";
import Sparkline from "./Sparkline";

export default function CoinSidebar({ coins }: { coins: CoinRow[] }) {
  const [selected,    setSelected]    = useState<CoinRow | null>(null);
  const [tradeTarget, setTradeTarget] = useState<CoinRow | null>(null);

  return (
    <>
      {/* Horizontal strip — mobile only */}
      <div className="market-strip">
        {coins.map((coin) => {
          const up = coin.change24h >= 0;
          return (
            <button key={coin.pair} className="market-strip__item" onClick={() => setSelected(coin)}>
              <span className="market-strip__symbol">{coin.symbol}</span>
              <span className="market-strip__price">{formatCurrency(coin.price)}</span>
              <span className={`market-strip__pct ${up ? "market-strip__pct--up" : "market-strip__pct--down"}`}>
                {up ? "+" : ""}{coin.change24h.toFixed(2)}%
              </span>
            </button>
          );
        })}
      </div>

      <div className="market-panel">
        <div className="market-panel__head">
          <span className="market-panel__title">Markets</span>
          <span className="market-panel__badge">{coins.length} pairs</span>
        </div>

        <div className="market-panel__list">
          {coins.map((coin) => {
            const up = coin.change24h >= 0;
            const sparkUp = coin.sparkline.length >= 2
              ? coin.sparkline[coin.sparkline.length - 1] >= coin.sparkline[0]
              : up;
            return (
              <div key={coin.pair} className="coin-row" role="button" tabIndex={0}
                onClick={() => setSelected(coin)}
                onKeyDown={e => e.key === "Enter" && setSelected(coin)}>
                <div className="coin-row__top">
                  <CoinIcon symbol={coin.symbol} size={20} />
                  <span className="coin-row__name">{coin.symbol}</span>
                  <span className="coin-row__pair">USDT</span>
                  <span className={`coin-row__pct ${up ? "coin-row__pct--up" : "coin-row__pct--down"}`}>
                    {up ? "+" : ""}{coin.change24h.toFixed(2)}%
                  </span>
                </div>
                <div className="coin-row__bottom">
                  <span className="coin-row__price">{formatCurrency(coin.price)}</span>
                  <div className="coin-row__actions">
                    <Sparkline prices={coin.sparkline} positive={sparkUp} width={80} height={24} />
                    <button
                      className="coin-row__trade"
                      onClick={e => { e.stopPropagation(); setTradeTarget(coin); }}>
                      <i className="fa-solid fa-arrow-right-arrow-left" />
                      Trade
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {selected && <CoinModal coin={selected} onClose={() => setSelected(null)} />}

      {tradeTarget && (
        <NewOrderModal
          coin={tradeTarget}
          coins={coins}
          onClose={() => setTradeTarget(null)}
          onSuccess={() => setTradeTarget(null)}
        />
      )}
    </>
  );
}
