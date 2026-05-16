"use client";
import { useEffect, useState, useCallback } from "react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { CoinRow } from "../lib/types";
import { formatCurrency } from "../lib/format";
import CoinIcon from "./CoinIcon";
import { useTradingMode } from "../contexts/TradingModeContext";

type StratProposal = {
  name: string; type: "bullish" | "bearish" | "neutral";
  confidence: "alta" | "moderada" | "baixa"; active: boolean;
  tp: number; sl: number; slLimit: number;
  trailing: { activateAt: number; distance: number; activateAtr: number; distanceAtr: number; logic: string };
};
type AnalysisSnap = { price: number; atr: number; strategies: StratProposal[] };

type BotPreset = {
  id: string; code: string; name: string; enabled: boolean;
  budgetUsdc?: number;
  simConfig: { config: {
    interval?: string; tpAtr?: number; slAtr?: number;
    trailActivateAtr?: number; trailDistanceAtr?: number;
    breakEvenAtr?: number; maxOpen?: number;
    symbols?: string[];
  } } | null;
};

/* ── precision helpers ── */
function stepDp(step: string) {
  const i = step.indexOf(".");
  return i === -1 ? 0 : step.length - i - 1;
}

function roundDown(value: number, step: string): string {
  const s = parseFloat(step);
  const dp = stepDp(step);
  return (Math.floor(value / s) * s).toFixed(dp);
}

function roundNearest(value: number, tick: string): string {
  const s = parseFloat(tick);
  const dp = stepDp(tick);
  return (Math.round(value / s) * s).toFixed(dp);
}

function pctOf(price: number, ref: number) {
  return isNaN(price) || !ref ? "" : (((price - ref) / ref) * 100).toFixed(2);
}
function fromPct(pct: number, ref: number, tick: string) {
  return isNaN(pct) || !ref ? "" : roundNearest(ref * (1 + pct / 100), tick);
}

/* ── sell/buy direction check ── */
function directionOk(side: "BUY" | "SELL", tpP: number, slP: number, ref: number) {
  if (!ref || !tpP || !slP) return true;
  return side === "SELL"
    ? tpP > ref && slP < ref   // TP above, SL below
    : tpP < ref && slP > ref;  // TP below, SL above
}

export default function NewOrderModal({ coin, coins, onClose, onSuccess, presetPrices }: {
  coin: CoinRow | null;
  coins: CoinRow[];
  onClose: () => void;
  onSuccess: () => void;
  presetPrices?: { side: "BUY" | "SELL"; tp: string; sl: string; slLimit: string; interval?: "5m" | "1h" | "4h" };
}) {
  const { viewMode, quoteAsset, realLocked } = useTradingMode();
  const isRealLocked = realLocked && viewMode === "real";

  const defaultCoin = coin ?? coins[0];
  const [selectedPair,   setSelectedPair]   = useState(defaultCoin?.pair ?? "");
  const [customPair,     setCustomPair]      = useState("");
  const [customPrice,    setCustomPrice]     = useState<number>(0);
  const [loadingPrice,   setLoadingPrice]    = useState(false);
  const [allSymbols,     setAllSymbols]      = useState<{ symbol: string; base: string; quote: string }[]>([]);
  const [symbolSearch,   setSymbolSearch]    = useState("");
  const [showSymbolList, setShowSymbolList]  = useState(false);
  const isCustom = selectedPair === "__custom__";
  const activeCoin = coins.find(c => c.pair === selectedPair) ?? defaultCoin;
  const effectivePair = isCustom ? customPair.toUpperCase().trim() : selectedPair;
  const ref = isCustom ? customPrice : (activeCoin?.price ?? 0);

  // Quote asset efectiu: per parells personalitzats, detectar-lo del símbol
  const KNOWN_QUOTES = ["USDT","USDC","BUSD","FDUSD","TUSD","BTC","ETH","BNB"];
  const pairQuoteAsset: string = isCustom && effectivePair.length >= 5
    ? (KNOWN_QUOTES.find(q => effectivePair.endsWith(q)) ?? quoteAsset)
    : quoteAsset;
  // Base asset del parell personalitzat
  const pairBaseAsset: string = isCustom && effectivePair.length >= 5
    ? effectivePair.slice(0, effectivePair.length - pairQuoteAsset.length)
    : (activeCoin?.symbol ?? "");

  /* mode toggle */
  const [mode, setMode] = useState<"oco" | "buy-exit">("buy-exit");

  /* buy-exit form state */
  const [beUsdAmount,  setBeUsdAmount]  = useState("");
  const [beTpPct,      setBeTpPct]      = useState("3.00");
  const [beSlPct,      setBeSlPct]      = useState("3.00");

  /* analysis (OCO mode) */
  const [analysisInterval,  setAnalysisInterval]  = useState<string>(presetPrices?.interval ?? "1h");
  const [analysisSnap,      setAnalysisSnap]      = useState<AnalysisSnap | null>(null);
  const [analysisLoading,   setAnalysisLoading]   = useState(false);
  const [selectedStratIdx,  setSelectedStratIdx]  = useState(0);

  /* exchange filters */
  const [stepSize, setStepSize] = useState("0.00001");
  const [tickSize, setTickSize] = useState("0.01");

  /* balances */
  const [balances, setBalances] = useState<Record<string, number>>({});
  useEffect(() => {
    fetch("/api/balance").then(r => r.json()).then((arr: { asset: string; free: string }[]) => {
      if (!Array.isArray(arr)) return;
      const m: Record<string, number> = {};
      arr.forEach(b => { m[b.asset] = parseFloat(b.free); });
      setBalances(m);
    }).catch(() => {});
  }, []);

  /* bot presets */
  const [bots,             setBots]             = useState<BotPreset[]>([]);
  const [selectedBotId,    setSelectedBotId]    = useState<string | null>(null);
  const [botOpenOrders,    setBotOpenOrders]    = useState<{ symbol: string; value: number }[]>([]);
  const [botPositionCount, setBotPositionCount] = useState(0);
  useEffect(() => {
    fetch("/api/bots").then(r => r.json())
      .then((d: { bots: BotPreset[] }) => setBots(d.bots ?? []))
      .catch(() => {});
  }, []);

  const selectedBot = bots.find(b => b.id === selectedBotId) ?? null;

  // Quan canvia el bot seleccionat, carrega les ordres obertes atribuïdes al bot
  useEffect(() => {
    if (!selectedBot) { setBotOpenOrders([]); setBotPositionCount(0); return; }
    fetch(`/api/orders?mode=${viewMode}`).then(r => r.json())
      .then((d: { symbol: string; botName?: string | null; origQty: string; price: string; stopPrice: string; orderListId?: number }[]) => {
        const allOrders = (Array.isArray(d) ? d : []).filter(o => o.botName === selectedBot.name);
        // Deduplicar OCOs: cada llista té 2 ordres (TP + SL), comptem només la primera per orderListId
        const seenOco = new Set<number>();
        const orders = allOrders.filter(o => {
          if (o.orderListId != null && o.orderListId !== -1) {
            if (seenOco.has(o.orderListId)) return false;
            seenOco.add(o.orderListId);
          }
          return true;
        });
        setBotPositionCount(orders.length);
        const bySymbol = new Map<string, number>();
        for (const o of orders) {
          const price = parseFloat(o.price) || parseFloat(o.stopPrice) || 0;
          const value = parseFloat(o.origQty) * price;
          bySymbol.set(o.symbol, (bySymbol.get(o.symbol) ?? 0) + value);
        }
        setBotOpenOrders([...bySymbol.entries()].map(([symbol, value]) => ({ symbol, value })));
      }).catch(() => {});
  }, [selectedBot, viewMode]);

  const botCommitted = botOpenOrders.reduce((s, o) => s + o.value, 0);
  const newAmount    = parseFloat(beUsdAmount) || 0;

  // Màxim de posicions simultànies
  const botMaxOpen = selectedBot?.simConfig?.config?.maxOpen ?? null;
  const isMaxOpenReached = botMaxOpen !== null && botPositionCount >= botMaxOpen;

  // Pressupost: l'import únic supera el budget del bot
  const isBudgetExceeded  = !!(selectedBot?.budgetUsdc != null && newAmount > selectedBot.budgetUsdc);
  // Pressupost total: (compromisos actuals + nou import) supera el budget
  const isTotalExceeded   = !!(selectedBot?.budgetUsdc != null && (botCommitted + newAmount) > selectedBot.budgetUsdc);
  // Símbol fora del bot: el parells de la compra no és cap dels símbols del bot
  const QSTRIP = /USDT$|USDC$|BUSD$|FDUSD$|TUSD$/;
  const botSymbols = selectedBot?.simConfig?.config?.symbols ?? [];
  const botBaseAssets = botSymbols.map(s => s.replace(QSTRIP, ""));
  const currentBase   = effectivePair.replace(QSTRIP, "");
  const isSymbolMismatch = botSymbols.length > 0 && !botBaseAssets.includes(currentBase);

  // Confirmacions explícites de l'usuari per casos d'advertiment
  const [confirmedTotalBudget, setConfirmedTotalBudget] = useState(false);
  const [confirmedSymbol,      setConfirmedSymbol]      = useState(false);

  // Reset confirmacions quan canvia bot, import o símbol
  useEffect(() => { setConfirmedTotalBudget(false); }, [selectedBotId, beUsdAmount]);
  useEffect(() => { setConfirmedSymbol(false);      }, [selectedBotId, effectivePair]);

  const selectBot = useCallback((botId: string | null) => {
    setSelectedBotId(botId);
    if (!botId) return;
    const bot = bots.find(b => b.id === botId);
    const iv = bot?.simConfig?.config?.interval;
    if (iv) setAnalysisInterval(iv);
   
  }, [bots]);

  /* form state */
  const [side,         setSide]         = useState<"BUY" | "SELL">("SELL");
  const [qtyMode,      setQtyMode]      = useState<"usd" | "crypto">("usd");
  const [usdAmount,    setUsdAmount]    = useState("");
  const [cryptoQty,    setCryptoQty]    = useState("");
  const [tpPrice,      setTpPrice]      = useState(presetPrices?.tp ?? "");
  const [tpPct,        setTpPct]        = useState(presetPrices?.tp ? pctOf(parseFloat(presetPrices.tp), ref) : "");
  const [slStopPrice,  setSlStopPrice]  = useState(presetPrices?.sl ?? "");
  const [slStopPct,    setSlStopPct]    = useState(presetPrices?.sl ? pctOf(parseFloat(presetPrices.sl), ref) : "");
  const [slLimitPrice, setSlLimitPrice] = useState(presetPrices?.slLimit ?? "");
  const [slLimitPct,   setSlLimitPct]   = useState(presetPrices?.slLimit ? pctOf(parseFloat(presetPrices.slLimit), ref) : "");
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState<string | null>(null);

  /* trailing stop */
  const [trailingOn,           setTrailingOn]           = useState(true);
  const [trailingActivateAt,   setTrailingActivateAt]   = useState("");
  const [trailingDistance,     setTrailingDistance]     = useState("");
  const [trailingActivateAtr,  setTrailingActivateAtr]  = useState(1.0);
  const [trailingDistanceAtr,  setTrailingDistanceAtr]  = useState(1.5);
  const [trailingBreakEvenAtr, setTrailingBreakEvenAtr] = useState(0);
  const [trailingAtr,          setTrailingAtr]          = useState(0);
  const [trailingLogic,        setTrailingLogic]        = useState("");
  const [trailingLoading,      setTrailingLoading]      = useState(false);

  /* fetch exchange filters when pair changes */
  useEffect(() => {
    if (!effectivePair) return;
    fetch(`/api/exchange-info?symbol=${effectivePair}`)
      .then(r => r.json())
      .then(d => { if (d.stepSize) setStepSize(d.stepSize); if (d.tickSize) setTickSize(d.tickSize); })
      .catch(() => {});
  }, [effectivePair]);

  /* fetch all symbols when custom mode is opened */
  useEffect(() => {
    if (!isCustom || allSymbols.length > 0) return;
    fetch("/api/exchange-info/symbols")
      .then(r => r.json())
      .then((d: { symbols: { symbol: string; base: string; quote: string }[] }) => {
        if (Array.isArray(d.symbols)) setAllSymbols(d.symbols);
      })
      .catch(() => {});
  }, [isCustom, allSymbols.length]);

  /* filtered symbols for autocomplete */
  const filteredSymbols = symbolSearch.length >= 2
    ? allSymbols.filter(s =>
        s.symbol.includes(symbolSearch.toUpperCase()) ||
        s.base.includes(symbolSearch.toUpperCase()) ||
        s.quote.includes(symbolSearch.toUpperCase())
      ).slice(0, 50)
    : [];

  /* fetch price for custom pairs */
  useEffect(() => {
    if (!isCustom || !customPair || customPair.length < 5) return;
    const sym = customPair.toUpperCase().trim();
    setLoadingPrice(true);
    fetch(`/api/market-price?symbol=${sym}`)
      .then(r => r.json())
      .then((d: { price?: number }) => { if (d.price) setCustomPrice(d.price); })
      .catch(() => {})
      .finally(() => setLoadingPrice(false));
  }, [isCustom, customPair]);

  /* apply a strategy proposal to buy-exit % fields */
  const applyStrategyToBuyExit = useCallback((s: StratProposal, price: number, atr: number) => {
    if (s.type === "bearish" || price <= 0) return;
    const tpPct = (s.tp - price) / price * 100;
    const slPct = (price - s.sl) / price * 100;
    setBeTpPct(Math.max(0.01, tpPct).toFixed(2));
    setBeSlPct(Math.max(0.01, slPct).toFixed(2));
    const prec = price >= 100 ? 2 : price >= 1 ? 4 : 6;
    setTrailingAtr(atr);
    setTrailingActivateAt(s.trailing.activateAt.toFixed(prec));
    setTrailingDistance(s.trailing.distance.toFixed(prec));
    setTrailingActivateAtr(s.trailing.activateAtr);
    setTrailingDistanceAtr(s.trailing.distanceAtr);
    setTrailingLogic(s.trailing.logic);
  }, []);

  /* apply a strategy proposal to all OCO fields */
  const applyStrategy = useCallback((s: StratProposal, price: number, atr: number, tick: string) => {
    setTpPrice(roundNearest(s.tp, tick));
    setTpPct(pctOf(s.tp, price));
    setSlStopPrice(roundNearest(s.sl, tick));
    setSlStopPct(pctOf(s.sl, price));
    const sll = roundNearest(s.slLimit, tick);
    setSlLimitPrice(sll); setSlLimitPct(pctOf(parseFloat(sll), price));
    const prec = price >= 100 ? 2 : price >= 1 ? 4 : 6;
    setTrailingAtr(atr);
    setTrailingActivateAt(s.trailing.activateAt.toFixed(prec));
    setTrailingDistance(s.trailing.distance.toFixed(prec));
    setTrailingActivateAtr(s.trailing.activateAtr);
    setTrailingDistanceAtr(s.trailing.distanceAtr);
    setTrailingLogic(s.trailing.logic);
  }, []);

  /* pre-fill prices */
  const prefill = useCallback((refPrice: number, newSide: "BUY" | "SELL", tick: string) => {
    if (!refPrice || !tick) return;
    // SELL: TP above (+3%), SL below (-3%)
    // BUY:  TP below (-3%), SL above (+3%)
    const tpMult  = newSide === "SELL" ? 1.03  : 0.97;
    const slMult  = newSide === "SELL" ? 0.97  : 1.03;
    const sllMult = newSide === "SELL" ? 0.969 : 1.031;
    const tpP  = roundNearest(refPrice * tpMult,  tick);
    const slP  = roundNearest(refPrice * slMult,  tick);
    const sllP = roundNearest(refPrice * sllMult, tick);
    setTpPrice(tpP);       setTpPct(pctOf(parseFloat(tpP),  refPrice));
    setSlStopPrice(slP);   setSlStopPct(pctOf(parseFloat(slP),  refPrice));
    setSlLimitPrice(sllP); setSlLimitPct(pctOf(parseFloat(sllP), refPrice));
  }, []);

  useEffect(() => {
    if (!presetPrices && !analysisSnap) prefill(ref, side, tickSize);
    const ua = parseFloat(usdAmount);
    if (!isNaN(ua) && ref) setCryptoQty(roundDown(ua / ref, stepSize));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectivePair, side, tickSize]);

  /* quantity handlers */
  const onUsd = (v: string) => {
    setUsdAmount(v);
    const val = parseFloat(v);
    if (!isNaN(val) && ref) setCryptoQty(roundDown(val / ref, stepSize));
  };
  const onCrypto = (v: string) => {
    setCryptoQty(v);
    const val = parseFloat(v);
    if (!isNaN(val) && ref) setUsdAmount((val * ref).toFixed(2));
  };

  /* TP handlers */
  const onTpPrice = (v: string) => { setTpPrice(v); setTpPct(pctOf(parseFloat(v), ref)); };
  const onTpPct   = (v: string) => {
    setTpPct(v);
    const p = fromPct(parseFloat(v), ref, tickSize);
    setTpPrice(p);
  };

  /* SL stop handlers — auto-adjusts SL limit */
  const autoSlLimit = useCallback((stopP: number, tick: string, newSide: "BUY" | "SELL", refP: number) => {
    const lim = roundNearest(newSide === "SELL" ? stopP * 0.999 : stopP * 1.001, tick);
    setSlLimitPrice(lim); setSlLimitPct(pctOf(parseFloat(lim), refP));
  }, []);

  const onSlStopPrice = (v: string) => {
    setSlStopPrice(v);
    const val = parseFloat(v);
    if (ref) { setSlStopPct(pctOf(val, ref)); autoSlLimit(val, tickSize, side, ref); }
  };
  const onSlStopPct = (v: string) => {
    setSlStopPct(v);
    const p = fromPct(parseFloat(v), ref, tickSize);
    setSlStopPrice(p);
    autoSlLimit(parseFloat(p), tickSize, side, ref);
  };

  /* SL limit handlers */
  const onSlLimitPrice = (v: string) => { setSlLimitPrice(v); setSlLimitPct(pctOf(parseFloat(v), ref)); };
  const onSlLimitPct   = (v: string) => {
    setSlLimitPct(v);
    setSlLimitPrice(fromPct(parseFloat(v), ref, tickSize));
  };

  /* trailing stop suggestion */
  const suggestTrailing = useCallback(async (currentSide: "BUY" | "SELL", currentRef: number, pair: string) => {
    if (!currentRef || !pair) return;
    setTrailingLoading(true);
    try {
      const res  = await fetch(`/api/analysis?symbol=${pair}&interval=1h`);
      const d    = await res.json() as { atr?: number; price?: number };
      const atr  = d.atr ?? 0;
      const entry = currentRef || (d.price ?? currentRef);
      if (atr <= 0) return;
      const prec = entry >= 100 ? 2 : entry >= 1 ? 4 : 6;
      const actMult = 2.0, distMult = 1.5;
      const activateAt = currentSide === "SELL" ? entry + actMult * atr : entry - actMult * atr;
      const distance   = atr * distMult;
      const atrFmt = atr >= 100 ? atr.toFixed(2) : atr >= 1 ? atr.toFixed(4) : atr.toFixed(6);
      const extrm = currentSide === "SELL" ? "màxim" : "mínim";
      setTrailingAtr(atr);
      setTrailingActivateAt(activateAt.toFixed(prec));
      setTrailingDistance(distance.toFixed(prec));
      setTrailingActivateAtr(actMult);
      setTrailingDistanceAtr(distMult);
      setTrailingLogic(`S'activa quan el preu supera ${actMult}×ATR (≈${atrFmt}) per sobre de l'entrada (guany mínim abans d'activar). Llavors segueix el ${extrm} assolit amb una cua de ${distMult}×ATR.`);
    } catch { /* keep empty */ }
    finally { setTrailingLoading(false); }
  }, []);

  const toggleTrailing = () => {
    const next = !trailingOn;
    setTrailingOn(next);
    if (next && trailingAtr === 0 && !analysisSnap) {
      suggestTrailing(side, ref, effectivePair);
    }
  };

  // Re-suggest if side or pair changes while trailing is on (skip in OCO when analysis drives it)
  useEffect(() => {
    if (trailingOn && ref && !(mode === "oco" && analysisSnap)) suggestTrailing(side, ref, effectivePair);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side, effectivePair]);

  useEscapeKey(onClose);

  /* fetch analysis for both modes when pair/interval changes */
  useEffect(() => {
    if (!effectivePair) return;
    let cancelled = false;
    setAnalysisLoading(true);
    setAnalysisSnap(null);
    fetch(`/api/analysis?symbol=${effectivePair}&interval=${analysisInterval}`)
      .then(r => r.json())
      .then((d: AnalysisSnap) => {
        if (!cancelled) {
          const firstBullish = d.strategies.findIndex(s => s.type !== "bearish");
          setAnalysisSnap(d);
          setSelectedStratIdx(firstBullish >= 0 ? firstBullish : 0);
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setAnalysisLoading(false); });
    return () => { cancelled = true; };
  }, [effectivePair, analysisInterval]);

  /* apply selected strategy — OCO: absolute prices; buy-exit: percentages */
  useEffect(() => {
    if (!analysisSnap || selectedBot) return;
    const s = analysisSnap.strategies[selectedStratIdx];
    if (!s || s.type === "bearish") return;
    if (mode === "oco" && tickSize) applyStrategy(s, analysisSnap.price, analysisSnap.atr, tickSize);
    if (mode === "buy-exit")        applyStrategyToBuyExit(s, analysisSnap.price, analysisSnap.atr);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, analysisSnap, selectedStratIdx, tickSize, selectedBot]);

  /* apply bot config when bot selected + analysis loaded */
  useEffect(() => {
    if (!selectedBot || !analysisSnap) return;
    const cfg = selectedBot.simConfig?.config;
    if (!cfg) return;
    const { atr, price } = analysisSnap;
    if (!atr || !price) return;
    const tpAtr      = cfg.tpAtr            ?? 2.5;
    const slAtr      = cfg.slAtr            ?? 1.0;
    const trailAct   = cfg.trailActivateAtr ?? 1.5;
    const trailDst   = cfg.trailDistanceAtr ?? 1.0;
    const breakEvenAtr = cfg.breakEvenAtr   ?? 0;
    const prec = price >= 100 ? 2 : price >= 1 ? 4 : 6;
    // buy-exit: percentages
    setBeTpPct((tpAtr * atr / price * 100).toFixed(2));
    setBeSlPct((slAtr * atr / price * 100).toFixed(2));
    // oco: absolute prices
    const tpP  = roundNearest(price + tpAtr * atr, tickSize);
    const slP  = roundNearest(price - slAtr * atr, tickSize);
    const sllP = roundNearest(parseFloat(slP) * 0.999, tickSize);
    setTpPrice(tpP);       setTpPct(pctOf(parseFloat(tpP), price));
    setSlStopPrice(slP);   setSlStopPct(pctOf(parseFloat(slP), price));
    setSlLimitPrice(sllP); setSlLimitPct(pctOf(parseFloat(sllP), price));
    // trailing (always on when bot applies)
    setTrailingOn(true);
    setTrailingAtr(atr);
    setTrailingActivateAt((price + trailAct * atr).toFixed(prec));
    setTrailingDistance((trailDst * atr).toFixed(prec));
    setTrailingActivateAtr(trailAct);
    setTrailingDistanceAtr(trailDst);
    setTrailingBreakEvenAtr(breakEvenAtr);
    const beLabel = breakEvenAtr > 0 ? ` · B/E ${breakEvenAtr}×ATR` : "";
    setTrailingLogic(`${selectedBot.name} · TP ${tpAtr}×ATR · SL ${slAtr}×ATR · Trail: activa ${trailAct}×ATR, dist ${trailDst}×ATR${beLabel}`);
   
  }, [selectedBot, analysisSnap, tickSize]);

  const submitBuyExit = async () => {
    setError(null);
    const usd   = parseFloat(beUsdAmount);
    const tpPct = parseFloat(beTpPct);
    const slPct = parseFloat(beSlPct);
    if (!usd || usd <= 0)        { setError(`Enter a valid ${pairQuoteAsset} amount.`); return; }
    if (!ref || ref <= 0)        { setError("Preu de referència no disponible."); return; }
    if ((balances[pairQuoteAsset] ?? 0) < usd) { setError(`Insufficient ${pairQuoteAsset} balance (${balances[pairQuoteAsset] ?? 0})`); return; }
    if (!tpPct || tpPct <= 0)   { setError("Take Profit % must be > 0."); return; }
    if (!slPct || slPct <= 0)   { setError("Stop Loss % must be > 0."); return; }

    const tpPriceVal = ref * (1 + tpPct / 100);
    const slPriceVal = ref * (1 - slPct / 100);

    const trailing = trailingOn && trailingActivateAt && trailingDistance ? {
      activateAt:   parseFloat(trailingActivateAt),
      distance:     parseFloat(trailingDistance),
      activateAtr:  trailingActivateAtr,
      distanceAtr:  trailingDistanceAtr,
      breakEvenAtr: trailingBreakEvenAtr,
      logic:        trailingLogic,
    } : null;

    setSaving(true);
    try {
      const botCfg = selectedBot?.simConfig?.config;
      const atrVal = analysisSnap?.atr;
      const res = await fetch("/api/orders/buy-and-exit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: effectivePair,
          quoteOrderQty: usd.toFixed(2),
          tpPrice: tpPriceVal,
          slPrice: slPriceVal,
          trailing,
          botName: selectedBot?.name ?? null,
          mode: viewMode,
          // Quan s'aplica un bot, enviem els multiplicadors ATR perquè el servidor
          // recalculi TP/SL des del fillPrice real (evita SL erroni si el preu es mou)
          ...(botCfg && atrVal ? {
            tpAtrMul: botCfg.tpAtr ?? 2.5,
            slAtrMul: botCfg.slAtr ?? 1.0,
            atr:      atrVal,
          } : {}),
        }),
      });
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      onSuccess(); onClose();
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    setError(null);
    const qty = qtyMode === "usd"
      ? (ref ? roundDown(parseFloat(usdAmount) / ref, stepSize) : "")
      : roundDown(parseFloat(cryptoQty), stepSize);

    if (!qty || parseFloat(qty) <= 0) { setError("Enter a valid quantity."); return; }
    if (!tpPrice || parseFloat(tpPrice) <= 0) { setError("Enter a valid Take Profit price."); return; }
    if (!slStopPrice || parseFloat(slStopPrice) <= 0) { setError("Enter a valid Stop Loss trigger."); return; }
    if (!slLimitPrice || parseFloat(slLimitPrice) <= 0) { setError("Enter a valid Stop Loss limit price."); return; }
    if (!directionOk(side, parseFloat(tpPrice), parseFloat(slStopPrice), ref)) {
      setError("El Take Profit ha d'estar per sobre del preu actual i el Stop Loss per sota.");
      return;
    }

    setSaving(true);
    try {
      const trailing = trailingOn && trailingActivateAt && trailingDistance ? {
        activateAt:  parseFloat(trailingActivateAt),
        distance:    parseFloat(trailingDistance),
        activateAtr: trailingActivateAtr,
        distanceAtr: trailingDistanceAtr,
        logic:       trailingLogic,
      } : null;
      const res = await fetch("/api/orders/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: effectivePair, side, quantity: qty,
          tpPrice, slStopPrice, slLimitPrice, trailing,
          interval: analysisInterval,
          botName: selectedBot?.name ?? null,
          mode: viewMode,
        }),
      });
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      onSuccess(); onClose();
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const pctCls = (pct: string) => {
    const v = parseFloat(pct); if (isNaN(v) || v === 0) return "";
    return v > 0 ? "new-order__pct-pos" : "new-order__pct-neg";
  };

  const badDirection = !directionOk(side, parseFloat(tpPrice), parseFloat(slStopPrice), ref);

  // Intervals disponibles: sempre 5m/1h/4h + el del bot si és diferent
  const intervalButtons = Array.from(new Set(["5m", "1h", "4h", analysisInterval]));

  return (
    <div className="new-order__backdrop" onClick={onClose}>
      <div className="new-order__box" onClick={e => e.stopPropagation()}>

        <div className="new-order__header">
          <span className="new-order__title">New Order</span>
          <button className="order-edit__close" onClick={onClose}>×</button>
        </div>

        <div className="new-order__body">

          {/* Mode tabs */}
          <div className="new-order__mode-tabs">
            <button
              className={`new-order__mode-tab${mode === "buy-exit" ? " new-order__mode-tab--active" : ""}`}
              onClick={() => setMode("buy-exit")}>
              Compra + Sortida
            </button>
            <button
              className={`new-order__mode-tab${mode === "oco" ? " new-order__mode-tab--active" : ""}`}
              onClick={() => setMode("oco")}>
              OCO Sortida
            </button>
          </div>

          {/* Symbol (shared) */}
          <div className="order-edit__field">
            <span className="order-edit__label">Symbol</span>
            {coin ? (
              <div className="new-order__coin-locked">
                <CoinIcon symbol={activeCoin.symbol} size={18} />
                <span className="new-order__coin-name">{activeCoin.symbol} / {quoteAsset}</span>
                <span className="new-order__price-ref">{formatCurrency(activeCoin.price)}</span>
              </div>
            ) : (
              <>
                <select className="order-edit__input new-order__select"
                  value={selectedPair} onChange={e => { setSelectedPair(e.target.value); setCustomPair(""); setCustomPrice(0); }}>
                  {coins.map(c => (
                    <option key={c.pair} value={c.pair}>
                      {c.symbol} — {formatCurrency(c.price)}
                    </option>
                  ))}
                  <option value="__custom__">✏️ Parell personalitzat…</option>
                </select>
                {isCustom && (
                  <div className="new-order__custom-pair">
                    <div className="new-order__symbol-search-wrap">
                      <i className="fa-solid fa-magnifying-glass new-order__symbol-search-icon" />
                      <input
                        className="order-edit__input new-order__symbol-search-input"
                        placeholder="Cerca parell… (ex: SOLBTC, ETH)"
                        value={symbolSearch}
                        onChange={e => { setSymbolSearch(e.target.value); setShowSymbolList(true); }}
                        onFocus={() => setShowSymbolList(true)}
                        onBlur={() => setTimeout(() => setShowSymbolList(false), 150)}
                        autoFocus
                      />
                      {customPair && (
                        <span className="new-order__symbol-selected">
                          {customPair}
                          <button className="new-order__symbol-clear" onClick={() => { setCustomPair(""); setCustomPrice(0); setSymbolSearch(""); }}>×</button>
                        </span>
                      )}
                    </div>
                    {showSymbolList && filteredSymbols.length > 0 && (
                      <ul className="new-order__symbol-list">
                        {filteredSymbols.map(s => (
                          <li key={s.symbol}
                            className="new-order__symbol-item"
                            onMouseDown={() => {
                              setCustomPair(s.symbol);
                              setSymbolSearch(s.symbol);
                              setShowSymbolList(false);
                              setCustomPrice(0);
                            }}>
                            <span className="new-order__symbol-item-sym">{s.symbol}</span>
                            <span className="new-order__symbol-item-desc">{s.base} / {s.quote}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {allSymbols.length === 0 && <span className="new-order__custom-pair-hint">Carregant parells…</span>}
                    {loadingPrice && <span className="new-order__custom-pair-hint">Obtenint preu…</span>}
                    {!loadingPrice && customPrice > 0 && (
                      <span className="new-order__custom-pair-hint new-order__custom-pair-hint--ok">
                        1 {pairBaseAsset} = {customPrice} {pairQuoteAsset}
                        {" · "}Saldo {pairQuoteAsset}: {balances[pairQuoteAsset]?.toFixed(pairQuoteAsset === "BTC" || pairQuoteAsset === "ETH" ? 6 : 2) ?? 0}
                      </span>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* ── OCO Mode ──────────────────────────── */}
          {mode === "oco" && <>

          {/* Analysis interval + strategy picker */}
          <div className="new-order__analysis-bar">
            <span className="new-order__analysis-label">Anàlisi</span>
            {intervalButtons.map(iv => (
              <button key={iv}
                className={`new-order__interval-btn${analysisInterval === iv ? " new-order__interval-btn--active" : ""}`}
                onClick={() => setAnalysisInterval(iv)}>
                {iv}
              </button>
            ))}
            {analysisLoading && <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: "0.65rem", color: "var(--text-3)", marginLeft: 4 }} />}
          </div>

          {analysisSnap && !selectedBot && (
            <div className="new-order__strategies">
              {analysisSnap.strategies
                .map((s, i) => ({ s, i }))
                .filter(({ s }) => s.type !== "bearish")
                .map(({ s, i }) => (
                  <button key={i}
                    className={`new-order__strategy-btn${i === selectedStratIdx ? " new-order__strategy-btn--sel" : ""}${!s.active ? " new-order__strategy-btn--off" : ""}`}
                    onClick={() => setSelectedStratIdx(i)}>
                    <span className="new-order__strategy-name">{s.name}</span>
                    <span className={`new-order__strategy-conf new-order__strategy-conf--${s.confidence}`}>{s.confidence}</span>
                  </button>
                ))}
            </div>
          )}

          {bots.length > 0 && (
            <div className="new-order__bot-presets">
              <span className="new-order__analysis-label"><i className="fa-solid fa-robot" /> Bot preset</span>
              <select
                className="order-edit__input new-order__bot-select"
                value={selectedBotId ?? ""}
                onChange={e => selectBot(e.target.value || null)}>
                <option value="">— Manual —</option>
                {bots.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.code} · {b.name}{!b.enabled ? " (inactiu)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Quantity */}
          <div className="order-edit__field">
            <div className="new-order__label-row">
              <span className="order-edit__label">Quantity</span>
              <span className="new-order__balance-hint">
                {side === "SELL"
                  ? `Saldo: ${balances[pairBaseAsset] ?? 0} ${pairBaseAsset}`
                  : `Saldo: ${balances[pairQuoteAsset] != null ? balances[pairQuoteAsset].toFixed(pairQuoteAsset === "BTC" || pairQuoteAsset === "ETH" ? 6 : 2) : 0} ${pairQuoteAsset}`
                }
              </span>
              <div className="new-order__toggle">
                <button className={`new-order__toggle-btn${qtyMode === "usd" ? " new-order__toggle-btn--active" : ""}`}
                  onClick={() => setQtyMode("usd")}>{pairQuoteAsset}</button>
                <button className={`new-order__toggle-btn${qtyMode === "crypto" ? " new-order__toggle-btn--active" : ""}`}
                  onClick={() => setQtyMode("crypto")}>{pairBaseAsset || activeCoin?.symbol}</button>
              </div>
            </div>
            {qtyMode === "usd" ? (
              <>
                <div className="new-order__prefix-wrap">
                  <span className="new-order__prefix">{["USDT","USDC","BUSD","FDUSD","TUSD"].includes(pairQuoteAsset) ? "$" : pairQuoteAsset}</span>
                  <input className="order-edit__input new-order__prefixed" type="number"
                    min="0" step="any" value={usdAmount}
                    onChange={e => onUsd(e.target.value)} placeholder="0.00" />
                </div>
                {cryptoQty && ref > 0 && <span className="new-order__hint">≈ {cryptoQty} {pairBaseAsset || activeCoin?.symbol}</span>}
              </>
            ) : (
              <>
                <input className="order-edit__input" type="number"
                  min="0" step="any" value={cryptoQty}
                  onChange={e => onCrypto(e.target.value)} placeholder="0.000000" />
                {usdAmount && ref > 0 && <span className="new-order__hint">≈ {["USDT","USDC","BUSD","FDUSD","TUSD"].includes(pairQuoteAsset) ? "$" : ""}{usdAmount} {["USDT","USDC","BUSD","FDUSD","TUSD"].includes(pairQuoteAsset) ? "" : pairQuoteAsset}</span>}
              </>
            )}
          </div>

          <div className="new-order__divider"><span>OCO Prices</span></div>

          {/* Direction hint */}
          {badDirection && (
            <div className="new-order__dir-hint">
              <i className="fa-solid fa-triangle-exclamation" />
              {"TP ha d'estar per sobre del preu actual · SL per sota"}
            </div>
          )}

          {/* Take Profit */}
          <div className="order-edit__field">
            <span className="order-edit__label">
              <i className="fa-solid fa-circle new-order__tp-dot" /> Take Profit Price
              <span className="new-order__field-hint">{"per sobre del preu d'entrada"}</span>
            </span>
            <div className="new-order__price-row">
              <input className="order-edit__input" type="number" min="0" step="any"
                value={tpPrice} onChange={e => onTpPrice(e.target.value)} />
              <div className="new-order__pct-wrap">
                <input className={`new-order__pct-input ${pctCls(tpPct)}`} type="number"
                  step="0.01" value={tpPct} onChange={e => onTpPct(e.target.value)} />
                <span className="new-order__pct-sign">%</span>
              </div>
            </div>
          </div>

          {/* SL Trigger */}
          <div className="order-edit__field">
            <span className="order-edit__label">
              <i className="fa-solid fa-circle new-order__sl-dot" /> Stop Loss Trigger
              <span className="new-order__field-hint">{"per sota del preu d'entrada"}</span>
            </span>
            <div className="new-order__price-row">
              <input className="order-edit__input" type="number" min="0" step="any"
                value={slStopPrice} onChange={e => onSlStopPrice(e.target.value)} />
              <div className="new-order__pct-wrap">
                <input className={`new-order__pct-input ${pctCls(slStopPct)}`} type="number"
                  step="0.01" value={slStopPct} onChange={e => onSlStopPct(e.target.value)} />
                <span className="new-order__pct-sign">%</span>
              </div>
            </div>
          </div>

          {/* SL Limit */}
          <div className="order-edit__field">
            <span className="order-edit__label">
              <i className="fa-solid fa-circle new-order__sl-dot" /> Stop Loss Limit Price
            </span>
            <div className="new-order__price-row">
              <input className="order-edit__input" type="number" min="0" step="any"
                value={slLimitPrice} onChange={e => onSlLimitPrice(e.target.value)} />
              <div className="new-order__pct-wrap">
                <input className={`new-order__pct-input ${pctCls(slLimitPct)}`} type="number"
                  step="0.01" value={slLimitPct} onChange={e => onSlLimitPct(e.target.value)} />
                <span className="new-order__pct-sign">%</span>
              </div>
            </div>
          </div>

          {/* Trailing Stop */}
          <div className="new-order__trailing">
            <div className="new-order__trailing-toggle" onClick={toggleTrailing} role="button">
              <div className="new-order__trailing-label">
                <i className="fa-solid fa-flag-checkered" style={{ color: "#d97706", fontSize: "0.75rem" }} />
                <span>Trailing Stop</span>
                {trailingLoading && <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: "0.65rem", color: "var(--text-3)" }} />}
              </div>
              <div className={`new-order__trailing-switch${trailingOn ? " new-order__trailing-switch--on" : ""}`}>
                <div className="new-order__trailing-switch-knob" />
              </div>
            </div>

            {trailingOn && (
              <div className="new-order__trailing-body">
                <div className="new-order__trailing-row">
                  <div className="order-edit__field" style={{ flex: 1 }}>
                    <span className="order-edit__label">
                      {"Preu d'activació"}
                      {trailingAtr > 0 && <span className="new-order__atr-badge">{trailingActivateAtr}×ATR</span>}
                    </span>
                    <input className="order-edit__input" type="number" min="0" step="any"
                      value={trailingActivateAt}
                      onChange={e => setTrailingActivateAt(e.target.value)} />
                  </div>
                  <div className="order-edit__field" style={{ flex: 1 }}>
                    <span className="order-edit__label">
                      Distància cua
                      {trailingAtr > 0 && <span className="new-order__atr-badge">{trailingDistanceAtr}×ATR</span>}
                    </span>
                    <input className="order-edit__input" type="number" min="0" step="any"
                      value={trailingDistance}
                      onChange={e => setTrailingDistance(e.target.value)} />
                  </div>
                </div>
                {trailingLogic && (
                  <div className="new-order__trailing-logic">{trailingLogic}</div>
                )}
                {!trailingLoading && trailingAtr === 0 && (
                  <div className="new-order__trailing-logic" style={{ color: "var(--text-3)" }}>
                    Introdueix els valors manualment o espera que carregui la suggerència.
                  </div>
                )}
              </div>
            )}
          </div>

          </> /* end mode === "oco" */}

          {/* ── Compra + Sortida Mode ─────────────── */}
          {mode === "buy-exit" && <>

          {/* Analysis interval + strategy picker */}
          <div className="new-order__analysis-bar">
            <span className="new-order__analysis-label">Anàlisi</span>
            {intervalButtons.map(iv => (
              <button key={iv}
                className={`new-order__interval-btn${analysisInterval === iv ? " new-order__interval-btn--active" : ""}`}
                onClick={() => setAnalysisInterval(iv)}>
                {iv}
              </button>
            ))}
            {analysisLoading && <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: "0.65rem", color: "var(--text-3)", marginLeft: 4 }} />}
          </div>

          {analysisSnap && !selectedBot && (
            <div className="new-order__strategies">
              {analysisSnap.strategies
                .map((s, i) => ({ s, i }))
                .filter(({ s }) => s.type !== "bearish")
                .map(({ s, i }) => (
                  <button key={i}
                    className={`new-order__strategy-btn${i === selectedStratIdx ? " new-order__strategy-btn--sel" : ""}${!s.active ? " new-order__strategy-btn--off" : ""}`}
                    onClick={() => setSelectedStratIdx(i)}>
                    <span className="new-order__strategy-name">{s.name}</span>
                    <span className={`new-order__strategy-conf new-order__strategy-conf--${s.confidence}`}>{s.confidence}</span>
                  </button>
                ))}
            </div>
          )}

          {bots.length > 0 && (
            <div className="new-order__bot-presets">
              <span className="new-order__analysis-label"><i className="fa-solid fa-robot" /> Bot preset</span>
              <select
                className="order-edit__input new-order__bot-select"
                value={selectedBotId ?? ""}
                onChange={e => selectBot(e.target.value || null)}>
                <option value="">— Manual —</option>
                {bots.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.code} · {b.name}{!b.enabled ? " (inactiu)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Quote amount */}
          <div className="order-edit__field">
            <div className="new-order__label-row">
              <span className="order-edit__label">Import USDC</span>
              <span className="new-order__balance-hint">
                Saldo: {balances[pairQuoteAsset] != null ? balances[pairQuoteAsset].toFixed(pairQuoteAsset === "BTC" || pairQuoteAsset === "ETH" ? 6 : 2) : 0} {pairQuoteAsset}
              </span>
            </div>
            <div className="new-order__prefix-wrap">
              <span className="new-order__prefix">$</span>
              <input className="order-edit__input new-order__prefixed" type="number"
                min="0" step="any" value={beUsdAmount}
                onChange={e => setBeUsdAmount(e.target.value)} placeholder="0.00" />
            </div>
            {selectedBot?.budgetUsdc != null && parseFloat(beUsdAmount) > selectedBot.budgetUsdc && (
              <div className="order-edit__locked-warn">
                <i className="fa-solid fa-triangle-exclamation" />
                {parseFloat(beUsdAmount).toFixed(2)} USDC supera el pressupost del bot <b>{selectedBot.name}</b> ({selectedBot.budgetUsdc} USDC). El bot no podrà gestionar aquesta posició.
              </div>
            )}
          </div>

          {/* TP % */}
          {(() => {
            const atrVal = analysisSnap?.atr;
            const dp     = ref && ref >= 100 ? 2 : ref && ref >= 1 ? 4 : 6;
            const tpMul  = (atrVal && ref && beTpPct)
              ? (parseFloat(beTpPct) / 100 * ref) / atrVal : null;
            return (
              <div className="order-edit__field">
                <span className="order-edit__label">
                  <i className="fa-solid fa-circle new-order__tp-dot" /> Take Profit %
                  {tpMul != null && (
                    <span className="new-order__atr-badge" style={{ background: "rgba(16,185,129,0.12)", color: "var(--green)", border: "1px solid rgba(16,185,129,0.3)" }}>
                      {tpMul.toFixed(2)}×ATR
                    </span>
                  )}
                </span>
                <div className="new-order__price-row">
                  <input className="order-edit__input new-order__pct-pos" type="number"
                    min="0.01" step="0.01" value={beTpPct}
                    onChange={e => setBeTpPct(e.target.value)} />
                  <div className="new-order__pct-wrap">
                    <span className="new-order__pct-computed">
                      {ref && beTpPct ? (ref * (1 + parseFloat(beTpPct) / 100)).toFixed(dp) : "—"}
                    </span>
                    <span className="new-order__pct-sign">%</span>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* SL % */}
          {(() => {
            const atrVal = analysisSnap?.atr;
            const dp     = ref && ref >= 100 ? 2 : ref && ref >= 1 ? 4 : 6;
            const slMul  = (atrVal && ref && beSlPct)
              ? (parseFloat(beSlPct) / 100 * ref) / atrVal : null;
            return (
              <div className="order-edit__field">
                <span className="order-edit__label">
                  <i className="fa-solid fa-circle new-order__sl-dot" /> Stop Loss %
                  <span className="new-order__field-hint">SL Limit offset fix 0.1%</span>
                  {slMul != null && (
                    <span className="new-order__atr-badge" style={{ background: "rgba(239,68,68,0.1)", color: "var(--red)", border: "1px solid rgba(239,68,68,0.25)" }}>
                      {slMul.toFixed(2)}×ATR
                    </span>
                  )}
                </span>
                <div className="new-order__price-row">
                  <input className="order-edit__input new-order__pct-neg" type="number"
                    min="0.01" step="0.01" value={beSlPct}
                    onChange={e => setBeSlPct(e.target.value)} />
                  <div className="new-order__pct-wrap">
                    <span className="new-order__pct-computed">
                      {ref && beSlPct ? (ref * (1 - parseFloat(beSlPct) / 100)).toFixed(dp) : "—"}
                    </span>
                    <span className="new-order__pct-sign">%</span>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Trailing Stop */}
          <div className="new-order__trailing">
            <div className="new-order__trailing-toggle" onClick={toggleTrailing} role="button">
              <div className="new-order__trailing-label">
                <i className="fa-solid fa-flag-checkered" style={{ color: "#d97706", fontSize: "0.75rem" }} />
                <span>Trailing Stop</span>
                {trailingLoading && <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: "0.65rem", color: "var(--text-3)" }} />}
              </div>
              <div className={`new-order__trailing-switch${trailingOn ? " new-order__trailing-switch--on" : ""}`}>
                <div className="new-order__trailing-switch-knob" />
              </div>
            </div>
            {trailingOn && (
              <div className="new-order__trailing-body" style={{ borderTop: "none", paddingTop: 0 }}>
                <div className="new-order__trailing-row">
                  <div className="order-edit__field" style={{ flex: 1 }}>
                    <span className="order-edit__label">
                      {"Preu d'activació"}
                      {trailingAtr > 0 && <span className="new-order__atr-badge">{trailingActivateAtr}×ATR</span>}
                    </span>
                    <input className="order-edit__input" type="number" min="0" step="any"
                      value={trailingActivateAt} onChange={e => setTrailingActivateAt(e.target.value)} />
                  </div>
                  <div className="order-edit__field" style={{ flex: 1 }}>
                    <span className="order-edit__label">
                      Distància cua
                      {trailingAtr > 0 && <span className="new-order__atr-badge">{trailingDistanceAtr}×ATR</span>}
                    </span>
                    <input className="order-edit__input" type="number" min="0" step="any"
                      value={trailingDistance} onChange={e => setTrailingDistance(e.target.value)} />
                  </div>
                </div>
                {trailingLogic && <div className="new-order__trailing-logic">{trailingLogic}</div>}
              </div>
            )}
          </div>

          </> /* end mode === "buy-exit" */}

          {/* Màxim de posicions — bloqueja sense confirmació */}
          {mode === "buy-exit" && selectedBot && isMaxOpenReached && (
            <div className="order-edit__locked-warn">
              <i className="fa-solid fa-ban" />
              {" "}El bot <b>{selectedBot.name}</b> ja té <b>{botPositionCount}/{botMaxOpen}</b> posicions obertes (límit del bot). Tanca alguna posició abans de continuar.
            </div>
          )}

          {/* Validation warnings with explicit confirmation */}
          {mode === "buy-exit" && selectedBot && newAmount > 0 && isTotalExceeded && !isBudgetExceeded && (
            <div className="order-edit__locked-warn">
              <i className="fa-solid fa-triangle-exclamation" />
              {" "}El bot <b>{selectedBot.name}</b> té un pressupost de <b>{selectedBot.budgetUsdc} USDC</b>.
              <div className="new-order__budget-breakdown">
                {botOpenOrders.map(o => (
                  <div key={o.symbol} className="new-order__budget-line">
                    <span>{o.symbol}</span>
                    <span>{o.value.toFixed(2)} USDC</span>
                  </div>
                ))}
                <div className="new-order__budget-line new-order__budget-line--new">
                  <span>+ {effectivePair} (nova)</span>
                  <span>{newAmount.toFixed(2)} USDC</span>
                </div>
                <div className="new-order__budget-line new-order__budget-line--total">
                  <span>Total</span>
                  <span>{(botCommitted + newAmount).toFixed(2)} USDC</span>
                </div>
              </div>
              <label className="new-order__confirm-check">
                <input type="checkbox" checked={confirmedTotalBudget}
                  onChange={e => setConfirmedTotalBudget(e.target.checked)} />
                {" "}Confirmo que vull superar el pressupost
              </label>
            </div>
          )}
          {mode === "buy-exit" && selectedBot && newAmount > 0 && isSymbolMismatch && (
            <div className="order-edit__locked-warn">
              <i className="fa-solid fa-triangle-exclamation" />
              {" "}<b>{effectivePair}</b> no és un dels símbols configurats del bot{" "}
              <b>{selectedBot.name}</b> ({botSymbols.join(", ")}).
              <label className="new-order__confirm-check">
                <input type="checkbox" checked={confirmedSymbol}
                  onChange={e => setConfirmedSymbol(e.target.checked)} />
                {" "}Confirmo que vull comprar fora dels símbols del bot
              </label>
            </div>
          )}

          {error && <div className="order-edit__error">{error}</div>}
          {isRealLocked && (
            <div className="order-edit__locked-warn">
              <i className="fa-solid fa-lock" /> Mode real bloquejat — sols consultes. Desbloqueja al menú lateral.
            </div>
          )}
        </div>

        <div className="order-edit__footer">
          <button className="order-edit__btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
          {mode === "oco" ? (
            <button className="order-edit__btn-save" onClick={submit} disabled={saving || badDirection || isRealLocked}
              title={isRealLocked ? "Mode real bloquejat" : undefined}>
              {saving ? "Placing…" : "Col·locar SELL OCO"}
            </button>
          ) : (
            <button className="order-edit__btn-save" onClick={submitBuyExit}
              disabled={saving || isRealLocked || isMaxOpenReached || isBudgetExceeded || (newAmount > 0 && isTotalExceeded && !confirmedTotalBudget) || (newAmount > 0 && isSymbolMismatch && !confirmedSymbol)}
              title={isRealLocked ? "Mode real bloquejat" : isBudgetExceeded ? `Import supera el pressupost del bot (${selectedBot?.budgetUsdc} USDC)` : (isTotalExceeded && !confirmedTotalBudget) ? "Confirma el superament del pressupost total" : (isSymbolMismatch && !confirmedSymbol) ? "Confirma el símbol fora del bot" : undefined}>
              {saving ? "Placing…" : "Compra + Sortida"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
