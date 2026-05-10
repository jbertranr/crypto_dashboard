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
  realLocked:      boolean;  // true = mode real en lectura, cap operació d'escriptura
  setRealLocked:   (v: boolean) => void;
}

const TradingModeContext = createContext<TradingModeContextValue>({
  viewMode:          "paper",
  setViewMode:       () => {},
  setViewModeSilent: () => {},
  realConfigured:    false,
  quoteAsset:        "USDT",
  realLocked:        true,
  setRealLocked:     () => {},
});

export function TradingModeProvider({ children }: { children: ReactNode }) {
  const [viewMode,       setViewModeState] = useState<ViewMode>("paper");
  const [realConfigured, setRealConfigured] = useState(false);
  const [quoteAsset,     setQuoteAsset]     = useState("USDT");
  const [realLocked, setRealLockedState] = useState<boolean>(true);

  const setRealLocked = (v: boolean) => {
    setRealLockedState(v);
    localStorage.setItem("realLocked", String(v));
  };

  useEffect(() => {
    const saved = localStorage.getItem("realLocked");
    if (saved !== null) setRealLockedState(saved === "true");
  }, []);

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
    <TradingModeContext.Provider value={{ viewMode, setViewMode, setViewModeSilent, realConfigured, quoteAsset, realLocked, setRealLocked }}>
      {children}
    </TradingModeContext.Provider>
  );
}

export function useTradingMode(): TradingModeContextValue {
  return useContext(TradingModeContext);
}
