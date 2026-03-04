"use client";
import { useEffect, useState, useCallback } from "react";
import { BinanceOrder, BinanceBalance } from "../lib/binance-auth";
import { formatCurrency } from "../lib/api";
import { CoinRow } from "../lib/types";
import NewOrderModal from "./NewOrderModal";

type Tab = "open" | "history" | "balance";

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

/* ── Open Orders table ── */
function OpenOrderTable({ orders, loading, error, onRefresh }: {
  orders: BinanceOrder[]; loading: boolean; error: string | null; onRefresh: () => void;
}) {
  const [canceling,   setCanceling]   = useState<number | null>(null);
  const [editTarget,  setEditTarget]  = useState<EditTarget | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const sorted = [...orders].sort((a, b) => {
    if (a.orderListId !== b.orderListId) return b.orderListId - a.orderListId;
    return a.orderId - b.orderId;
  });

  const handleCancel = async (o: BinanceOrder) => {
    setCanceling(o.orderId); setCancelError(null);
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
      setCanceling(null);
    }
  };

  const handleEdit = (o: BinanceOrder, allOrders: BinanceOrder[]) => {
    if (o.orderListId !== -1) {
      const group = allOrders.filter(x => x.orderListId === o.orderListId);
      const tpOrder = group.find(x => x.type === "LIMIT_MAKER");
      const slOrder = group.find(x => x.type === "STOP_LOSS_LIMIT");
      if (tpOrder && slOrder) {
        setEditTarget({
          kind: "oco",
          symbol: o.symbol,
          orderListId: o.orderListId,
          side: o.side,
          quantity: tpOrder.origQty,
          tpOrder, slOrder,
        });
        return;
      }
    }
    setEditTarget({ kind: "single", order: o });
  };

  // Track which OCO groups we've already rendered an edit button for
  const renderedOcoEdit = new Set<number>();

  return (
    <>
      {cancelError && <div className="state-error" style={{ margin: "0.5rem 1rem" }}>{cancelError}</div>}

      {loading ? (
        <div className="state-empty">Loading…</div>
      ) : error ? (
        <div className="state-error">{error}</div>
      ) : !orders.length ? (
        <div className="state-empty">No open orders.</div>
      ) : (
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
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((o, i) => {
              const price     = parseFloat(o.price);
              const stopPrice = parseFloat(o.stopPrice);
              const info      = TYPE_MAP[o.type] ?? { label: o.type, cls: "pill--limit" };
              const prev      = i > 0 ? sorted[i - 1].orderListId : -1;
              const newGroup  = o.orderListId !== -1 && o.orderListId !== prev;
              const isCanceling = canceling === o.orderId;

              // For OCO, show edit only on first row of the group
              let showEdit = false;
              if (o.orderListId === -1) {
                showEdit = true;
              } else if (!renderedOcoEdit.has(o.orderListId)) {
                showEdit = true;
                renderedOcoEdit.add(o.orderListId);
              }

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
                  <td className="data-table__cell order-actions">
                    {showEdit && (
                      <button className="order-btn order-btn--edit"
                        title="Modify order" onClick={() => handleEdit(o, sorted)}>
                        <i className="fa-solid fa-pen-to-square" />
                      </button>
                    )}
                    <button className="order-btn order-btn--cancel"
                      title="Cancel order" disabled={isCanceling}
                      onClick={() => handleCancel(o)}>
                      {isCanceling
                        ? <i className="fa-solid fa-spinner fa-spin" />
                        : <i className="fa-solid fa-xmark" />}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
  const [tab,          setTab]          = useState<Tab>("open");
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
    const id = setInterval(fetchOpen, 15000);
    return () => clearInterval(id);
  }, [fetchOpen]);

  useEffect(() => {
    if (tab === "history" && !history.length && !loadingH) fetchHistory();
  }, [tab, history.length, loadingH, fetchHistory]);

  useEffect(() => {
    if (tab === "balance" && !balances.length && !loadingB) fetchBalance();
  }, [tab, balances.length, loadingB, fetchBalance]);

  const TABS: { key: Tab; label: string }[] = [
    { key: "open",    label: `Open Orders${openOrders.length ? ` (${openOrders.length})` : ""}` },
    { key: "history", label: "History" },
    { key: "balance", label: "Balance" },
  ];

  return (
    <div className="card">
      <div className="tabs">
        {TABS.map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`tabs__btn${tab === key ? " tabs__btn--active" : ""}`}>
            {label}
          </button>
        ))}
        <div className="tabs__end">
          <button className="tabs__action tabs__action--new" onClick={() => setShowNewOrder(true)}>
            <i className="fa-solid fa-plus" /> New Order
          </button>
          <button className="tabs__action" onClick={() => {
            fetchOpen();
            if (tab === "history") fetchHistory();
            if (tab === "balance") fetchBalance();
          }}>↻ Refresh</button>
        </div>
      </div>

      {tab === "open"    && <OpenOrderTable orders={openOrders} loading={loadingO} error={errorO} onRefresh={fetchOpen} />}
      {tab === "history" && <HistoryTable   orders={history}    loading={loadingH} error={errorH} />}
      {tab === "balance" && <BalanceTable   balances={balances} loading={loadingB} error={errorB} />}

      <div className="panel-footer">
        <span className="panel-footer__dot" />
        Binance Demo · auto-refresh 15s
      </div>

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
