"use client";
import { useEffect, useState, useCallback } from "react";
import { CoinRow } from "../lib/types";
import { formatCurrency } from "../lib/api";
import CoinIcon from "./CoinIcon";

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

export default function NewOrderModal({ coin, coins, onClose, onSuccess }: {
  coin: CoinRow | null;
  coins: CoinRow[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const defaultCoin = coin ?? coins[0];
  const [selectedPair, setSelectedPair] = useState(defaultCoin?.pair ?? "");
  const activeCoin = coins.find(c => c.pair === selectedPair) ?? defaultCoin;
  const ref = activeCoin?.price ?? 0;

  /* exchange filters */
  const [stepSize, setStepSize] = useState("0.00001");
  const [tickSize, setTickSize] = useState("0.01");

  /* form state */
  const [side,         setSide]         = useState<"BUY" | "SELL">("SELL");
  const [qtyMode,      setQtyMode]      = useState<"usd" | "crypto">("usd");
  const [usdAmount,    setUsdAmount]    = useState("");
  const [cryptoQty,    setCryptoQty]    = useState("");
  const [tpPrice,      setTpPrice]      = useState("");
  const [tpPct,        setTpPct]        = useState("");
  const [slStopPrice,  setSlStopPrice]  = useState("");
  const [slStopPct,    setSlStopPct]    = useState("");
  const [slLimitPrice, setSlLimitPrice] = useState("");
  const [slLimitPct,   setSlLimitPct]   = useState("");
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState<string | null>(null);

  /* fetch exchange filters when pair changes */
  useEffect(() => {
    if (!selectedPair) return;
    fetch(`/api/exchange-info?symbol=${selectedPair}`)
      .then(r => r.json())
      .then(d => { if (d.stepSize) setStepSize(d.stepSize); if (d.tickSize) setTickSize(d.tickSize); })
      .catch(() => {});
  }, [selectedPair]);

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
    prefill(ref, side, tickSize);
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

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

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
      setError(side === "SELL"
        ? "For a SELL OCO: Take Profit must be above current price and Stop Loss below."
        : "For a BUY OCO: Take Profit must be below current price and Stop Loss above.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/orders/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: activeCoin.pair, side, quantity: qty,
          tpPrice, slStopPrice, slLimitPrice,
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
          <span className="new-order__title">New OCO Order</span>
          <button className="order-edit__close" onClick={onClose}>×</button>
        </div>

        <div className="new-order__body">

          {/* Symbol */}
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

          {/* Side */}
          <div className="order-edit__field">
            <span className="order-edit__label">Side</span>
            <div className="new-order__side">
              <button
                className={`new-order__side-btn new-order__side-btn--sell${side === "SELL" ? " new-order__side-btn--active" : ""}`}
                onClick={() => setSide("SELL")}>
                <i className="fa-solid fa-arrow-down" /> SELL
              </button>
              <button
                className={`new-order__side-btn new-order__side-btn--buy${side === "BUY" ? " new-order__side-btn--active" : ""}`}
                onClick={() => setSide("BUY")}>
                <i className="fa-solid fa-arrow-up" /> BUY
              </button>
            </div>
          </div>

          {/* Quantity */}
          <div className="order-edit__field">
            <div className="new-order__label-row">
              <span className="order-edit__label">Quantity</span>
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
              {side === "SELL"
                ? "SELL OCO: TP must be above current price · SL must be below"
                : "BUY OCO: TP must be below current price · SL must be above"}
            </div>
          )}

          {/* Take Profit */}
          <div className="order-edit__field">
            <span className="order-edit__label">
              <i className="fa-solid fa-circle new-order__tp-dot" /> Take Profit Price
              <span className="new-order__field-hint">
                {side === "SELL" ? "above current" : "below current"}
              </span>
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
              <span className="new-order__field-hint">
                {side === "SELL" ? "below current" : "above current"}
              </span>
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

          {error && <div className="order-edit__error">{error}</div>}
        </div>

        <div className="order-edit__footer">
          <button className="order-edit__btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="order-edit__btn-save" onClick={submit} disabled={saving || badDirection}>
            {saving ? "Placing…" : `Place ${side} OCO`}
          </button>
        </div>
      </div>
    </div>
  );
}
