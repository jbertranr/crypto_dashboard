"use client";
import { useEffect, useState, useCallback } from "react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { CoinRow } from "../lib/types";
import { formatCurrency } from "../lib/format";
import CoinIcon from "./CoinIcon";

type StratProposal = {
  name: string; type: "bullish" | "bearish" | "neutral";
  confidence: "alta" | "moderada" | "baixa"; active: boolean;
  tp: number; sl: number; slLimit: number;
  trailing: { activateAt: number; distance: number; activateAtr: number; distanceAtr: number; logic: string };
};
type AnalysisSnap = { price: number; atr: number; strategies: StratProposal[] };

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
  const defaultCoin = coin ?? coins[0];
  const [selectedPair, setSelectedPair] = useState(defaultCoin?.pair ?? "");
  const activeCoin = coins.find(c => c.pair === selectedPair) ?? defaultCoin;
  const ref = activeCoin?.price ?? 0;

  /* mode toggle */
  const [mode, setMode] = useState<"oco" | "buy-exit">("buy-exit");

  /* buy-exit form state */
  const [beUsdAmount,  setBeUsdAmount]  = useState("");
  const [beTpPct,      setBeTpPct]      = useState("3.00");
  const [beSlPct,      setBeSlPct]      = useState("3.00");

  /* analysis (OCO mode) */
  const [analysisInterval,  setAnalysisInterval]  = useState<"5m" | "1h" | "4h">(presetPrices?.interval ?? "1h");
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
  const [trailingOn,          setTrailingOn]          = useState(true);
  const [trailingActivateAt,  setTrailingActivateAt]  = useState("");
  const [trailingDistance,    setTrailingDistance]    = useState("");
  const [trailingActivateAtr, setTrailingActivateAtr] = useState(1.0);
  const [trailingDistanceAtr, setTrailingDistanceAtr] = useState(1.5);
  const [trailingAtr,         setTrailingAtr]         = useState(0);
  const [trailingLogic,       setTrailingLogic]       = useState("");
  const [trailingLoading,     setTrailingLoading]     = useState(false);

  /* fetch exchange filters when pair changes */
  useEffect(() => {
    if (!selectedPair) return;
    fetch(`/api/exchange-info?symbol=${selectedPair}`)
      .then(r => r.json())
      .then(d => { if (d.stepSize) setStepSize(d.stepSize); if (d.tickSize) setTickSize(d.tickSize); })
      .catch(() => {});
  }, [selectedPair]);

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
  }, [selectedPair, side, tickSize]);

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
      const actMult = 0, distMult = 1.5;
      const activateAt = entry; // activació immediata des del preu d'entrada
      const distance   = atr * distMult;
      const atrFmt = atr >= 100 ? atr.toFixed(2) : atr >= 1 ? atr.toFixed(4) : atr.toFixed(6);
      const extrm = currentSide === "SELL" ? "màxim" : "mínim";
      setTrailingAtr(atr);
      setTrailingActivateAt(activateAt.toFixed(prec));
      setTrailingDistance(distance.toFixed(prec));
      setTrailingActivateAtr(actMult);
      setTrailingDistanceAtr(distMult);
      setTrailingLogic(`S'activa automàticament des del preu d'entrada. Segueix el ${extrm} assolit amb una cua de ${distMult}×ATR (≈${atrFmt}) — protegeix beneficis sense tancar massa aviat.`);
    } catch { /* keep empty */ }
    finally { setTrailingLoading(false); }
  }, []);

  const toggleTrailing = () => {
    const next = !trailingOn;
    setTrailingOn(next);
    if (next && trailingAtr === 0 && !analysisSnap) {
      suggestTrailing(side, ref, selectedPair);
    }
  };

  // Re-suggest if side or pair changes while trailing is on (skip in OCO when analysis drives it)
  useEffect(() => {
    if (trailingOn && ref && !(mode === "oco" && analysisSnap)) suggestTrailing(side, ref, selectedPair);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side, selectedPair]);

  useEscapeKey(onClose);

  /* fetch analysis for both modes when pair/interval changes */
  useEffect(() => {
    if (!selectedPair) return;
    let cancelled = false;
    setAnalysisLoading(true);
    setAnalysisSnap(null);
    fetch(`/api/analysis?symbol=${selectedPair}&interval=${analysisInterval}`)
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
  }, [selectedPair, analysisInterval]);

  /* apply selected strategy — OCO: absolute prices; buy-exit: percentages */
  useEffect(() => {
    if (!analysisSnap) return;
    const s = analysisSnap.strategies[selectedStratIdx];
    if (!s || s.type === "bearish") return;
    if (mode === "oco" && tickSize) applyStrategy(s, analysisSnap.price, analysisSnap.atr, tickSize);
    if (mode === "buy-exit")        applyStrategyToBuyExit(s, analysisSnap.price, analysisSnap.atr);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, analysisSnap, selectedStratIdx, tickSize]);

  const submitBuyExit = async () => {
    setError(null);
    const usd   = parseFloat(beUsdAmount);
    const tpPct = parseFloat(beTpPct);
    const slPct = parseFloat(beSlPct);
    if (!usd || usd <= 0)        { setError("Enter a valid USDT amount."); return; }
    if (!tpPct || tpPct <= 0)    { setError("Take Profit % must be > 0."); return; }
    if (!slPct || slPct <= 0)    { setError("Stop Loss % must be > 0."); return; }
    if (!ref || ref <= 0)        { setError("Preu de referència no disponible."); return; }
    if ((balances["USDT"] ?? 0) < usd) { setError(`Insufficient USDT balance (${balances["USDT"] ?? 0})`); return; }

    const tpPrice = ref * (1 + tpPct / 100);
    const slPrice = ref * (1 - slPct / 100);

    setSaving(true);
    try {
      const trailing = trailingOn && trailingActivateAt && trailingDistance ? {
        activateAt:  parseFloat(trailingActivateAt),
        distance:    parseFloat(trailingDistance),
        activateAtr: trailingActivateAtr,
        distanceAtr: trailingDistanceAtr,
        logic:       trailingLogic,
      } : null;
      const res = await fetch("/api/orders/buy-and-exit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: activeCoin.pair,
          quoteOrderQty: usd.toFixed(2),
          tpPrice,
          slPrice,
          trailing,
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
          symbol: activeCoin.pair, side, quantity: qty,
          tpPrice, slStopPrice, slLimitPrice, trailing,
          interval: analysisInterval,
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
                <span className="new-order__coin-name">{activeCoin.symbol} / USDT</span>
                <span className="new-order__price-ref">{formatCurrency(activeCoin.price)}</span>
              </div>
            ) : (
              <select className="order-edit__input new-order__select"
                value={selectedPair} onChange={e => setSelectedPair(e.target.value)}>
                {coins.map(c => (
                  <option key={c.pair} value={c.pair}>
                    {c.symbol} — {formatCurrency(c.price)}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* ── OCO Mode ──────────────────────────── */}
          {mode === "oco" && <>

          {/* Analysis interval + strategy picker */}
          <div className="new-order__analysis-bar">
            <span className="new-order__analysis-label">Anàlisi</span>
            {(["5m", "1h", "4h"] as const).map(iv => (
              <button key={iv}
                className={`new-order__interval-btn${analysisInterval === iv ? " new-order__interval-btn--active" : ""}`}
                onClick={() => setAnalysisInterval(iv)}>
                {iv}
              </button>
            ))}
            {analysisLoading && <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: "0.65rem", color: "var(--text-3)", marginLeft: 4 }} />}
          </div>

          {analysisSnap && (
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


          {/* Quantity */}
          <div className="order-edit__field">
            <div className="new-order__label-row">
              <span className="order-edit__label">Quantity</span>
              <span className="new-order__balance-hint">
                {side === "SELL"
                  ? `Saldo: ${balances[activeCoin?.symbol ?? ""] ?? 0} ${activeCoin?.symbol ?? ""}`
                  : `Saldo: ${formatCurrency(balances["USDT"] ?? 0)} USDT`
                }
              </span>
              <div className="new-order__toggle">
                <button className={`new-order__toggle-btn${qtyMode === "usd" ? " new-order__toggle-btn--active" : ""}`}
                  onClick={() => setQtyMode("usd")}>USD</button>
                <button className={`new-order__toggle-btn${qtyMode === "crypto" ? " new-order__toggle-btn--active" : ""}`}
                  onClick={() => setQtyMode("crypto")}>{activeCoin?.symbol}</button>
              </div>
            </div>
            {qtyMode === "usd" ? (
              <>
                <div className="new-order__prefix-wrap">
                  <span className="new-order__prefix">$</span>
                  <input className="order-edit__input new-order__prefixed" type="number"
                    min="0" step="any" value={usdAmount}
                    onChange={e => onUsd(e.target.value)} placeholder="0.00" />
                </div>
                {cryptoQty && <span className="new-order__hint">≈ {cryptoQty} {activeCoin?.symbol}</span>}
              </>
            ) : (
              <>
                <input className="order-edit__input" type="number"
                  min="0" step="any" value={cryptoQty}
                  onChange={e => onCrypto(e.target.value)} placeholder="0.000000" />
                {usdAmount && <span className="new-order__hint">≈ ${usdAmount}</span>}
              </>
            )}
          </div>

          <div className="new-order__divider"><span>OCO Prices</span></div>

          {/* Direction hint */}
          {badDirection && (
            <div className="new-order__dir-hint">
              <i className="fa-solid fa-triangle-exclamation" />
              TP ha d'estar per sobre del preu actual · SL per sota
            </div>
          )}

          {/* Take Profit */}
          <div className="order-edit__field">
            <span className="order-edit__label">
              <i className="fa-solid fa-circle new-order__tp-dot" /> Take Profit Price
              <span className="new-order__field-hint">per sobre del preu d'entrada</span>
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
              <span className="new-order__field-hint">per sota del preu d'entrada</span>
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
                      Preu d'activació
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
            {(["5m", "1h", "4h"] as const).map(iv => (
              <button key={iv}
                className={`new-order__interval-btn${analysisInterval === iv ? " new-order__interval-btn--active" : ""}`}
                onClick={() => setAnalysisInterval(iv)}>
                {iv}
              </button>
            ))}
            {analysisLoading && <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: "0.65rem", color: "var(--text-3)", marginLeft: 4 }} />}
          </div>

          {analysisSnap && (
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

          {/* USDT amount */}
          <div className="order-edit__field">
            <div className="new-order__label-row">
              <span className="order-edit__label">Import USDT</span>
              <span className="new-order__balance-hint">
                Saldo: {formatCurrency(balances["USDT"] ?? 0)} USDT
              </span>
            </div>
            <div className="new-order__prefix-wrap">
              <span className="new-order__prefix">$</span>
              <input className="order-edit__input new-order__prefixed" type="number"
                min="0" step="any" value={beUsdAmount}
                onChange={e => setBeUsdAmount(e.target.value)} placeholder="0.00" />
            </div>
          </div>

          <div className="new-order__divider"><span>Sortida automàtica</span></div>

          {/* TP % */}
          <div className="order-edit__field">
            <span className="order-edit__label">
              <i className="fa-solid fa-circle new-order__tp-dot" /> Take Profit %
            </span>
            <div className="new-order__price-row">
              <input className="order-edit__input new-order__pct-pos" type="number"
                min="0.01" step="0.01" value={beTpPct}
                onChange={e => setBeTpPct(e.target.value)} />
              <div className="new-order__pct-wrap">
                <span className="new-order__pct-computed">
                  {ref && beTpPct ? (ref * (1 + parseFloat(beTpPct) / 100)).toFixed(ref >= 100 ? 2 : ref >= 1 ? 4 : 6) : "—"}
                </span>
                <span className="new-order__pct-sign">%</span>
              </div>
            </div>
          </div>

          {/* SL % */}
          <div className="order-edit__field">
            <span className="order-edit__label">
              <i className="fa-solid fa-circle new-order__sl-dot" /> Stop Loss %
              <span className="new-order__field-hint">SL Limit offset fix 0.1%</span>
            </span>
            <div className="new-order__price-row">
              <input className="order-edit__input new-order__pct-neg" type="number"
                min="0.01" step="0.01" value={beSlPct}
                onChange={e => setBeSlPct(e.target.value)} />
              <div className="new-order__pct-wrap">
                <span className="new-order__pct-computed">
                  {ref && beSlPct ? (ref * (1 - parseFloat(beSlPct) / 100)).toFixed(ref >= 100 ? 2 : ref >= 1 ? 4 : 6) : "—"}
                </span>
                <span className="new-order__pct-sign">%</span>
              </div>
            </div>
          </div>

          {/* Trailing Stop (reused) */}
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
                      Preu d'activació
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
                {!trailingLoading && trailingAtr === 0 && (
                  <div className="new-order__trailing-logic" style={{ color: "var(--text-3)" }}>
                    Introdueix els valors manualment o espera que carregui la suggerència.
                  </div>
                )}
              </div>
            )}
          </div>

          </> /* end mode === "buy-exit" */}

          {error && <div className="order-edit__error">{error}</div>}
        </div>

        <div className="order-edit__footer">
          <button className="order-edit__btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
          {mode === "oco" ? (
            <button className="order-edit__btn-save" onClick={submit} disabled={saving || badDirection}>
              {saving ? "Placing…" : "Col·locar SELL OCO"}
            </button>
          ) : (
            <button className="order-edit__btn-save" onClick={submitBuyExit} disabled={saving}>
              {saving ? "Placing…" : "Compra + Sortida"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
