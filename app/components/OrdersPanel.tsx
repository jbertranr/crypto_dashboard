"use client";
import { useEffect, useState, useCallback } from "react";
import { BinanceOrder, BinanceBalance, BinanceTrade } from "../lib/binance-auth";
import { formatCurrency } from "../lib/format";
import { CoinRow } from "../lib/types";
import NewOrderModal from "./NewOrderModal";
import PortfolioTab from "./PortfolioTab";
import AnalysisTab from "./AnalysisTab";
import OcoProgressChart from "./OcoProgressChart";
import CoinIcon from "./CoinIcon";

type Tab = "portfolio" | "open" | "history" | "balance" | "analysis";

/* ── Strategies ── */
export const STRATEGIES = [
  { name: "Swing",    color: "#6366f1" },
  { name: "Scalp",    color: "#f59e0b" },
  { name: "DCA",      color: "#10b981" },
  { name: "Breakout", color: "#ef4444" },
  { name: "Hedge",    color: "#8b5cf6" },
] as const;

export type StrategyName = (typeof STRATEGIES)[number]["name"];
const STRATEGY_MAP = Object.fromEntries(STRATEGIES.map(s => [s.name, s.color])) as Record<string, string>;

function stratKey(kind: "oco" | "ord", id: number): string {
  return `${kind}:${id}`;
}

function StrategyPicker({ orderKey, current, onSelect, onClose }: {
  orderKey: string;
  current: string | null;
  onSelect: (key: string, strategy: string | null) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="strategy-picker__backdrop" onClick={onClose} />
      <div className="strategy-picker__popover">
        {STRATEGIES.map(s => (
          <button
            key={s.name}
            className={`strategy-picker__option${current === s.name ? " strategy-picker__option--active" : ""}`}
            onClick={() => { onSelect(orderKey, current === s.name ? null : s.name); onClose(); }}
          >
            <span className="strategy-picker__dot" style={{ background: s.color }} />
            {s.name}
          </button>
        ))}
        {current && (
          <button className="strategy-picker__remove" onClick={() => { onSelect(orderKey, null); onClose(); }}>
            <i className="fa-solid fa-xmark" /> Treure
          </button>
        )}
      </div>
    </>
  );
}

const TYPE_MAP: Record<string, { label: string; cls: string }> = {
  LIMIT:             { label: "LIMIT",  cls: "pill--limit" },
  LIMIT_MAKER:       { label: "TP",     cls: "pill--tp"    },
  MARKET:            { label: "MKT",    cls: "pill--limit" },
  STOP_LOSS_LIMIT:   { label: "SL",     cls: "pill--sl"    },
  STOP_LOSS:         { label: "SL",     cls: "pill--sl"    },
  TAKE_PROFIT_LIMIT: { label: "TP",     cls: "pill--tp"    },
};

function StatusPill({ status }: { status: string }) {
  return <span className={`pill pill--${status.toLowerCase()}`}>{status.replace(/_/g, " ")}</span>;
}

/* ── Edit target types ── */
type EditTargetSingle = {
  kind: "single";
  order: BinanceOrder;
};
type EditTargetOco = {
  kind: "oco";
  symbol: string;
  orderListId: number;
  side: "BUY" | "SELL";
  quantity: string;
  tpOrder: BinanceOrder;  // LIMIT_MAKER
  slOrder: BinanceOrder;  // STOP_LOSS_LIMIT
};
type EditTarget = EditTargetSingle | EditTargetOco;

/* ── Edit modal ── */
function EditModal({ target, onClose, onSuccess }: {
  target: EditTarget;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const isOco = target.kind === "oco";

  const initPrice = isOco
    ? (target as EditTargetOco).tpOrder.price
    : (target as EditTargetSingle).order.price;
  const initStopPrice = isOco
    ? (target as EditTargetOco).slOrder.stopPrice
    : (target as EditTargetSingle).order.stopPrice;
  const initSlLimit = isOco
    ? (target as EditTargetOco).slOrder.price
    : "";

  const [price,        setPrice]        = useState(initPrice);
  const [stopPrice,    setStopPrice]    = useState(initStopPrice);
  const [slLimitPrice, setSlLimitPrice] = useState(initSlLimit);
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState<string | null>(null);

  const submit = async () => {
    setSaving(true); setError(null);
    try {
      if (isOco) {
        const t = target as EditTargetOco;
        const res = await fetch("/api/orders/replace-oco", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol: t.symbol, orderListId: t.orderListId,
            side: t.side, quantity: t.quantity,
            tpPrice: price, slStopPrice: stopPrice, slLimitPrice,
          }),
        });
        const d = await res.json();
        if (d.error) throw new Error(d.error);
      } else {
        const t = target as EditTargetSingle;
        const res = await fetch("/api/orders/modify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol: t.order.symbol, orderId: t.order.orderId,
            side: t.order.side, quantity: t.order.origQty,
            price,
            ...(parseFloat(stopPrice) > 0 ? { stopPrice } : {}),
          }),
        });
        const d = await res.json();
        if (d.error) throw new Error(d.error);
      }
      onSuccess(); onClose();
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div className="order-edit__backdrop" onClick={onClose}>
      <div className="order-edit__box" onClick={e => e.stopPropagation()}>
        <div className="order-edit__header">
          <span className="order-edit__title">
            {isOco ? "Modify OCO Order" : "Modify Order"}
          </span>
          <button className="order-edit__close" onClick={onClose}>×</button>
        </div>

        <div className="order-edit__body">
          {isOco ? (
            <>
              <label className="order-edit__field">
                <span className="order-edit__label">Take Profit Price</span>
                <input className="order-edit__input" value={price}
                  onChange={e => setPrice(e.target.value)} placeholder="0.00" />
              </label>
              <label className="order-edit__field">
                <span className="order-edit__label">Stop Loss Trigger</span>
                <input className="order-edit__input" value={stopPrice}
                  onChange={e => setStopPrice(e.target.value)} placeholder="0.00" />
              </label>
              <label className="order-edit__field">
                <span className="order-edit__label">Stop Loss Limit Price</span>
                <input className="order-edit__input" value={slLimitPrice}
                  onChange={e => setSlLimitPrice(e.target.value)} placeholder="0.00" />
              </label>
            </>
          ) : (
            <>
              {parseFloat(initStopPrice) > 0 && (
                <label className="order-edit__field">
                  <span className="order-edit__label">Stop Trigger Price</span>
                  <input className="order-edit__input" value={stopPrice}
                    onChange={e => setStopPrice(e.target.value)} placeholder="0.00" />
                </label>
              )}
              <label className="order-edit__field">
                <span className="order-edit__label">Limit Price</span>
                <input className="order-edit__input" value={price}
                  onChange={e => setPrice(e.target.value)} placeholder="0.00" />
              </label>
            </>
          )}
          {error && <div className="order-edit__error">{error}</div>}
        </div>

        <div className="order-edit__footer">
          <button className="order-edit__btn-cancel" onClick={onClose} disabled={saving}>Dismiss</button>
          <button className="order-edit__btn-save" onClick={submit} disabled={saving}>
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Open Orders cards ── */
function OpenOrderTable({ orders, loading, error, onRefresh, coins, strategies, onStrategyChange }: {
  orders: BinanceOrder[]; loading: boolean; error: string | null;
  onRefresh: () => void; coins: CoinRow[];
  strategies: Record<string, string>;
  onStrategyChange: (key: string, strategy: string | null) => void;
}) {
  const [canceling,    setCanceling]    = useState<Record<number, boolean>>({});
  const [editTarget,   setEditTarget]   = useState<EditTarget | null>(null);
  const [cancelError,  setCancelError]  = useState<string | null>(null);
  const [entryPrices,  setEntryPrices]  = useState<Record<number, number>>({});
  const [openPickerKey, setOpenPickerKey] = useState<string | null>(null);
  const [filterStrategy, setFilterStrategy] = useState<string | null>(null);
  const [trailings, setTrailings] = useState<Record<number, { activateAt: number; distance: number; activateAtr: number; distanceAtr: number; logic: string }>>({});

  useEffect(() => {
    fetch("/api/orders/trailing").then(r => r.json()).then((arr: { orderListId: number; activateAt: number; distance: number; activateAtr: number; distanceAtr: number; logic: string }[]) => {
      if (!Array.isArray(arr)) return;
      const m: typeof trailings = {};
      arr.forEach(t => { m[t.orderListId] = t; });
      setTrailings(m);
    }).catch(() => {});
  }, []);

  const allSorted = [...orders].sort((a, b) => {
    if (a.orderListId !== b.orderListId) return b.orderListId - a.orderListId;
    return a.orderId - b.orderId;
  });

  // Build one logical group per OCO or single order
  type OcoGroup = {
    kind: "oco"; listId: number; symbol: string; side: "BUY" | "SELL";
    startTime: number; tpOrd: BinanceOrder; slOrd: BinanceOrder;
  };
  type SingleGroup = { kind: "single"; order: BinanceOrder };
  type Group = OcoGroup | SingleGroup;

  const groups: Group[] = [];
  const seenLists = new Set<number>();
  for (const o of allSorted) {
    if (o.orderListId === -1) {
      groups.push({ kind: "single", order: o });
    } else if (!seenLists.has(o.orderListId)) {
      seenLists.add(o.orderListId);
      const grp = allSorted.filter(x => x.orderListId === o.orderListId);
      const tpOrd = grp.find(x => x.type === "LIMIT_MAKER");
      const slOrd = grp.find(x => x.type === "STOP_LOSS_LIMIT");
      if (tpOrd && slOrd) {
        groups.push({
          kind: "oco", listId: o.orderListId,
          symbol: o.symbol, side: o.side as "BUY" | "SELL",
          startTime: Math.min(...grp.map(x => x.time)),
          tpOrd, slOrd,
        });
      }
    }
  }

  const handleCancel = async (o: BinanceOrder) => {
    setCanceling(p => ({ ...p, [o.orderId]: true }));
    setCancelError(null);
    try {
      const res = await fetch("/api/orders/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: o.symbol, orderId: o.orderId, orderListId: o.orderListId }),
      });
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      onRefresh();
    } catch (e: unknown) {
      setCancelError((e as Error).message);
    } finally {
      setCanceling(p => { const n = { ...p }; delete n[o.orderId]; return n; });
    }
  };

  const handleCancelOco = async (g: OcoGroup) => {
    setCanceling(p => ({ ...p, [g.listId]: true }));
    setCancelError(null);
    try {
      const res = await fetch("/api/orders/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: g.symbol, orderId: -1, orderListId: g.listId }),
      });
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      onRefresh();
    } catch (e: unknown) {
      setCancelError((e as Error).message);
    } finally {
      setCanceling(p => { const n = { ...p }; delete n[g.listId]; return n; });
    }
  };

  const fmtDate = (ts: number) =>
    new Date(ts).toLocaleString("en-GB", {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    });

  const dist = (target: number, current: number) => {
    if (!current) return null;
    const pct = ((target - current) / current) * 100;
    return pct;
  };

  // Per-strategy stats
  const stratStats = STRATEGIES.map(s => {
    const matched = groups.filter(g => {
      const k = g.kind === "oco" ? stratKey("oco", g.listId) : stratKey("ord", g.order.orderId);
      return strategies[k] === s.name;
    });
    if (!matched.length) return null;
    const totalVal = matched.reduce((sum, g) => {
      if (g.kind === "oco") {
        const coin = coins.find(c => c.pair === g.symbol);
        return sum + (coin ? parseFloat(g.tpOrd.origQty) * coin.price : 0);
      }
      const coin = coins.find(c => c.pair === g.order.symbol);
      return sum + (coin ? parseFloat(g.order.origQty) * coin.price : 0);
    }, 0);
    return { ...s, count: matched.length, totalVal };
  }).filter(Boolean) as { name: string; color: string; count: number; totalVal: number }[];

  const assignedKeys = new Set(groups.map(g =>
    g.kind === "oco" ? stratKey("oco", g.listId) : stratKey("ord", g.order.orderId)
  ).filter(k => strategies[k]));

  const visibleGroups = filterStrategy
    ? groups.filter(g => {
        const k = g.kind === "oco" ? stratKey("oco", g.listId) : stratKey("ord", g.order.orderId);
        return strategies[k] === filterStrategy;
      })
    : groups;

  return (
    <>
      {cancelError && <div className="state-error" style={{ margin: "0.5rem 1rem" }}>{cancelError}</div>}

      {/* Strategy stats */}
      {stratStats.length > 0 && (
        <div className="strat-stats">
          {stratStats.map(s => (
            <div key={s.name} className="strat-stats__item" style={{ borderColor: s.color }}>
              <span className="strat-stats__dot" style={{ background: s.color }} />
              <span className="strat-stats__name">{s.name}</span>
              <span className="strat-stats__count">{s.count}</span>
              {s.totalVal > 0 && <span className="strat-stats__val mono">{formatCurrency(s.totalVal)}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Filter bar */}
      {assignedKeys.size > 0 && (
        <div className="strat-filter">
          <button
            className={`strat-filter__btn${!filterStrategy ? " strat-filter__btn--active" : ""}`}
            onClick={() => setFilterStrategy(null)}>
            Totes
          </button>
          {STRATEGIES.filter(s => stratStats.find(st => st.name === s.name)).map(s => (
            <button
              key={s.name}
              className={`strat-filter__btn${filterStrategy === s.name ? " strat-filter__btn--active" : ""}`}
              style={filterStrategy === s.name ? { background: s.color, borderColor: s.color, color: "#fff" } : { borderColor: s.color, color: s.color }}
              onClick={() => setFilterStrategy(p => p === s.name ? null : s.name)}>
              <span className="strat-filter__dot" style={{ background: filterStrategy === s.name ? "#fff" : s.color }} />
              {s.name}
            </button>
          ))}
        </div>
      )}

      {loading && !orders.length ? (
        <div className="state-empty">Loading…</div>
      ) : error ? (
        <div className="state-error">{error}</div>
      ) : !groups.length ? (
        <div className="state-empty">No open orders.</div>
      ) : !visibleGroups.length ? (
        <div className="state-empty">Cap ordre amb estratègia "{filterStrategy}".</div>
      ) : (
        <div className="order-cards">
          {visibleGroups.map(g => {
            if (g.kind === "oco") {
              const coin         = coins.find(c => c.pair === g.symbol);
              const currentPrice = coin?.price ?? 0;
              const tpPrice      = parseFloat(g.tpOrd.price);
              const slPrice      = parseFloat(g.slOrd.stopPrice);
              const slLimit      = parseFloat(g.slOrd.price);
              const qty          = parseFloat(g.tpOrd.origQty);
              const valueUSD     = currentPrice ? qty * currentPrice : 0;
              const toTp         = dist(tpPrice, currentPrice);
              const toSl         = dist(slPrice, currentPrice);
              const entryP       = entryPrices[g.listId] ?? 0;
              const fromEntry    = entryP && currentPrice ? ((currentPrice - entryP) / entryP) * 100 : null;
              const isCanceling  = !!canceling[g.listId];
              const tpUp = toTp !== null && toTp > 0;
              const slUp = toSl !== null && toSl > 0;
              const ocoKey = stratKey("oco", g.listId);
              const ocoStrat = strategies[ocoKey] ?? null;

              return (
                <div key={g.listId} className="order-card">

                  {/* A) Header — context only, no numbers */}
                  <div className="order-card__header">
                    <div className="order-card__identity">
                      <CoinIcon symbol={g.symbol.replace("USDT", "")} size={20} />
                      <span className="order-card__pair">
                        {g.symbol.replace("USDT", "")}
                        <span className="order-card__quote">/USDT</span>
                      </span>
                      <span className={`pill ${g.side === "BUY" ? "pill--buy" : "pill--sell"}`}>{g.side}</span>
                      <span className="pill pill--oco">OCO</span>
                    </div>
                    <div className="order-card__header-right">
                      <span className="order-card__date">{fmtDate(g.startTime)}</span>
                      <span className="pill pill--new">Activa</span>
                      {/* Strategy badge */}
                      <div className="strategy-picker">
                        <button
                          className="strategy-picker__badge"
                          style={ocoStrat ? { background: `${STRATEGY_MAP[ocoStrat]}22`, color: STRATEGY_MAP[ocoStrat], borderColor: `${STRATEGY_MAP[ocoStrat]}66` } : {}}
                          onClick={() => setOpenPickerKey(k => k === ocoKey ? null : ocoKey)}>
                          {ocoStrat
                            ? <><span className="strategy-picker__dot" style={{ background: STRATEGY_MAP[ocoStrat] }} />{ocoStrat}</>
                            : <><i className="fa-solid fa-tag" /> Estratègia</>}
                        </button>
                        {openPickerKey === ocoKey && (
                          <StrategyPicker orderKey={ocoKey} current={ocoStrat}
                            onSelect={onStrategyChange} onClose={() => setOpenPickerKey(null)} />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* B) Order summary — entry left, TP/SL stacked right */}
                  <div className="order-summary">

                    {/* Left: position / entry */}
                    <div className="order-summary__card order-summary__card--pos">
                      <div className="order-summary__label">Import entrada</div>
                      <div className="order-summary__price mono">
                        {entryP > 0 ? formatCurrency(entryP * qty) : "—"}
                      </div>
                      {fromEntry !== null && (
                        <span className={`order-summary__delta order-summary__delta--${fromEntry >= 0 ? "up" : "down"}`}>
                          {fromEntry >= 0 ? "+" : ""}{fromEntry.toFixed(2)}%
                        </span>
                      )}
                      <div className="order-summary__mini-stats">
                        <div className="order-summary__mini-stat">
                          <span>Quantitat</span>
                          <span>{qty} {g.symbol.replace("USDT", "")}</span>
                        </div>
                        {currentPrice > 0 && (
                          <div className="order-summary__mini-stat">
                            <span>Preu actual</span>
                            <span>{formatCurrency(currentPrice)}</span>
                          </div>
                        )}
                        {valueUSD > 0 && (
                          <div className="order-summary__mini-stat">
                            <span>Valor actual</span>
                            <span>{formatCurrency(valueUSD)}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right: TP on top, SL on bottom */}
                    <div className="order-summary__right">
                      <div className="order-summary__card order-summary__card--tp">
                        <div className="order-summary__label">Take Profit</div>
                        <div className="order-summary__price mono">{formatCurrency(tpPrice)}</div>
                        {toTp !== null && (
                          <span className={`order-summary__delta order-summary__delta--${tpUp ? "up" : "down"}`}>
                            {toTp > 0 ? "+" : ""}{toTp.toFixed(2)}%
                          </span>
                        )}
                        <div className="order-summary__type">Limit Maker</div>
                      </div>

                      <div className="order-summary__card order-summary__card--sl">
                        <div className="order-summary__label">Stop Loss</div>
                        <div className="order-summary__price mono">{formatCurrency(slPrice)}</div>
                        {toSl !== null && (
                          <span className={`order-summary__delta order-summary__delta--${slUp ? "up" : "down"}`}>
                            {toSl > 0 ? "+" : ""}{toSl.toFixed(2)}%
                          </span>
                        )}
                        <div className="order-summary__type">
                          {slLimit !== slPrice ? `Limit ${formatCurrency(slLimit)}` : "Stop Limit"}
                        </div>
                      </div>
                    </div>

                  </div>

                  {/* C) Chart — always visible */}
                  <div className="order-card__chart">
                    <OcoProgressChart
                      symbol={g.symbol} startTime={g.startTime}
                      tpPrice={tpPrice} slPrice={slPrice} side={g.side}
                      onEntryPrice={p => setEntryPrices(prev => ({ ...prev, [g.listId]: p }))}
                    />
                  </div>

                  {/* Trailing stop reminder */}
                  {trailings[g.listId] && (() => {
                    const t = trailings[g.listId];
                    const reached = currentPrice > 0 && (
                      (g.side === "SELL" && currentPrice >= t.activateAt) ||
                      (g.side === "BUY"  && currentPrice <= t.activateAt)
                    );
                    return (
                      <div className={`order-trailing${reached ? " order-trailing--active" : ""}`}>
                        <div className="order-trailing__header">
                          <i className="fa-solid fa-flag-checkered" />
                          <span>Trailing Stop</span>
                          {reached && <span className="order-trailing__alert">Activa ara!</span>}
                        </div>
                        <div className="order-trailing__levels">
                          <div className="order-trailing__level">
                            <span>Activació</span>
                            <span className="mono">{formatCurrency(t.activateAt)}</span>
                            <span className="order-trailing__atr">{t.activateAtr}×ATR</span>
                          </div>
                          <div className="order-trailing__level">
                            <span>Cua</span>
                            <span className="mono">{formatCurrency(t.distance)}</span>
                            <span className="order-trailing__atr">{t.distanceAtr}×ATR</span>
                          </div>
                        </div>
                        <div className="order-trailing__logic">{t.logic}</div>
                      </div>
                    );
                  })()}

                  {/* Actions */}
                  <div className="order-card__actions">
                    <button className="order-btn order-btn--edit"
                      onClick={() => setEditTarget({
                        kind: "oco", symbol: g.symbol, orderListId: g.listId,
                        side: g.side, quantity: g.tpOrd.origQty,
                        tpOrder: g.tpOrd, slOrder: g.slOrd,
                      })}>
                      <i className="fa-solid fa-pen-to-square" /><span> Editar</span>
                    </button>
                    <button className="order-btn order-btn--cancel" disabled={isCanceling}
                      onClick={() => handleCancelOco(g)}>
                      {isCanceling
                        ? <><i className="fa-solid fa-spinner fa-spin" /><span> Cancel·lant</span></>
                        : <><i className="fa-solid fa-xmark" /><span> Cancel·lar</span></>}
                    </button>
                  </div>
                </div>
              );
            }

            /* Single order card */
            const o = g.order;
            const coin = coins.find(c => c.pair === o.symbol);
            const currentPrice = coin?.price ?? 0;
            const price     = parseFloat(o.price);
            const stopPrice = parseFloat(o.stopPrice);
            const qty       = parseFloat(o.origQty);
            const valueUSD  = currentPrice ? qty * currentPrice : 0;
            const toDist    = price > 0 && currentPrice > 0 ? dist(price, currentPrice) : null;
            const info      = TYPE_MAP[o.type] ?? { label: o.type, cls: "pill--limit" };
            const isCanceling = !!canceling[o.orderId];
            const ordKey  = stratKey("ord", o.orderId);
            const ordStrat = strategies[ordKey] ?? null;

            return (
              <div key={o.orderId} className="order-card">
                {/* Header */}
                <div className="order-card__header">
                  <div className="order-card__identity">
                    <CoinIcon symbol={o.symbol.replace("USDT", "")} size={22} />
                    <span className="order-card__pair">{o.symbol.replace("USDT", "")} <span className="order-card__quote">/ USDT</span></span>
                    <span className={`pill ${o.side === "BUY" ? "pill--buy" : "pill--sell"}`}>{o.side}</span>
                    <span className={`pill ${info.cls}`}>{info.label}</span>
                  </div>
                  <div className="order-card__header-right">
                    <span className="order-card__date">{fmtDate(o.time)}</span>
                    <div className="strategy-picker">
                      <button
                        className="strategy-picker__badge"
                        style={ordStrat ? { background: `${STRATEGY_MAP[ordStrat]}22`, color: STRATEGY_MAP[ordStrat], borderColor: `${STRATEGY_MAP[ordStrat]}66` } : {}}
                        onClick={() => setOpenPickerKey(k => k === ordKey ? null : ordKey)}>
                        {ordStrat
                          ? <><span className="strategy-picker__dot" style={{ background: STRATEGY_MAP[ordStrat] }} />{ordStrat}</>
                          : <><i className="fa-solid fa-tag" /> Estratègia</>}
                      </button>
                      {openPickerKey === ordKey && (
                        <StrategyPicker orderKey={ordKey} current={ordStrat}
                          onSelect={onStrategyChange} onClose={() => setOpenPickerKey(null)} />
                      )}
                    </div>
                  </div>
                </div>

                {/* Price level */}
                <div className="order-card__level order-card__level--single">
                  <div className="order-card__level-label">
                    <i className="fa-solid fa-tag" style={{ fontSize: "0.65rem" }} />
                    Preu ordre
                  </div>
                  <span className="order-card__level-price mono">
                    {price > 0 ? formatCurrency(price) : "MARKET"}
                  </span>
                  {toDist !== null && (
                    <span className={`order-card__dist order-card__dist--${toDist >= 0 ? "up" : "down"}`}>
                      {toDist > 0 ? "+" : ""}{toDist.toFixed(2)}%
                    </span>
                  )}
                  {stopPrice > 0 && (
                    <span className="order-card__sublabel">Trigger: {formatCurrency(stopPrice)}</span>
                  )}
                </div>

                {/* Meta */}
                <div className="order-card__meta">
                  <span className="order-card__qty">
                    <i className="fa-solid fa-layer-group" /> {qty} {o.symbol.replace("USDT", "")}
                  </span>
                  {valueUSD > 0 && (
                    <span className="order-card__value mono">≈ {formatCurrency(valueUSD)}</span>
                  )}
                  {currentPrice > 0 && (
                    <span className="order-card__current dim">Mercat: {formatCurrency(currentPrice)}</span>
                  )}
                  <StatusPill status={o.status} />
                </div>

                {/* Actions */}
                <div className="order-card__actions">
                  <button className="order-btn order-btn--edit"
                    onClick={() => setEditTarget({ kind: "single", order: o })}>
                    <i className="fa-solid fa-pen-to-square" /><span> Editar</span>
                  </button>
                  <button className="order-btn order-btn--cancel" disabled={isCanceling}
                    onClick={() => handleCancel(o)}>
                    {isCanceling
                      ? <><i className="fa-solid fa-spinner fa-spin" /><span> Cancel·lant</span></>
                      : <><i className="fa-solid fa-xmark" /><span> Cancel·lar</span></>}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editTarget && (
        <EditModal
          target={editTarget}
          onClose={() => setEditTarget(null)}
          onSuccess={onRefresh}
        />
      )}
    </>
  );
}

/* ── History table ── */
type ResultKind = "tp" | "sl" | "buy" | "sell" | "canceled" | "other";

function orderResult(o: BinanceOrder): ResultKind {
  if (o.status === "CANCELED" || o.status === "EXPIRED") return "canceled";
  if (o.status !== "FILLED") return "other";
  if (o.type === "LIMIT_MAKER")     return "tp";
  if (o.type === "STOP_LOSS_LIMIT" || o.type === "STOP_LOSS") return "sl";
  if (o.side === "BUY")  return "buy";
  if (o.side === "SELL") return "sell";
  return "other";
}

const RESULT_BADGE: Record<ResultKind, { label: string; cls: string }> = {
  tp:       { label: "TP ✓",    cls: "history-badge--tp"       },
  sl:       { label: "SL ✗",    cls: "history-badge--sl"       },
  buy:      { label: "Comprat", cls: "history-badge--buy"      },
  sell:     { label: "Venut",   cls: "history-badge--sell"     },
  canceled: { label: "Cancel.", cls: "history-badge--canceled" },
  other:    { label: "—",       cls: "history-badge--other"    },
};

function HistoryTable({ orders, loading, error }: {
  orders: BinanceOrder[]; loading: boolean; error: string | null;
}) {
  const [trades,    setTrades]    = useState<BinanceTrade[]>([]);
  const [loadingT,  setLoadingT]  = useState(true);

  useEffect(() => {
    setLoadingT(true);
    fetch("/api/trades").then(r => r.json())
      .then(d => { if (!d.error) setTrades(d); })
      .finally(() => setLoadingT(false));
  }, []);

  if (loading || loadingT) return <div className="state-empty">Loading…</div>;
  if (error)   return <div className="state-error">{error}</div>;
  if (!orders.length) return <div className="state-empty">No orders found.</div>;

  // Commission map: orderId → { total, asset }
  const commMap: Record<number, { total: number; asset: string }> = {};
  for (const t of trades) {
    const c = parseFloat(t.commission);
    if (!commMap[t.orderId]) commMap[t.orderId] = { total: 0, asset: t.commissionAsset };
    commMap[t.orderId].total += c;
  }

  const sorted = [...orders].sort((a, b) => b.updateTime - a.updateTime);

  const fmtDate = (ts: number) =>
    new Date(ts).toLocaleString("en-GB", {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    });

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="data-table">
        <thead className="data-table__head">
          <tr>
            <th>Pair</th>
            <th>Resultat</th>
            <th className="r">Preu exec.</th>
            <th className="r">Valor exec.</th>
            <th className="r history-col-comm">Comissió</th>
            <th className="r data-table__col-date">Data</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((o) => {
            const result    = orderResult(o);
            const badge     = RESULT_BADGE[result];
            const execQty   = parseFloat(o.executedQty);
            const price     = parseFloat(o.price);
            const execVal   = execQty > 0 && price > 0 ? execQty * price : 0;
            const comm      = commMap[o.orderId];
            const rowCls    = result === "tp" ? " history-row--tp"
                            : result === "sl" ? " history-row--sl"
                            : result === "buy" ? " history-row--buy"
                            : result === "canceled" ? " history-row--dim"
                            : "";
            return (
              <tr key={o.orderId} className={`data-table__row${rowCls}`}>
                <td className="data-table__cell">
                  <div className="symbol-col">
                    <span className="symbol-col__name">{o.symbol.replace("USDT", "")}</span>
                    {o.orderListId !== -1 && <span className="symbol-col__tag">OCO</span>}
                  </div>
                </td>
                <td className="data-table__cell">
                  <span className={`history-badge ${badge.cls}`}>{badge.label}</span>
                </td>
                <td className="data-table__cell r mono">
                  {price > 0 ? formatCurrency(price) : <span className="dim">—</span>}
                </td>
                <td className="data-table__cell r mono bold">
                  {execVal > 0 ? formatCurrency(execVal) : <span className="dim">—</span>}
                </td>
                <td className="data-table__cell r mono history-col-comm">
                  {comm ? (
                    <span className="history-comm">
                      {comm.total.toFixed(6)} <span className="dim">{comm.asset}</span>
                    </span>
                  ) : <span className="dim">—</span>}
                </td>
                <td className="data-table__cell r dim data-table__col-date" style={{ whiteSpace: "nowrap" }}>
                  {fmtDate(o.updateTime || o.time)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── Balance table ── */
function BalanceTable({ balances, loading, error }: {
  balances: BinanceBalance[]; loading: boolean; error: string | null;
}) {
  if (loading) return <div className="state-empty">Loading…</div>;
  if (error)   return <div className="state-error">{error}</div>;
  if (!balances.length) return <div className="state-empty">No assets with balance.</div>;

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="data-table">
        <thead className="data-table__head">
          <tr>
            <th>Asset</th>
            <th className="r">Free</th>
            <th className="r">Locked</th>
            <th className="r">Total</th>
          </tr>
        </thead>
        <tbody>
          {balances.map((b) => {
            const free = parseFloat(b.free), locked = parseFloat(b.locked);
            return (
              <tr key={b.asset} className="data-table__row">
                <td className="data-table__cell bold">{b.asset}</td>
                <td className="data-table__cell r"><span className="bal-free">{free.toFixed(6)}</span></td>
                <td className="data-table__cell r"><span className="bal-locked">{locked.toFixed(6)}</span></td>
                <td className="data-table__cell r"><span className="bal-total">{(free + locked).toFixed(6)}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── Main panel ── */
export default function OrdersPanel({ coins }: { coins: CoinRow[] }) {
  const [tab,          setTab]          = useState<Tab>("portfolio");
  const [showNewOrder, setShowNewOrder] = useState(false);
  const [openOrders, setOpenOrders] = useState<BinanceOrder[]>([]);
  const [history,    setHistory]    = useState<BinanceOrder[]>([]);
  const [balances,   setBalances]   = useState<BinanceBalance[]>([]);
  const [loadingO, setLoadingO] = useState(false);
  const [loadingH, setLoadingH] = useState(false);
  const [loadingB, setLoadingB] = useState(false);
  const [errorO, setErrorO] = useState<string | null>(null);
  const [errorH, setErrorH] = useState<string | null>(null);
  const [errorB, setErrorB] = useState<string | null>(null);
  const [refreshMs,      setRefreshMs]      = useState(15000);
  const [lastRefreshed,  setLastRefreshed]  = useState<Date | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [strategies, setStrategies] = useState<Record<string, string>>({});
  const [newOrderPrefill, setNewOrderPrefill] = useState<{
    pair: string; side: "BUY" | "SELL"; tp: string; sl: string; slLimit: string;
  } | null>(null);

  const fmtRefreshed = (d: Date) =>
    d.toLocaleTimeString("ca-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  const fetchOpen = useCallback(() => {
    setLoadingO(true); setErrorO(null);
    fetch("/api/orders").then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setOpenOrders(d); setLastRefreshed(new Date()); })
      .catch(e => setErrorO(e.message)).finally(() => setLoadingO(false));
  }, []);

  const fetchHistory = useCallback(() => {
    setLoadingH(true); setErrorH(null);
    fetch("/api/orders/history").then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setHistory(d); })
      .catch(e => setErrorH(e.message)).finally(() => setLoadingH(false));
  }, []);

  const fetchBalance = useCallback(() => {
    setLoadingB(true); setErrorB(null);
    fetch("/api/balance").then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setBalances(d); })
      .catch(e => setErrorB(e.message)).finally(() => setLoadingB(false));
  }, []);

  useEffect(() => {
    fetchOpen();
    if (refreshMs === 0) return;
    const id = setInterval(fetchOpen, refreshMs);
    return () => clearInterval(id);
  }, [fetchOpen, refreshMs]);

  useEffect(() => {
    if (tab === "history" && !history.length && !loadingH) fetchHistory();
  }, [tab, history.length, loadingH, fetchHistory]);

  useEffect(() => {
    if (tab === "balance" && !balances.length && !loadingB) fetchBalance();
  }, [tab, balances.length, loadingB, fetchBalance]);

  // Load strategies once on mount
  useEffect(() => {
    fetch("/api/strategies").then(r => r.json()).then(d => { if (!d.error) setStrategies(d); });
  }, []);

  const handleStrategyChange = useCallback((key: string, strategy: string | null) => {
    setStrategies(prev => {
      const next = { ...prev };
      if (strategy) next[key] = strategy; else delete next[key];
      return next;
    });
    fetch("/api/strategies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, strategy }),
    });
  }, []);

  const handleOpenOrderFromAnalysis = useCallback((
    pair: string, side: "BUY" | "SELL", tp: string, sl: string, slLimit: string,
  ) => {
    setNewOrderPrefill({ pair, side, tp, sl, slLimit });
    setShowNewOrder(true);
  }, []);

  const TABS: { key: Tab; label: string; icon: string }[] = [
    { key: "portfolio", label: "Portfolio",                                             icon: "fa-wallet"     },
    { key: "open",      label: `Open Orders${openOrders.length ? ` (${openOrders.length})` : ""}`, icon: "fa-list-check" },
    { key: "history",   label: "History",                                               icon: "fa-clock-rotate-left" },
    { key: "balance",   label: "Balance",                                               icon: "fa-coins"      },
    { key: "analysis",  label: "Anàlisi",                                               icon: "fa-magnifying-glass-chart" },
  ];

  return (
    <div className="card">
      <div className="tabs">
        {TABS.map(({ key, label, icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`tabs__btn${tab === key ? " tabs__btn--active" : ""}`}>
            <i className={`fa-solid ${icon}`} />
            {label}
          </button>
        ))}
        <div className="tabs__end">
          <button className="tabs__action tabs__action--new" onClick={() => setShowNewOrder(true)}>
            <i className="fa-solid fa-plus" /> Nova ordre
          </button>
          <div className="refresh-controls">
            <select className="refresh-select" value={refreshMs}
              onChange={e => setRefreshMs(Number(e.target.value))}>
              <option value={5000}>5s</option>
              <option value={15000}>15s</option>
              <option value={30000}>30s</option>
              <option value={60000}>1 min</option>
              <option value={0}>Manual</option>
            </select>
            <button className="refresh-btn" title="Refresca ara" onClick={() => {
              fetchOpen();
              setRefreshTrigger(n => n + 1);
              if (tab === "history") fetchHistory();
              if (tab === "balance") fetchBalance();
            }}>
              <i className="fa-solid fa-rotate-right" /> Refresca
            </button>
          </div>
        </div>
      </div>

      {tab === "portfolio" && <PortfolioTab coins={coins} openOrders={openOrders} refreshTrigger={refreshTrigger} />}
      {tab === "open"      && <OpenOrderTable orders={openOrders} loading={loadingO} error={errorO} onRefresh={fetchOpen} coins={coins} strategies={strategies} onStrategyChange={handleStrategyChange} />}
      {tab === "history"   && <HistoryTable   orders={history}    loading={loadingH} error={errorH} />}
      {tab === "balance"   && <BalanceTable   balances={balances} loading={loadingB} error={errorB} />}
      {tab === "analysis"  && <AnalysisTab onOpenOrder={handleOpenOrderFromAnalysis} />}

      <div className="panel-footer">
        <span className="panel-footer__dot" />
        Binance Demo · {refreshMs === 0 ? "refresc manual" : `auto-refresh ${refreshMs / 1000}s`}
        {lastRefreshed && (
          <span className="panel-footer__right">
            <span className="panel-footer__refreshed">
              <i className="fa-solid fa-clock" />
              {fmtRefreshed(lastRefreshed)}
            </span>
          </span>
        )}
      </div>

      {showNewOrder && (
        <NewOrderModal
          coin={newOrderPrefill ? (coins.find(c => c.pair === newOrderPrefill.pair) ?? null) : null}
          coins={coins}
          onClose={() => { setShowNewOrder(false); setNewOrderPrefill(null); }}
          onSuccess={() => { setShowNewOrder(false); setNewOrderPrefill(null); fetchOpen(); }}
          presetPrices={newOrderPrefill ? {
            side: newOrderPrefill.side,
            tp: newOrderPrefill.tp,
            sl: newOrderPrefill.sl,
            slLimit: newOrderPrefill.slLimit,
          } : undefined}
        />
      )}
    </div>
  );
}
