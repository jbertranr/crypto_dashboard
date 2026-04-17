"use client";
import { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { ReactNode } from "react";

export type ViewMode = "paper" | "real";

interface TradingModeContextValue {
  viewMode:        ViewMode;
  setViewMode:     (m: ViewMode) => void;  // amb confirmació (per toggle manual)
  setViewModeSilent: (m: ViewMode) => void; // sense confirmació (per sincronització de tab)
  realConfigured:  boolean;
  quoteAsset:      string;
}

const TradingModeContext = createContext<TradingModeContextValue>({
  viewMode:          "paper",
  setViewMode:       () => {},
  setViewModeSilent: () => {},
  realConfigured:    false,
  quoteAsset:        "USDT",
});

export function TradingModeProvider({ children }: { children: ReactNode }) {
  const [viewMode,       setViewModeState] = useState<ViewMode>("paper");
  const [realConfigured, setRealConfigured] = useState(false);
  const [quoteAsset,     setQuoteAsset]     = useState("USDT");

  useEffect(() => {
    fetch("/api/trading-mode")
      .then(r => r.json())
      .then((d: { realConfigured: boolean; quoteAsset?: string }) => {
        setRealConfigured(d.realConfigured);
        if (d.quoteAsset) setQuoteAsset(d.quoteAsset);
      })
      .catch(() => {});
  }, []);

  // Amb confirmació — per canvi manual de l'usuari (toggle)
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
  };

  // Sense confirmació — per sincronització automàtica quan canvia la tab activa
  const setViewModeSilent = useCallback((m: ViewMode) => {
    if (m === "real" && !realConfigured) return; // no canviem si no hi ha claus
    setViewModeState(m);
  }, [realConfigured]);

  return (
    <TradingModeContext.Provider value={{ viewMode, setViewMode, setViewModeSilent, realConfigured, quoteAsset }}>
      {children}
    </TradingModeContext.Provider>
  );
}

export function useTradingMode(): TradingModeContextValue {
  return useContext(TradingModeContext);
}
