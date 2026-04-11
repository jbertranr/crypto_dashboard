"use client";
import { createContext, useContext, useState, useEffect } from "react";
import type { ReactNode } from "react";

export type ViewMode = "paper" | "real";

interface TradingModeContextValue {
  viewMode:        ViewMode;
  setViewMode:     (m: ViewMode) => void;
  realConfigured:  boolean;
}

const TradingModeContext = createContext<TradingModeContextValue>({
  viewMode:       "paper",
  setViewMode:    () => {},
  realConfigured: false,
});

export function TradingModeProvider({ children }: { children: ReactNode }) {
  const [viewMode,       setViewModeState] = useState<ViewMode>("paper");
  const [realConfigured, setRealConfigured] = useState(false);

  useEffect(() => {
    // Restore mode from localStorage
    const stored = localStorage.getItem("trading_view_mode");
    if (stored === "real") setViewModeState("real");

    // Check if real API keys are configured
    fetch("/api/trading-mode")
      .then(r => r.json())
      .then((d: { realConfigured: boolean }) => {
        setRealConfigured(d.realConfigured);
        // Downgrade to paper if real was selected but keys are gone
        if (!d.realConfigured && stored === "real") setViewModeState("paper");
      })
      .catch(() => {});
  }, []);

  const setViewMode = (m: ViewMode) => {
    if (m === "real" && !realConfigured) {
      alert("Les claus de trading real (BINANCE_API_KEY_REAL / BINANCE_SECRET_KEY_REAL) no estan configurades al .env.local");
      return;
    }
    if (m === "real") {
      const ok = confirm(
        "⚠️  TRADING REAL\n\n" +
        "Passaràs a veure i operar amb el teu compte REAL de Binance.\n" +
        "Totes les ordres noves afectaran diners reals.\n\n" +
        "Continuar?"
      );
      if (!ok) return;
    }
    setViewModeState(m);
    localStorage.setItem("trading_view_mode", m);
  };

  return (
    <TradingModeContext.Provider value={{ viewMode, setViewMode, realConfigured }}>
      {children}
    </TradingModeContext.Provider>
  );
}

export function useTradingMode(): TradingModeContextValue {
  return useContext(TradingModeContext);
}
