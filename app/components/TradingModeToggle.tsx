"use client";
import { useTradingMode } from "../contexts/TradingModeContext";

export default function TradingModeToggle() {
  const { viewMode, setViewMode, realConfigured } = useTradingMode();

  return (
    <div className="topbar__mode-toggle">
      <button
        className={`topbar__mode-btn${viewMode === "paper" ? " topbar__mode-btn--active" : ""}`}
        onClick={() => setViewMode("paper")}
        title="Paper trading (Binance Testnet)"
      >
        PAPER
      </button>
      <button
        className={`topbar__mode-btn topbar__mode-btn--real${viewMode === "real" ? " topbar__mode-btn--active" : ""}${!realConfigured ? " topbar__mode-btn--disabled" : ""}`}
        onClick={() => setViewMode("real")}
        title={!realConfigured ? "Claus de trading real no configurades (.env.local)" : "Trading real (Binance Mainnet)"}
      >
        REAL
      </button>
    </div>
  );
}
