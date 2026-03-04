"use client";
import { useEffect, useState, useCallback } from "react";
import { BinanceOrder, BinanceBalance } from "../lib/binance-auth";
import { formatCurrency } from "../lib/api";
import { CoinRow } from "../lib/types";
import NewOrderModal from "./NewOrderModal";
import PortfolioTab from "./PortfolioTab";
import OcoProgressChart from "./OcoProgressChart";
import CoinIcon from "./CoinIcon";

type Tab = "portfolio" | "open" | "history" | "balance";

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
function OpenOrderTable({ orders, loading, error, onRefresh, coins }: {
  orders: BinanceOrder[]; loading: boolean; error: string | null;
  onRefresh: () => void; coins: CoinRow[];
}) {
  const [canceling,    setCanceling]    = useState<Record<number, boolean>>({});
  const [editTarget,   setEditTarget]   = useState<EditTarget | null>(null);
  const [cancelError,  setCancelError]  = useState<string | null>(null);
  const [entryPrices,  setEntryPrices]  = useState<Record<number, number>>({});

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

  return (
    <>
      {cancelError && <div className="state-error" style={{ margin: "0.5rem 1rem" }}>{cancelError}</div>}

      {loading && !orders.length ? (
        <div className="state-empty">Loading…</div>
      ) : error ? (
        <div className="state-error">{error}</div>
      ) : !groups.length ? (
        <div className="state-empty">No open orders.</div>
      ) : (
        <div className="order-cards">
          {groups.map(g => {
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
                    </div>
                  </div>

                  {/* B) Order summary — 3-card grid */}
                  <div className="order-summary">
                    {/* TP card */}
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

                    {/* SL card */}
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

                    {/* Position card */}
                    <div className="order-summary__card order-summary__card--pos">
                      <div className="order-summary__label">Preu actual</div>
                      <div className="order-summary__price mono">
                        {currentPrice > 0 ? formatCurrency(currentPrice) : "—"}
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
                        {valueUSD > 0 && (
                          <div className="order-summary__mini-stat">
                            <span>Exposició</span>
                            <span>{formatCurrency(valueUSD)}</span>
                          </div>
                        )}
                        {entryP > 0 && (
                          <div className="order-summary__mini-stat">
                            <span>Entrada aprox.</span>
                            <span>{formatCurrency(entryP)}</span>
                          </div>
                        )}
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

                  {/* Actions */}
                  <div className="order-card__actions">
                    <button className="order-btn order-btn--edit"
                      onClick={() => setEditTarget({
                        kind: "oco", symbol: g.symbol, orderListId: g.listId,
                        side: g.side, quantity: g.tpOrd.origQty,
                        tpOrder: g.tpOrd, slOrder: g.slOrd,
                      })}>
                      <i className="fa-solid fa-pen-to-square" /> Editar
                    </button>
                    <button className="order-btn order-btn--cancel" disabled={isCanceling}
                      onClick={() => handleCancelOco(g)}>
                      {isCanceling
                        ? <><i className="fa-solid fa-spinner fa-spin" /> Cancel·lant</>
                        : <><i className="fa-solid fa-xmark" /> Cancel·lar</>}
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
                  <span className="order-card__date">{fmtDate(o.time)}</span>
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
                    <i className="fa-solid fa-pen-to-square" /> Editar
                  </button>
                  <button className="order-btn order-btn--cancel" disabled={isCanceling}
                    onClick={() => handleCancel(o)}>
                    {isCanceling
                      ? <><i className="fa-solid fa-spinner fa-spin" /> Cancel·lant</>
                      : <><i className="fa-solid fa-xmark" /> Cancel·lar</>}
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
function HistoryTable({ orders, loading, error }: {
  orders: BinanceOrder[]; loading: boolean; error: string | null;
}) {
  if (loading) return <div className="state-empty">Loading…</div>;
  if (error)   return <div className="state-error">{error}</div>;
  if (!orders.length) return <div className="state-empty">No orders found.</div>;

  const sorted = [...orders].sort((a, b) => {
    if (a.orderListId !== b.orderListId) return b.orderListId - a.orderListId;
    return a.orderId - b.orderId;
  });

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="data-table">
        <thead className="data-table__head">
          <tr>
            <th>Pair</th>
            <th>Side</th>
            <th>Type</th>
            <th className="r data-table__col-trigger">Trigger</th>
            <th className="r">Price</th>
            <th className="r">Quantity</th>
            <th>Status</th>
            <th className="r data-table__col-date">Date</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((o, i) => {
            const price     = parseFloat(o.price);
            const stopPrice = parseFloat(o.stopPrice);
            const info      = TYPE_MAP[o.type] ?? { label: o.type, cls: "pill--limit" };
            const prev      = i > 0 ? sorted[i - 1].orderListId : -1;
            const newGroup  = o.orderListId !== -1 && o.orderListId !== prev;
            return (
              <tr key={o.orderId} className={`data-table__row${newGroup && i > 0 ? " data-table__row--sep" : ""}`}>
                <td className="data-table__cell">
                  <div className="symbol-col">
                    <span className="symbol-col__name">{o.symbol.replace("USDT", "")}</span>
                    {o.orderListId !== -1 && <span className="symbol-col__tag">OCO</span>}
                  </div>
                </td>
                <td className="data-table__cell">
                  <span className={`pill ${o.side === "BUY" ? "pill--buy" : "pill--sell"}`}>{o.side}</span>
                </td>
                <td className="data-table__cell">
                  <span className={`pill ${info.cls}`}>{info.label}</span>
                </td>
                <td className="data-table__cell r mono dim data-table__col-trigger">
                  {stopPrice > 0 ? formatCurrency(stopPrice) : "—"}
                </td>
                <td className="data-table__cell r mono bold">
                  {price > 0 ? formatCurrency(price) : "MARKET"}
                </td>
                <td className="data-table__cell r mono">{o.origQty}</td>
                <td className="data-table__cell"><StatusPill status={o.status} /></td>
                <td className="data-table__cell r dim data-table__col-date" style={{ whiteSpace: "nowrap" }}>
                  {new Date(o.time).toLocaleString("en-GB", {
                    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                  })}
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
  const [refreshMs, setRefreshMs] = useState(15000);

  const fetchOpen = useCallback(() => {
    setLoadingO(true); setErrorO(null);
    fetch("/api/orders").then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setOpenOrders(d); })
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

  const TABS: { key: Tab; label: string; icon: string }[] = [
    { key: "portfolio", label: "Portfolio",                                             icon: "fa-wallet"     },
    { key: "open",      label: `Open Orders${openOrders.length ? ` (${openOrders.length})` : ""}`, icon: "fa-list-check" },
    { key: "history",   label: "History",                                               icon: "fa-clock-rotate-left" },
    { key: "balance",   label: "Balance",                                               icon: "fa-coins"      },
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
              if (tab === "history") fetchHistory();
              if (tab === "balance") fetchBalance();
            }}>
              <i className="fa-solid fa-rotate-right" /> Refresca
            </button>
          </div>
        </div>
      </div>

      {tab === "portfolio" && <PortfolioTab coins={coins} openOrderCount={openOrders.length} />}
      {tab === "open"      && <OpenOrderTable orders={openOrders} loading={loadingO} error={errorO} onRefresh={fetchOpen} coins={coins} />}
      {tab === "history"   && <HistoryTable   orders={history}    loading={loadingH} error={errorH} />}
      {tab === "balance"   && <BalanceTable   balances={balances} loading={loadingB} error={errorB} />}

      {tab !== "portfolio" && (
        <div className="panel-footer">
          <span className="panel-footer__dot" />
          Binance Demo · {refreshMs === 0 ? "refresc manual" : `auto-refresh ${refreshMs / 1000}s`}
        </div>
      )}

      {showNewOrder && (
        <NewOrderModal
          coin={null}
          coins={coins}
          onClose={() => setShowNewOrder(false)}
          onSuccess={() => { setShowNewOrder(false); fetchOpen(); }}
        />
      )}
    </div>
  );
}
