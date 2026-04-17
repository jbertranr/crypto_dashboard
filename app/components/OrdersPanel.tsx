"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { BinanceOrder, BinanceBalance, BinanceTrade } from "../lib/binance-auth";
import { formatCurrency } from "../lib/format";
import { CoinRow } from "../lib/types";
import { STABLES } from "../lib/constants";
import NewOrderModal from "./NewOrderModal";
import PortfolioTab from "./PortfolioTab";
import AnalysisTab from "./AnalysisTab";
import StrategyMatrix from "./StrategyMatrix";
import OcoProgressChart from "./OcoProgressChart";
import CoinIcon from "./CoinIcon";
import ErrorsPanel from "./ErrorsPanel";
import LogsPanel from "./LogsPanel";
import ErrorBoundary from "./ErrorBoundary";
import SettingsTab from "./SettingsTab";
import JournalTab from "./JournalTab";
import SimulationTab from "./SimulationTab";
import BotTab from "./BotTab";
import EqualizerTab from "./EqualizerTab";
import AutoLabTab from "./AutoLabTab";
import StatusTab from "./StatusTab";
import DeployTab from "./DeployTab";
import ConvertTab from "./ConvertTab";
import { useTradingMode } from "../contexts/TradingModeContext";

export type Tab = "portfolio" | "portfolio-real"
               | "open"      | "open-real"
               | "history"   | "history-real"
               | "journal"   | "journal-real"
               | "bot"       | "bot-real"
               | "balance"   | "balance-real"
               | "analysis" | "matrix" | "errors" | "logs"
               | "settings" | "simulation" | "convert"
               | "equalizer" | "autolab" | "status" | "deploy";

/* ── Strategies ── */
export const STRATEGIES = [
  {
    name: "Swing", color: "#6366f1",
    desc: "Posicions de mitjà termini (hores/dies). Entrada en retrocessos dins la tendència principal. TP ampli basat en múltiples d'ATR, SL ajustat per preservar capital.",
  },
  {
    name: "Scalp", color: "#f59e0b",
    desc: "Operatives ràpides (1m–15m). Entrada en momentum puntual. TP reduït (0.5–1× ATR), gestió estricta del risc. Alt volum d'operacions, baix risc per trade.",
  },
  {
    name: "DCA", color: "#10b981",
    desc: "Acumulació progressiva en caigudes. Entrades múltiples per promediar el preu. Ideal per actius amb tendència alcista confirmada a llarg termini.",
  },
  {
    name: "Breakout", color: "#ef4444",
    desc: "Entrada en ruptura de resistències o màxims rellevants. Confirmació de volum necessària. TP basat en l'amplada del rang previ al breakout.",
  },
  {
    name: "Hedge", color: "#8b5cf6",
    desc: "Cobertura de posicions obertes. Operativa inversa per limitar exposició en entorns d'alta incertesa o volatilitat extrema.",
  },
] as const;

export type StrategyName = (typeof STRATEGIES)[number]["name"];
const STRATEGY_MAP  = Object.fromEntries(STRATEGIES.map(s => [s.name, s.color])) as Record<string, string>;
const STRATEGY_DESC = Object.fromEntries(STRATEGIES.map(s => [s.name, s.desc]))  as Record<string, string>;

export interface OrderMeta {
  interval:    string | null;
  exitNotes:   string | null;
  tradeCode:   string | null;
  botName:     string | null;
  entrySource: "AUTO" | "MANUAL" | null;
}

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
  const { viewMode } = useTradingMode();
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
            mode: viewMode,
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
            mode: viewMode,
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

  useEscapeKey(onClose);

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
function OpenOrderTable({ orders, loading, error, onRefresh, coins, strategies, onStrategyChange, orderMeta }: {
  orders: BinanceOrder[]; loading: boolean; error: string | null;
  onRefresh: () => void; coins: CoinRow[];
  strategies: Record<string, string>;
  onStrategyChange: (key: string, strategy: string | null) => void;
  orderMeta: Record<string, OrderMeta>;
}) {
  const { viewMode } = useTradingMode();
  const [canceling,    setCanceling]    = useState<Record<number, boolean>>({});
  const [editTarget,   setEditTarget]   = useState<EditTarget | null>(null);
  const [cancelError,  setCancelError]  = useState<string | null>(null);
  const [cancelConfirm, setCancelConfirm] = useState<
    | { kind: "single"; order: BinanceOrder }
    | { kind: "oco";    group: OcoGroup }
    | null
  >(null);
  const [entryPrices,  setEntryPrices]  = useState<Record<number, number>>({});
  const [openPickerKey, setOpenPickerKey] = useState<string | null>(null);
  const [openExitKey,  setOpenExitKey]  = useState<string | null>(null);
  const [localExitNotes, setLocalExitNotes] = useState<Record<string, string>>({});
  const exitTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [filterStrategy, setFilterStrategy] = useState<string | null>(null);
  type TrailingSuggestion = { orderListId: number; activateAt: number; distance: number; activateAtr: number; distanceAtr: number; logic: string; entryPrice: number };
  type TrailingActiveRec  = { id: number; symbol: string; side: "BUY" | "SELL"; slOrderId: number; currentSl: number; trailDist: number; peakPrice: number; entryPrice: number; status: string; updatedAt: number; createdAt: number; originOcoListId: number | null; slUpdateCount: number; ocoCreatedAt: number | null };
  const [trailingSugg,   setTrailingSugg]   = useState<Record<number, TrailingSuggestion>>({});
  const [trailingActive, setTrailingActive] = useState<TrailingActiveRec[]>([]);
  const [activatingTs,   setActivatingTs]   = useState<Record<number, boolean>>({});
  const [tsError,        setTsError]        = useState<Record<number, string>>({});

  const fetchTrailing = useCallback(() => {
    fetch("/api/orders/trailing").then(r => r.json()).then((d: { suggestions: TrailingSuggestion[]; active: TrailingActiveRec[] }) => {
      if (!d || !Array.isArray(d.suggestions)) return;
      const m: Record<number, TrailingSuggestion> = {};
      d.suggestions.forEach(t => { m[t.orderListId] = t; });
      setTrailingSugg(m);
      setTrailingActive(d.active ?? []);
    }).catch(err => console.warn("[OrdersPanel] trailing:", (err as Error).message));
  }, []);

  function handleExitNotesChange(key: string, value: string) {
    setLocalExitNotes(p => ({ ...p, [key]: value }));
    if (exitTimers.current[key]) clearTimeout(exitTimers.current[key]);
    exitTimers.current[key] = setTimeout(() => {
      fetch("/api/orders/meta", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, exitNotes: value }),
      }).catch(err => console.warn("[OrdersPanel] exitNotes save:", (err as Error).message));
    }, 600);
  }

  // Cleanup debounce timers on unmount to avoid setState on unmounted component
  useEffect(() => () => { Object.values(exitTimers.current).forEach(clearTimeout); }, []);

  // Refresh trailing data on mount and whenever orders change (engine may have auto-activated)
  useEffect(() => { fetchTrailing(); }, [fetchTrailing, orders]);

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
      } else {
        // Only one leg visible (other leg already filled/cancelled) — render as individual single cards
        grp.forEach(leg => groups.push({ kind: "single", order: leg }));
      }
    }
  }

  // Open confirmation modal instead of cancelling immediately
  const handleCancel    = (o: BinanceOrder) => setCancelConfirm({ kind: "single", order: o });
  const handleCancelOco = (g: OcoGroup)     => setCancelConfirm({ kind: "oco", group: g });

  const executeCancel = async (sellAtMarket: boolean) => {
    if (!cancelConfirm) return;
    const cc = cancelConfirm;
    setCancelConfirm(null);
    setCancelError(null);

    const cancelKey = cc.kind === "single" ? cc.order.orderId : cc.group.listId;
    setCanceling(p => ({ ...p, [cancelKey]: true }));
    try {
      const body = cc.kind === "single"
        ? { symbol: cc.order.symbol, orderId: cc.order.orderId, orderListId: cc.order.orderListId,
            side: cc.order.side, origQty: cc.order.origQty, price: cc.order.price,
            type: cc.order.type, sellAtMarket, mode: viewMode }
        : { symbol: cc.group.symbol, orderId: -1, orderListId: cc.group.listId,
            side: cc.group.side, origQty: cc.group.tpOrd.origQty, price: cc.group.tpOrd.price,
            type: "ENTRY_OCO", sellAtMarket, mode: viewMode };

      const res = await fetch("/api/orders/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      if (d.sellError) setCancelError(`Ordre cancel·lada però la venda al mercat ha fallat: ${d.sellError}`);
      onRefresh();
    } catch (e: unknown) {
      setCancelError((e as Error).message);
    } finally {
      setCanceling(p => { const n = { ...p }; delete n[cancelKey]; return n; });
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

  const ocoCount    = groups.filter(g => g.kind === "oco").length;
  const symbolCount = new Set(orders.map(o => o.symbol)).size;
  const kpiPairMap  = new Map(coins.map(c => [c.pair, c.price]));
  const capitalAtRisk = groups.reduce((sum, g) => {
    if (g.kind === "oco") {
      const price = kpiPairMap.get(g.symbol) ?? 0;
      return sum + parseFloat(g.tpOrd.origQty) * price;
    }
    const price = kpiPairMap.get(g.order.symbol) ?? 0;
    return sum + parseFloat(g.order.origQty) * price;
  }, 0);

  return (
    <>
      {/* ── 5 KPIs ── */}
      <div className="section-title">
        <i className="fa-solid fa-list-check" /> Ordres obertes
      </div>
      <div className="portfolio__cards bal-cards-row">
        <div className="portfolio__card portfolio__card--blue">
          <span className="portfolio__card-label"><i className="fa-solid fa-layer-group" /> Posicions</span>
          <span className="portfolio__card-value portfolio__card-value--count">{groups.length}</span>
          <span className="portfolio__card-sub">{orders.length} ordres actives</span>
        </div>
        <div className="portfolio__card portfolio__card--neutral">
          <span className="portfolio__card-label"><i className="fa-solid fa-arrows-split-up-and-left" /> OCO</span>
          <span className="portfolio__card-value portfolio__card-value--count">{ocoCount}</span>
          <span className="portfolio__card-sub">TP + SL parells</span>
        </div>
        <div className="portfolio__card portfolio__card--neutral">
          <span className="portfolio__card-label"><i className="fa-solid fa-tag" /> Trailing</span>
          <span className="portfolio__card-value portfolio__card-value--count">{trailingActive.length}</span>
          <span className="portfolio__card-sub">stops dinàmics actius</span>
        </div>
        <div className="portfolio__card portfolio__card--neutral">
          <span className="portfolio__card-label"><i className="fa-solid fa-coins" /> Símbols</span>
          <span className="portfolio__card-value portfolio__card-value--count">{symbolCount}</span>
          <span className="portfolio__card-sub">cryptos actives</span>
        </div>
        <div className="portfolio__card portfolio__card--neutral">
          <span className="portfolio__card-label"><i className="fa-solid fa-dollar-sign" /> Capital en risc</span>
          <span className="portfolio__card-value">{capitalAtRisk > 0 ? formatCurrency(capitalAtRisk) : "—"}</span>
          <span className="portfolio__card-sub">valor posicions obertes</span>
        </div>
      </div>

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
              const suggEntry    = trailingSugg[g.listId]?.entryPrice ?? 0;
              const entryP       = suggEntry > 0 ? suggEntry : (entryPrices[g.listId] ?? 0);
              const fromEntry    = entryP && currentPrice ? ((currentPrice - entryP) / entryP) * 100 : null;
              const isCanceling  = !!canceling[g.listId];
              const tpUp = toTp !== null && toTp > 0;
              const slUp = toSl !== null && toSl > 0;
              const ocoKey = stratKey("oco", g.listId);
              const ocoStrat = strategies[ocoKey] ?? null;

              return (() => {
                const tpFromEntry = entryP > 0 && tpPrice > 0 ? ((tpPrice - entryP) / entryP) * 100 : null;
                const slFromEntry = entryP > 0 && slPrice > 0 ? ((slPrice - entryP) / entryP) * 100 : null;
                const tpPnl = entryP > 0 && qty > 0 && tpPrice > 0 ? (tpPrice - entryP) * qty : null;
                const slPnl = entryP > 0 && qty > 0 && slPrice > 0 ? (slPrice - entryP) * qty : null;
                const sugg = trailingSugg[g.listId];
                const activeTs = trailingActive.find(t => t?.symbol === g.symbol && t?.status === "active");
                const reached = !!(sugg && currentPrice > 0 && (
                  (g.side === "SELL" && currentPrice >= sugg.activateAt) ||
                  (g.side === "BUY"  && currentPrice <= sugg.activateAt)
                ));
                const isActivating = !!activatingTs[g.listId];
                const tsErr = tsError[g.listId];
                const isOpen  = openExitKey === ocoKey;
                const meta    = orderMeta[ocoKey] ?? {};
                const current = localExitNotes[ocoKey] ?? meta.exitNotes ?? "";
                const hasPlan = !!current;

                const handleActivate = async () => {
                  setActivatingTs(p => ({ ...p, [g.listId]: true }));
                  setTsError(p => { const n = { ...p }; delete n[g.listId]; return n; });
                  try {
                    const exInfo = await fetch(`/api/exchange-info?symbol=${g.symbol}`).then(r => r.json());
                    const tickSize = exInfo.tickSize ?? "0.01";
                    const res = await fetch("/api/orders/trailing/activate", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        orderListId: g.listId, symbol: g.symbol,
                        side: g.side, quantity: g.tpOrd.origQty,
                        tpPrice: g.tpOrd.price,
                        trailDist: sugg!.distance, tickSize,
                        entryPrice: sugg!.entryPrice > 0 ? sugg!.entryPrice : (entryPrices[g.listId] ?? 0),
                      }),
                    });
                    const d = await res.json();
                    if (d.error) throw new Error(d.error);
                    fetchTrailing(); onRefresh();
                  } catch (e) {
                    setTsError(p => ({ ...p, [g.listId]: (e as Error).message }));
                  } finally {
                    setActivatingTs(p => { const n = { ...p }; delete n[g.listId]; return n; });
                  }
                };

                return (
                  <div key={g.listId} className="order-card order-card--oco">

                    {/* ── Main horizontal row ── */}
                    <div className="order-card__row">

                      {/* 1. Identity: top (code+date) / middle (logo+hero) / bottom (badges+actions) */}
                      <div className="order-card__col-identity">
                        {/* TOP: code + date */}
                        <div className="order-card__col-top">
                          <span className="pill order-card__tc-badge">
                            <i className="fa-solid fa-hashtag" />
                            {orderMeta[ocoKey]?.tradeCode || `OCO-${g.listId}`}
                          </span>
                          <span className="pill order-card__date"><i className="fa-regular fa-calendar" />{fmtDate(g.startTime)}</span>
                        </div>
                        {/* MIDDLE: logo + hero amounts */}
                        <div className="order-card__col-hero">
                          <CoinIcon symbol={g.symbol.replace("USDT", "")} size={44} />
                          <div className="order-card__hero-info">
                            <span className="order-card__hero-crypto">{g.symbol.replace("USDT", "")}</span>
                            {qty > 0 && entryP > 0 && (
                              <>
                                <span className="order-card__hero-val mono">{formatCurrency(entryP * qty)}</span>
                                <span className="order-card__hero-sub">
                                  ENTRADA <span className="mono">{formatCurrency(entryP)}</span>
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        {/* BOTTOM: status badges + entrada/sortida */}
                        <div className="order-card__col-bottom">
                          <span className="pill pill--new"><i className="fa-solid fa-circle-play" />Activa</span>
                          <span className={`pill ${g.side === "BUY" ? "pill--buy" : "pill--sell"}`}>
                            <i className={`fa-solid ${g.side === "BUY" ? "fa-arrow-up" : "fa-arrow-down"}`} />{g.side}
                          </span>
                          <span className="pill pill--oco"><i className="fa-solid fa-link" />OCO</span>
                          {orderMeta[ocoKey]?.interval && (
                            <span className="pill order-card__tf-badge"><i className="fa-solid fa-chart-simple" />{orderMeta[ocoKey].interval}</span>
                          )}
                          {(() => {
                            const bn = orderMeta[ocoKey]?.botName;
                            const src = orderMeta[ocoKey]?.entrySource;
                            const entryIsBot = src === "AUTO" && !!bn;
                            return <>
                              <span className={`pill ${entryIsBot ? "order-card__bot-badge" : "order-card__manual-badge"}`}>
                                <i className={`fa-solid ${entryIsBot ? "fa-robot" : "fa-hand"}`} />
                                {entryIsBot ? `Entrada: ${bn}` : "Entrada Manual"}
                              </span>
                              <span className={`pill ${bn ? "order-card__bot-badge" : "order-card__manual-badge"}`}>
                                <i className={`fa-solid ${bn ? "fa-robot" : "fa-hand"}`} />
                                {bn ? `Sortida: ${bn}` : "Sortida Manual"}
                              </span>
                            </>;
                          })()}
                        </div>
                      </div>

                      {/* 2. TP + SL combinats */}
                      <div className="order-card__col-tpsl">
                        <div className="order-card__tpsl-half order-card__tpsl-half--tp">
                          <span className="order-card__section-label order-card__section-label--tp">TP</span>
                          <span className="order-card__col-price mono">{formatCurrency(tpPrice)}</span>
                          {tpFromEntry !== null && <span className="order-card__delta order-card__delta--up">{tpFromEntry > 0 ? "+" : ""}{tpFromEntry.toFixed(2)}%</span>}
                          {tpPnl !== null && tpPnl !== 0 && <span className="order-card__pnl order-card__pnl--up">{tpPnl > 0 ? "+" : ""}{formatCurrency(tpPnl)}</span>}
                          {toTp !== null && <span className="order-card__price-sub dim">dist {toTp > 0 ? "+" : ""}{toTp.toFixed(2)}%</span>}
                        </div>
                        <div className="order-card__tpsl-half order-card__tpsl-half--sl">
                          <span className="order-card__section-label order-card__section-label--sl">SL</span>
                          <span className="order-card__col-price mono">{formatCurrency(slPrice)}</span>
                          {slFromEntry !== null && <span className="order-card__delta order-card__delta--down">{slFromEntry > 0 ? "+" : ""}{slFromEntry.toFixed(2)}%</span>}
                          {slPnl !== null && slPnl !== 0 && <span className="order-card__pnl order-card__pnl--down">{slPnl > 0 ? "+" : ""}{formatCurrency(slPnl)}</span>}
                          {toSl !== null && <span className="order-card__price-sub dim">dist {toSl > 0 ? "+" : ""}{toSl.toFixed(2)}%</span>}
                        </div>
                      </div>

                      {/* 4. Chart */}
                      <div className="order-card__col-chart">
                        <OcoProgressChart
                          symbol={g.symbol}
                          startTime={activeTs ? (activeTs.ocoCreatedAt ?? g.startTime) : g.startTime}
                          tpPrice={tpPrice} slPrice={activeTs ? activeTs.currentSl : slPrice}
                          side={g.side}
                          slLabel={activeTs ? "SL Trail" : "SL"}
                          onEntryPrice={p => setEntryPrices(prev => ({ ...prev, [g.listId]: p }))}
                          trailDist={activeTs ? activeTs.trailDist : undefined}
                          trailEntryPrice={activeTs && activeTs.entryPrice > 0 ? activeTs.entryPrice : undefined}
                          trailActivateAt={sugg && !activeTs ? sugg.activateAt : undefined}
                        />
                      </div>

                      {/* 5. Last col: trailing stop info (if available) + Edit + Cancel */}
                      <div className={`order-card__col-trailing${sugg && !activeTs && reached ? " order-card__col-trailing--reached" : ""}`}>
                        {activeTs && (() => {
                          const slFromEntryPct = activeTs.entryPrice > 0 && activeTs.currentSl > 0
                            ? ((activeTs.currentSl - activeTs.entryPrice) / activeTs.entryPrice * 100) : null;
                          const peakFromEntryPct = activeTs.entryPrice > 0 && activeTs.peakPrice > 0
                            ? ((activeTs.peakPrice - activeTs.entryPrice) / activeTs.entryPrice * 100) : null;
                          const abovePeak = currentPrice > 0 && currentPrice > activeTs.peakPrice;
                          const projectedSl = abovePeak ? currentPrice - activeTs.trailDist : null;
                          const gapToPeak   = currentPrice > 0 && !abovePeak ? activeTs.peakPrice - currentPrice : null;
                          return (
                            <>
                              <div className="order-card__trailing-header">
                                <i className="fa-solid fa-chart-line" />
                                <span>Trailing Actiu</span>
                                <span className="order-trailing__pulse" />
                              </div>
                              <div className="order-card__trailing-levels">
                                <div className="order-card__trailing-level">
                                  <span className="order-card__trailing-lbl">Distància</span>
                                  <span className="mono">{formatCurrency(activeTs.trailDist)}</span>
                                </div>
                                <div className="order-card__trailing-level">
                                  <span className="order-card__trailing-lbl">SL actual</span>
                                  <span className="mono">{formatCurrency(activeTs.currentSl)}</span>
                                  {slFromEntryPct !== null && (
                                    <span className={`order-card__trailing-atr ${slFromEntryPct >= 0 ? "order-card__trailing-atr--up" : "order-card__trailing-atr--down"}`}>
                                      {slFromEntryPct >= 0 ? "+" : ""}{slFromEntryPct.toFixed(2)}%
                                    </span>
                                  )}
                                </div>
                                <div className="order-card__trailing-level">
                                  <span className="order-card__trailing-lbl">Pic</span>
                                  <span className="mono">{formatCurrency(activeTs.peakPrice)}</span>
                                  {peakFromEntryPct !== null && (
                                    <span className="order-card__trailing-atr order-card__trailing-atr--up">
                                      +{peakFromEntryPct.toFixed(2)}%
                                    </span>
                                  )}
                                </div>
                                <div className="order-card__trailing-level">
                                  <span className="order-card__trailing-lbl">Ajustos SL</span>
                                  <span className="mono">{activeTs.slUpdateCount}</span>
                                </div>
                                {abovePeak && projectedSl !== null ? (
                                  <div className="order-card__trailing-level order-card__trailing-level--next-sl">
                                    <span className="order-card__trailing-lbl">Nou SL ↑</span>
                                    <span className="mono" style={{ color: "var(--accent)" }}>{formatCurrency(projectedSl)}</span>
                                    <span className="order-card__trailing-atr order-card__trailing-atr--up">ara!</span>
                                  </div>
                                ) : gapToPeak !== null ? (
                                  <div className="order-card__trailing-level order-card__trailing-level--next-sl">
                                    <span className="order-card__trailing-lbl">SL puja si</span>
                                    <span className="mono" style={{ color: "var(--text-2)" }}>+{formatCurrency(gapToPeak)}</span>
                                    <span className="order-card__trailing-atr" style={{ color: "var(--text-3)" }}>al pic</span>
                                  </div>
                                ) : null}
                              </div>
                            </>
                          );
                        })()}
                        {sugg && !activeTs && (
                          <>
                            <div className="order-card__trailing-header">
                              <i className="fa-solid fa-flag-checkered" />
                              <span>Trailing Stop</span>
                              {reached && <span className="order-card__trailing-alert"><i className="fa-solid fa-bolt" /></span>}
                            </div>
                            <div className="order-card__trailing-levels">
                              {sugg.activateAtr > 0 ? (
                                <div className="order-card__trailing-level">
                                  <span className="order-card__trailing-lbl">Activació</span>
                                  <span className="mono">{formatCurrency(sugg.activateAt)}</span>
                                  <span className="order-card__trailing-atr">{sugg.activateAtr}×ATR</span>
                                </div>
                              ) : (
                                <div className="order-card__trailing-level">
                                  <span className="order-card__trailing-lbl">Activació</span>
                                  <span className="order-card__trailing-atr">immediata</span>
                                </div>
                              )}
                              <div className="order-card__trailing-level">
                                <span className="order-card__trailing-lbl">Distància</span>
                                <span className="mono">{formatCurrency(sugg.distance)}</span>
                                <span className="order-card__trailing-atr">{sugg.distanceAtr}×ATR</span>
                              </div>
                            </div>
                            {reached && <div className="order-card__trailing-reached">Preu assolit!</div>}
                            {tsErr && <div className="order-trailing__err">{tsErr}</div>}
                            <button
                              className={`order-trailing__btn${reached ? " order-trailing__btn--ready" : ""}`}
                              onClick={handleActivate} disabled={isActivating}
                            >
                              {isActivating
                                ? <><i className="fa-solid fa-spinner fa-spin" /> Activant…</>
                                : reached
                                  ? <><i className="fa-solid fa-bolt" /> Activar ara</>
                                  : <><i className="fa-solid fa-flag-checkered" /> Activa Trailing</>}
                            </button>
                          </>
                        )}
                        <div className="order-card__col-trailing-actions">
                          <button className="order-btn order-btn--secondary"
                            onClick={() => setEditTarget({
                              kind: "oco", symbol: g.symbol, orderListId: g.listId,
                              side: g.side as "BUY" | "SELL", quantity: g.tpOrd.origQty,
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

                    </div>

                    {/* ── Exit plan ── */}
                    <div className="order-card__exit">
                      <button
                        className={`order-card__exit-header${isOpen ? " order-card__exit-header--open" : ""}`}
                        onClick={() => setOpenExitKey(k => k === ocoKey ? null : ocoKey)}
                      >
                        <i className="fa-solid fa-route" />
                        <span>Pla de sortida</span>
                        {hasPlan && <span className="order-card__exit-indicator" />}
                        <i className={`fa-solid fa-chevron-${isOpen ? "up" : "down"} order-card__exit-chevron`} />
                      </button>
                      {isOpen && (
                        <div className="order-card__exit-body">
                          <textarea
                            className="journal-notes"
                            rows={3}
                            placeholder="Descriu el pla de sortida: parcials, condicions de tancament, gestió del stop…"
                            value={current}
                            onChange={ev => handleExitNotesChange(ocoKey, ev.target.value)}
                          />
                        </div>
                      )}
                    </div>

                  </div>
                );
              })();
            }

            /* Single order card */
            const o = g.order;
            if (!o) return null;
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
            // Check if this is an active trailing stop SL order
            const activeTs = trailingActive.find(t => t?.slOrderId === o.orderId && t?.status === "active");

            /* ── Trailing stop card: same layout as OCO ── */
            if (activeTs) {
              const entryP       = activeTs.entryPrice > 0 ? activeTs.entryPrice : 0;
              const slP          = activeTs.currentSl;
              const peakP        = activeTs.peakPrice;
              const slFromEntry  = entryP > 0 && slP > 0   ? ((slP   - entryP) / entryP) * 100 : null;
              const peakFromEntry= entryP > 0 && peakP > 0 ? ((peakP - entryP) / entryP) * 100 : null;
              const slPnl        = entryP > 0 && qty > 0 && slP > 0
                ? (slP - entryP) * qty * (o.side === "SELL" ? 1 : -1) : null;
              const peakPnl      = entryP > 0 && qty > 0 && peakP > 0
                ? (peakP - entryP) * qty * (o.side === "SELL" ? 1 : -1) : null;
              const toSlDist     = slP > 0   && currentPrice > 0 ? dist(slP,   currentPrice) : null;
              const toPeakDist   = peakP > 0 && currentPrice > 0 ? dist(peakP, currentPrice) : null;
              const isOpen       = openExitKey === ordKey;
              const meta         = orderMeta[ordKey] ?? {};
              const exitCurrent  = localExitNotes[ordKey] ?? meta.exitNotes ?? "";
              const hasPlan      = !!exitCurrent;

              return (
                <div key={o.orderId} className="order-card order-card--oco">
                  <div className="order-card__section-title">
                    <i className="fa-solid fa-list-check" />
                    Detall ordres vigents
                  </div>
                  <div className="order-card__row">

                    {/* 1. Identity */}
                    <div className="order-card__col-identity">
                      <div className="order-card__col-top">
                        {(() => {
                          const tc = orderMeta[ordKey]?.tradeCode
                            ?? (activeTs.originOcoListId ? orderMeta[stratKey("oco", activeTs.originOcoListId)]?.tradeCode : null);
                          const pnlPct = activeTs.entryPrice > 0 && activeTs.currentSl > 0
                            ? ((activeTs.currentSl - activeTs.entryPrice) / activeTs.entryPrice * 100).toFixed(2)
                            : null;
                          const peakPct = activeTs.entryPrice > 0 && activeTs.peakPrice > 0
                            ? ((activeTs.peakPrice - activeTs.entryPrice) / activeTs.entryPrice * 100).toFixed(2)
                            : null;
                          const ocoDate = activeTs.ocoCreatedAt ?? null;
                          const tooltip = tc ? [
                            `Ordre pare: ${activeTs.originOcoListId ? `OCO-${activeTs.originOcoListId}` : "—"}`,
                            ocoDate ? `OCO creat: ${fmtDate(ocoDate)}` : null,
                            `Entrada: ${formatCurrency(activeTs.entryPrice)}`,
                            `Pic: ${formatCurrency(activeTs.peakPrice)}${peakPct ? ` (${peakPct}%)` : ""}`,
                            `SL actual: ${formatCurrency(activeTs.currentSl)}${pnlPct ? ` (${pnlPct}%)` : ""}`,
                            `Distància: ${formatCurrency(activeTs.trailDist)}`,
                            `Ajustos SL: ${activeTs.slUpdateCount}`,
                          ].filter(Boolean).join("\n") : undefined;
                          return (<>
                            <span className="pill order-card__tc-badge" style={{ opacity: 0.6 }}>
                              <i className="fa-solid fa-link" />
                              {activeTs.originOcoListId ? `OCO-${activeTs.originOcoListId}` : `ORD-${o.orderId}`}
                            </span>
                            {tc && (
                              <span className="pill order-card__tc-badge" title={tooltip}>
                                <i className="fa-solid fa-hashtag" />{tc}
                              </span>
                            )}
                          </>);
                        })()}
                        <span className="pill order-card__date">
                          <i className="fa-regular fa-calendar" />
                          {activeTs.ocoCreatedAt ? fmtDate(activeTs.ocoCreatedAt) : fmtDate(activeTs.createdAt)}
                        </span>
                      </div>
                      <div className="order-card__col-hero">
                        <CoinIcon symbol={o.symbol.replace("USDT", "")} size={44} />
                        <div className="order-card__hero-info">
                          <span className="order-card__hero-crypto">{o.symbol.replace("USDT", "")}</span>
                          {entryP > 0 && qty > 0 && (
                            <>
                              <span className="order-card__section-label">INVERTIT</span>
                              <span className="order-card__hero-val mono">{formatCurrency(entryP * qty)}</span>
                              <span className="order-card__hero-sub">
                                ENTRADA <span className="mono">{formatCurrency(entryP)}</span>
                                {" "}(#{formatCurrency(entryP * qty)})
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="order-card__col-bottom">
                        <span className="pill pill--trailing"><i className="fa-solid fa-chart-line" /> Trailing</span>
                        <span className={`pill ${o.side === "BUY" ? "pill--buy" : "pill--sell"}`}>
                          <i className={`fa-solid ${o.side === "BUY" ? "fa-arrow-up" : "fa-arrow-down"}`} />{o.side}
                        </span>
                        {orderMeta[ordKey]?.interval && (
                          <span className="pill order-card__tf-badge"><i className="fa-solid fa-chart-simple" />{orderMeta[ordKey].interval}</span>
                        )}
                        {(() => {
                          const bn = orderMeta[ordKey]?.botName;
                          const src = orderMeta[ordKey]?.entrySource;
                          const entryIsBot = src === "AUTO" && !!bn;
                          return <>
                            <span className={`pill ${entryIsBot ? "order-card__bot-badge" : "order-card__manual-badge"}`}>
                              <i className={`fa-solid ${entryIsBot ? "fa-robot" : "fa-hand"}`} />
                              {entryIsBot ? `Entrada: ${bn}` : "Entrada Manual"}
                            </span>
                            <span className={`pill ${bn ? "order-card__bot-badge" : "order-card__manual-badge"}`}>
                              <i className={`fa-solid ${bn ? "fa-robot" : "fa-hand"}`} />
                              {bn ? `Sortida: ${bn}` : "Sortida Manual"}
                            </span>
                          </>;
                        })()}
                      </div>
                    </div>

                    {/* 2. SL Trailing */}
                    <div className="order-card__col-sl">
                      <span className="order-card__section-label order-card__section-label--sl">SL TRAILING</span>
                      <span className="order-card__col-price mono">{slP > 0 ? formatCurrency(slP) : "—"}</span>
                      {slFromEntry !== null && <span className="order-card__delta order-card__delta--down">{slFromEntry > 0 ? "+" : ""}{slFromEntry.toFixed(2)}%</span>}
                      {slPnl !== null && <span className="order-card__pnl order-card__pnl--down">{slPnl > 0 ? "+" : ""}{formatCurrency(slPnl)}</span>}
                      {toSlDist !== null && <span className="order-card__price-sub dim">dist {toSlDist > 0 ? "+" : ""}{toSlDist.toFixed(2)}%</span>}
                    </div>

                    {/* 3. Màxim vist */}
                    <div className="order-card__col-tp">
                      <span className="order-card__section-label order-card__section-label--tp">MÀXIM VIST</span>
                      <span className="order-card__col-price mono">{peakP > 0 ? formatCurrency(peakP) : "—"}</span>
                      {peakFromEntry !== null && <span className="order-card__delta order-card__delta--up">{peakFromEntry > 0 ? "+" : ""}{peakFromEntry.toFixed(2)}%</span>}
                      {peakPnl !== null && <span className="order-card__pnl order-card__pnl--up">{peakPnl > 0 ? "+" : ""}{formatCurrency(peakPnl)}</span>}
                      {toPeakDist !== null && <span className="order-card__price-sub dim">dist {toPeakDist > 0 ? "+" : ""}{toPeakDist.toFixed(2)}%</span>}
                    </div>

                    {/* 4. Chart */}
                    {slP > 0 && peakP > 0 && (
                      <div className="order-card__col-chart">
                        <OcoProgressChart
                          symbol={o.symbol}
                          startTime={activeTs.ocoCreatedAt ?? activeTs.createdAt}
                          tpPrice={peakP} slPrice={slP}
                          side={activeTs.side}
                          tpLabel="Pic" slLabel="SL Trail"
                          trailDist={activeTs.trailDist}
                          trailEntryPrice={entryP > 0 ? entryP : peakP}
                        />
                      </div>
                    )}

                    {/* 5. Trailing info + Edit / Cancel */}
                    <div className="order-card__col-trailing order-card__col-trailing--running">
                      <div className="order-card__trailing-header">
                        <i className="fa-solid fa-chart-line" />
                        <span>Trailing Actiu</span>
                        <span className="order-trailing__pulse" />
                      </div>
                      <div className="order-card__trailing-levels">
                        <div className="order-card__trailing-level">
                          <span className="order-card__trailing-lbl">SL actual</span>
                          <span className="mono">{formatCurrency(slP)}</span>
                          {slFromEntry !== null && (
                            <span className={`order-card__trailing-atr ${slFromEntry >= 0 ? "order-card__trailing-atr--up" : "order-card__trailing-atr--down"}`}>
                              {slFromEntry >= 0 ? "+" : ""}{slFromEntry.toFixed(2)}%
                            </span>
                          )}
                        </div>
                        <div className="order-card__trailing-level">
                          <span className="order-card__trailing-lbl">Pic</span>
                          <span className="mono">{formatCurrency(peakP)}</span>
                          {peakFromEntry !== null && (
                            <span className="order-card__trailing-atr order-card__trailing-atr--up">+{peakFromEntry.toFixed(2)}%</span>
                          )}
                        </div>
                        <div className="order-card__trailing-level">
                          <span className="order-card__trailing-lbl">Distància</span>
                          <span className="mono">{formatCurrency(activeTs.trailDist)}</span>
                        </div>
                        {currentPrice > 0 && currentPrice > peakP ? (
                          <div className="order-card__trailing-level order-card__trailing-level--next-sl">
                            <span className="order-card__trailing-lbl">Nou SL ↑</span>
                            <span className="mono" style={{ color: "var(--accent)" }}>{formatCurrency(currentPrice - activeTs.trailDist)}</span>
                            <span className="order-card__trailing-atr order-card__trailing-atr--up">ara!</span>
                          </div>
                        ) : currentPrice > 0 ? (
                          <div className="order-card__trailing-level order-card__trailing-level--next-sl">
                            <span className="order-card__trailing-lbl">SL puja si</span>
                            <span className="mono" style={{ color: "var(--text-2)" }}>+{formatCurrency(peakP - currentPrice)}</span>
                            <span className="order-card__trailing-atr" style={{ color: "var(--text-3)" }}>al pic</span>
                          </div>
                        ) : null}
                      </div>
                      <div className="order-card__trailing-logic" style={{ color: "#059669", fontSize: "0.6rem" }}>
                        Actualitzat {new Date(activeTs.updatedAt).toLocaleTimeString("ca-ES")}
                      </div>
                      <div className="order-card__col-trailing-actions">
                        <button className="order-btn order-btn--secondary"
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

                  </div>

                  {/* Exit plan */}
                  <div className="order-card__exit">
                    <button
                      className={`order-card__exit-header${isOpen ? " order-card__exit-header--open" : ""}`}
                      onClick={() => setOpenExitKey(k => k === ordKey ? null : ordKey)}
                    >
                      <i className="fa-solid fa-route" />
                      <span>Pla de sortida</span>
                      {hasPlan && <span className="order-card__exit-indicator" />}
                      <i className={`fa-solid fa-chevron-${isOpen ? "up" : "down"} order-card__exit-chevron`} />
                    </button>
                    {isOpen && (
                      <div className="order-card__exit-body">
                        <textarea
                          className="journal-notes"
                          rows={3}
                          placeholder="Descriu el pla de sortida: parcials, condicions de tancament, gestió del stop…"
                          value={exitCurrent}
                          onChange={ev => handleExitNotesChange(ordKey, ev.target.value)}
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            }

            /* ── Regular single order card ── */
            {
              const isOpen  = openExitKey === ordKey;
              const meta    = orderMeta[ordKey] ?? {};
              const exitCurrent = localExitNotes[ordKey] ?? meta.exitNotes ?? "";
              const hasPlan = !!exitCurrent;
              const hasChart = stopPrice > 0 && currentPrice > 0;
              // For chart: use stopPrice as SL reference, currentPrice*1.03 as upper ref
              const chartTp = currentPrice > 0 ? currentPrice * 1.03 : stopPrice * 1.1;
              const toStopDist = stopPrice > 0 && currentPrice > 0 ? dist(stopPrice, currentPrice) : null;
              const bn  = orderMeta[ordKey]?.botName;
              const src = orderMeta[ordKey]?.entrySource;
              const entryIsBot = src === "AUTO" && !!bn;
              const tc = orderMeta[ordKey]?.tradeCode
                ?? (o.orderListId !== -1 ? orderMeta[stratKey("oco", o.orderListId)]?.tradeCode : null);

              return (
                <div key={o.orderId} className="order-card order-card--single">

                  {/* ── Main horizontal row ── */}
                  <div className="order-card__row">

                    {/* 1. Identity */}
                    <div className="order-card__col-identity">
                      <div className="order-card__col-top">
                        {tc && <span className="pill order-card__tc-badge"><i className="fa-solid fa-hashtag" />{tc}</span>}
                        <span className="pill order-card__date"><i className="fa-regular fa-calendar" />{fmtDate(o.time)}</span>
                      </div>
                      <div className="order-card__col-hero">
                        <CoinIcon symbol={o.symbol.replace("USDT", "")} size={44} />
                        <div className="order-card__hero-info">
                          <span className="order-card__hero-crypto">{qty} {o.symbol.replace("USDT", "")}</span>
                          {valueUSD > 0 && <span className="order-card__hero-val mono">{formatCurrency(valueUSD)}</span>}
                          {currentPrice > 0 && <span className="order-card__hero-sub">MERCAT <span className="mono">{formatCurrency(currentPrice)}</span></span>}
                        </div>
                      </div>
                      <div className="order-card__col-bottom">
                        <StatusPill status={o.status} />
                        <span className={`pill ${o.side === "BUY" ? "pill--buy" : "pill--sell"}`}>
                          <i className={`fa-solid ${o.side === "BUY" ? "fa-arrow-up" : "fa-arrow-down"}`} />{o.side}
                        </span>
                        <span className={`pill ${info.cls}`}>{info.label}</span>
                        {orderMeta[ordKey]?.interval && (
                          <span className="pill order-card__tf-badge"><i className="fa-solid fa-chart-simple" />{orderMeta[ordKey].interval}</span>
                        )}
                        <span className={`pill ${entryIsBot ? "order-card__bot-badge" : "order-card__manual-badge"}`}>
                          <i className={`fa-solid ${entryIsBot ? "fa-robot" : "fa-hand"}`} />
                          {entryIsBot ? `Bot: ${bn}` : "Entrada Manual"}
                        </span>
                        <span className={`pill ${bn ? "order-card__bot-badge" : "order-card__manual-badge"}`}>
                          <i className={`fa-solid ${bn ? "fa-robot" : "fa-hand"}`} />
                          {bn ? `Sortida: ${bn}` : "Sortida Manual"}
                        </span>
                      </div>
                    </div>

                    {/* 2. Price (limit) */}
                    <div className="order-card__col-sl">
                      <span className="order-card__section-label order-card__section-label--sl">PREU ORDRE</span>
                      <span className="order-card__col-price mono">
                        {price > 0 ? formatCurrency(price) : "MARKET"}
                      </span>
                      {toDist !== null && (
                        <span className={`order-card__delta ${toDist >= 0 ? "order-card__delta--up" : "order-card__delta--down"}`}>
                          {toDist > 0 ? "+" : ""}{toDist.toFixed(2)}%
                        </span>
                      )}
                      {stopPrice > 0 && (
                        <>
                          <span className="order-card__section-label order-card__section-label--sl" style={{ marginTop: 8 }}>TRIGGER</span>
                          <span className="order-card__col-price mono">{formatCurrency(stopPrice)}</span>
                          {toStopDist !== null && (
                            <span className={`order-card__delta ${toStopDist >= 0 ? "order-card__delta--up" : "order-card__delta--down"}`}>
                              {toStopDist > 0 ? "+" : ""}{toStopDist.toFixed(2)}%
                            </span>
                          )}
                        </>
                      )}
                      <span className="order-card__section-label" style={{ marginTop: 8 }}>QTY</span>
                      <span className="order-card__col-price mono" style={{ fontSize: "0.8rem" }}>
                        {qty} {o.symbol.replace("USDT", "")}
                        {price > 0 && <span className="dim" style={{ fontSize: "0.7rem" }}> ({formatCurrency(price * qty)})</span>}
                      </span>
                    </div>

                    {/* 3. Chart */}
                    {hasChart && (
                      <div className="order-card__col-chart">
                        <OcoProgressChart
                          symbol={o.symbol}
                          startTime={o.time}
                          tpPrice={chartTp}
                          slPrice={stopPrice}
                          side={o.side as "BUY" | "SELL"}
                          tpLabel="" slLabel="SL"
                        />
                      </div>
                    )}

                    {/* 4. Actions */}
                    <div className="order-card__col-trailing">
                      <div className="order-card__col-trailing-actions">
                        <button className="order-btn order-btn--secondary"
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

                  </div>

                  {/* Exit plan */}
                  <div className="order-card__exit">
                    <button
                      className={`order-card__exit-header${isOpen ? " order-card__exit-header--open" : ""}`}
                      onClick={() => setOpenExitKey(k => k === ordKey ? null : ordKey)}
                    >
                      <i className="fa-solid fa-route" />
                      <span>Pla de sortida</span>
                      {hasPlan && <span className="order-card__exit-indicator" />}
                      <i className={`fa-solid fa-chevron-${isOpen ? "up" : "down"} order-card__exit-chevron`} />
                    </button>
                    {isOpen && (
                      <div className="order-card__exit-body">
                        <textarea
                          className="journal-notes"
                          rows={3}
                          placeholder="Descriu el pla de sortida: parcials, condicions de tancament, gestió del stop…"
                          value={exitCurrent}
                          onChange={ev => handleExitNotesChange(ordKey, ev.target.value)}
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            }
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

      {/* Cancel confirmation modal */}
      {cancelConfirm && (() => {
        const isSell = cancelConfirm.kind === "oco"
          ? true  // OCOs are always sell-side exits
          : cancelConfirm.order.side === "SELL";
        const sym = cancelConfirm.kind === "oco"
          ? cancelConfirm.group.symbol
          : cancelConfirm.order.symbol;
        const base = sym.replace(/USDT$/, "");
        const qty  = parseFloat(
          cancelConfirm.kind === "oco"
            ? cancelConfirm.group.tpOrd.origQty
            : cancelConfirm.order.origQty
        );
        return (
          <div className="cancel-overlay" onClick={() => setCancelConfirm(null)}>
            <div className="cancel-modal" onClick={e => e.stopPropagation()}>
              <div className="cancel-modal__header">
                <i className="fa-solid fa-triangle-exclamation" style={{ color: "var(--yellow)" }} />
                <span>Confirmar cancel·lació</span>
              </div>
              <div className="cancel-modal__body">
                <p className="cancel-modal__desc">
                  Cancel·lar l&apos;ordre de <strong>{base}</strong>
                  {" — "}<span className="mono">{qty.toFixed(qty < 1 ? 6 : 4)} {base}</span>
                </p>
                {isSell && (
                  <p className="cancel-modal__warn">
                    <i className="fa-solid fa-circle-exclamation" />
                    {" "}Sense ordre de protecció, la posició quedaria exposada.
                  </p>
                )}
              </div>
              <div className="cancel-modal__actions">
                {isSell && (
                  <button className="btn-danger" onClick={() => executeCancel(true)}>
                    <i className="fa-solid fa-arrow-down-to-line" /> Cancel·lar i vendre al mercat
                  </button>
                )}
                <button className="btn-secondary" onClick={() => executeCancel(false)}>
                  <i className="fa-solid fa-xmark" /> {isSell ? "Només cancel·lar" : "Cancel·lar ordre"}
                </button>
                <button className="btn-secondary" onClick={() => setCancelConfirm(null)}>
                  Tornar
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}

/* ── History — types & helpers ── */
type ResultKind = "tp" | "sl" | "buy" | "sell" | "canceled" | "other";

function orderResult(o: BinanceOrder): ResultKind {
  if (o.status === "CANCELED" || o.status === "EXPIRED") return "canceled";
  if (o.status !== "FILLED") return "other";
  if (o.type === "LIMIT_MAKER") return "tp";
  if (o.type === "STOP_LOSS_LIMIT" || o.type === "STOP_LOSS") return "sl";
  if (o.side === "BUY")  return "buy";
  if (o.side === "SELL") return "sell";
  return "other";
}

const RESULT_CFG: Record<ResultKind, { label: string; icon: string; color: string }> = {
  tp:       { label: "Take Profit", icon: "fa-check",      color: "#16a34a" },
  sl:       { label: "Stop Loss",   icon: "fa-xmark",      color: "#dc2626" },
  buy:      { label: "Compra",      icon: "fa-arrow-up",   color: "#3b82f6" },
  sell:     { label: "Venda",       icon: "fa-arrow-down", color: "#8b5cf6" },
  canceled: { label: "Cancel·lat",  icon: "fa-ban",        color: "#94a3b8" },
  other:    { label: "—",           icon: "fa-minus",      color: "#94a3b8" },
};

interface TrailingActiveInfo {
  id: number; symbol: string; slOrderId: number; status: string;
  originOcoListId: number | null; currentSl: number; trailDist: number; peakPrice: number;
}

type OcoGroup = {
  id: number; filled: BinanceOrder; other: BinanceOrder | null;
  trailingMeta?: TrailingActiveInfo; trailingOrder?: BinanceOrder | null;
};
type HistItem =
  | { kind: "solo";    order: BinanceOrder }
  | { kind: "oco";     group: OcoGroup }
  | { kind: "buy+oco"; buyOrder: BinanceOrder; group: OcoGroup };

function groupOrders(orders: BinanceOrder[], trailingActives: TrailingActiveInfo[] = []): HistItem[] {
  const sorted = [...orders].sort((a, b) => (b.updateTime || b.time) - (a.updateTime || a.time));

  // Build lookup maps from trailing data
  const trailingByOco    = new Map<number, TrailingActiveInfo>();
  const trailingSlOrders = new Set<number>();
  for (const t of trailingActives) {
    if (t.originOcoListId != null) trailingByOco.set(t.originOcoListId, t);
    trailingSlOrders.add(t.slOrderId);
  }
  const orderById = new Map<number, BinanceOrder>();
  for (const o of sorted) orderById.set(o.orderId, o);

  const ocoMap = new Map<number, BinanceOrder[]>();
  for (const o of sorted) {
    if (o.orderListId !== -1) {
      const g = ocoMap.get(o.orderListId) ?? [];
      g.push(o);
      ocoMap.set(o.orderListId, g);
    }
  }
  const seen = new Set<number>();
  const items: HistItem[] = [];
  for (const o of sorted) {
    if (seen.has(o.orderId)) continue;
    seen.add(o.orderId);
    if (o.orderListId === -1) {
      // Skip: this is a trailing SL order already shown inside an OCO tree
      // But only skip if the origin OCO is still present in active orders
      if (trailingSlOrders.has(o.orderId)) {
        const ta = trailingActives.find(t => t.slOrderId === o.orderId);
        if (ta?.originOcoListId != null && ocoMap.has(ta.originOcoListId)) continue;
        // Origin OCO is gone (cancelled) → show this SL as a solo card with trailing info
      }
      items.push({ kind: "solo", order: o });
    } else {
      const legs = ocoMap.get(o.orderListId) ?? [o];
      legs.forEach(l => seen.add(l.orderId));
      const filled = legs.find(l => l.status === "FILLED") ?? legs[0];
      const other  = legs.find(l => l !== filled) ?? null;
      const group: OcoGroup = { id: o.orderListId, filled, other };
      const tm = trailingByOco.get(o.orderListId);
      if (tm) {
        group.trailingMeta  = tm;
        group.trailingOrder = orderById.get(tm.slOrderId) ?? null;
        // Mark the SL order as seen so it doesn't also appear as solo
        if (tm.slOrderId) seen.add(tm.slOrderId);
      }
      items.push({ kind: "oco", group });
    }
  }

  // Link market BUY solos to their SELL OCO groups (buy-and-exit flow)
  const soloBuys = items
    .filter(i => i.kind === "solo" &&
      (i as { kind: "solo"; order: BinanceOrder }).order.type === "MARKET" &&
      (i as { kind: "solo"; order: BinanceOrder }).order.side === "BUY" &&
      (i as { kind: "solo"; order: BinanceOrder }).order.status === "FILLED")
    .map(i => (i as { kind: "solo"; order: BinanceOrder }).order);

  const usedBuyIds  = new Set<number>();
  const ocoToBuy    = new Map<number, BinanceOrder>(); // oco listId → buy order

  for (const item of items) {
    if (item.kind !== "oco") continue;
    const g        = item.group;
    const ocoOrder = g.filled ?? g.other;
    if (!ocoOrder || ocoOrder.side !== "SELL") continue;
    const ocoQty  = parseFloat(ocoOrder.origQty);
    const ocoTime = ocoOrder.time;

    const match = soloBuys
      .filter(b =>
        !usedBuyIds.has(b.orderId) &&
        b.symbol === ocoOrder.symbol &&
        ocoTime >= b.time &&
        ocoTime - b.time < 10 * 60_000 &&          // within 10 min
        Math.abs(parseFloat(b.executedQty) - ocoQty) / ocoQty < 0.01,
      )
      .sort((a, b_) => b_.time - a.time)[0];       // closest preceding buy

    if (match) {
      usedBuyIds.add(match.orderId);
      ocoToBuy.set(g.id, match);
    }
  }

  const final: HistItem[] = [];
  for (const item of items) {
    if (item.kind === "solo" && usedBuyIds.has(item.order.orderId)) continue;
    if (item.kind === "oco") {
      const buy = ocoToBuy.get(item.group.id);
      if (buy) { final.push({ kind: "buy+oco", buyOrder: buy, group: item.group }); continue; }
    }
    final.push(item);
  }
  return final;
}

function getTypeLabel(order: BinanceOrder): string {
  const s = order.side === "BUY" ? "compra" : "venda";
  switch (order.type) {
    case "LIMIT":             return `Ordre limitada de ${s}`;
    case "LIMIT_MAKER":       return "Take Profit (maker)";
    case "MARKET":            return `Ordre de mercat`;
    case "STOP_LOSS_LIMIT":   return "Stop-loss limitada";
    case "STOP_LOSS":         return "Stop-loss";
    case "TAKE_PROFIT_LIMIT": return "Take Profit limitada";
    case "TAKE_PROFIT":       return "Take Profit";
    default:                  return order.type.toLowerCase().replace(/_/g, " ");
  }
}

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function BuyOcoCard({ buyOrder, group, trades }: {
  buyOrder: BinanceOrder;
  group:    OcoGroup;
  trades:   BinanceTrade[];
}) {
  const symbol  = buyOrder.symbol.replace(/USDT$/, "");
  const buyQty  = parseFloat(buyOrder.executedQty) || 0;

  // Entry: avg fill from trades or cummulativeQuoteQty fallback
  const buyTrades  = trades.filter(t => t.orderId === buyOrder.orderId);
  const buyQuote   = buyTrades.reduce((s, t) => s + parseFloat(t.quoteQty), 0);
  const entryValue = buyQuote > 0 ? buyQuote : parseFloat((buyOrder as unknown as Record<string,string>).cummulativeQuoteQty || "0");
  const entryPrice = entryValue > 0 && buyQty > 0 ? entryValue / buyQty : 0;

  // OCO result
  const tpLeg  = [group.filled, group.other].filter(Boolean).find(l => l!.type === "LIMIT_MAKER") as BinanceOrder | undefined;
  const slLeg  = [group.filled, group.other].filter(Boolean).find(l => l!.type === "STOP_LOSS_LIMIT" || l!.type === "STOP_LOSS") as BinanceOrder | undefined;
  const exitLeg = group.filled.status === "FILLED" ? group.filled : null;
  const isTP    = exitLeg?.type === "LIMIT_MAKER";
  const isSL    = exitLeg?.type === "STOP_LOSS_LIMIT" || exitLeg?.type === "STOP_LOSS";

  const exitTrades = exitLeg ? trades.filter(t => t.orderId === exitLeg.orderId) : [];
  const exitQuote  = exitTrades.reduce((s, t) => s + parseFloat(t.quoteQty), 0);
  const exitPrice  = exitTrades.length > 0 && buyQty > 0 ? exitQuote / buyQty
                   : exitLeg ? parseFloat(exitLeg.price) : 0;

  const pnl     = exitPrice > 0 && entryPrice > 0 ? (exitPrice - entryPrice) * buyQty : null;
  const pnlPct  = pnl != null && entryValue > 0 ? (pnl / entryValue) * 100 : null;
  const pnlUp   = pnl != null && pnl >= 0;

  const resultColor = isTP ? "#16a34a" : isSL ? "#dc2626" : "#94a3b8";
  const resultLabel = isTP ? "Take Profit" : isSL ? "Stop Loss" : exitLeg ? "Venda" : "En curs";
  const resultIcon  = isTP ? "fa-check" : isSL ? "fa-xmark" : "fa-clock";

  const durationMs = exitLeg
    ? (exitLeg.updateTime || 0) - buyOrder.time
    : (group.filled.time || 0) - buyOrder.time;
  const duration = durationMs > 5_000 ? fmtDuration(durationMs) : null;

  const commByAsset: Record<string, number> = {};
  [...buyTrades, ...exitTrades].forEach(t => {
    commByAsset[t.commissionAsset] = (commByAsset[t.commissionAsset] ?? 0) + parseFloat(t.commission);
  });
  const commEntries = Object.entries(commByAsset).filter(([, v]) => v > 0);

  const fmtDate = (ts: number) =>
    new Date(ts).toLocaleString("ca-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="hist-card hist-buyoco" style={{ "--hist-color": resultColor } as React.CSSProperties}>
      <div className="hist-card__accent" />

      {/* Header */}
      <div className="hist-buyoco__header">
        <div className="hist-card__identity">
          <div className="hist-card__id-row">
            <CoinIcon symbol={symbol} size={15} />
            <span className="hist-card__symbol">{symbol}</span>
            <span className="hist-card__quote">/USDT</span>
            <span className="hist-chip hist-chip--side hist-chip--buy">BUY</span>
            <span className="hist-chip hist-chip--oco">OCO</span>
          </div>
          <span className="hist-card__type-label">Compra de mercat + OCO</span>
        </div>
        <span className="hist-result" style={{ color: resultColor }}>
          <i className={`fa-solid ${resultIcon}`} />
          {resultLabel}
        </span>
      </div>

      {/* Entry → Exit flow */}
      <div className="hist-buyoco__flow">
        <div className="hist-buyoco__leg hist-buyoco__leg--entry">
          <span className="hist-buyoco__leg-label">Entrada</span>
          <span className="hist-buyoco__leg-price mono">
            {entryPrice > 0 ? formatCurrency(entryPrice) : "—"}
          </span>
          <span className="hist-buyoco__leg-qty dim">
            {buyQty > 0 ? `${buyQty.toFixed(buyQty < 1 ? 6 : 4)} ${symbol}` : ""}
          </span>
          {entryValue > 0 && (
            <span className="hist-buyoco__leg-val mono">{formatCurrency(entryValue)}</span>
          )}
        </div>

        <div className="hist-buyoco__arrow">
          <i className="fa-solid fa-arrow-right-long" />
        </div>

        <div className="hist-buyoco__leg hist-buyoco__leg--exit">
          <span className="hist-buyoco__leg-label">Sortida</span>
          {exitLeg ? (
            <>
              <span className="hist-buyoco__leg-price mono" style={{ color: resultColor }}>
                {exitPrice > 0 ? formatCurrency(exitPrice) : "—"}
              </span>
              <span className="hist-buyoco__leg-qty dim">{resultLabel}</span>
              {exitQuote > 0 && (
                <span className="hist-buyoco__leg-val mono">{formatCurrency(exitQuote)}</span>
              )}
            </>
          ) : (
            <>
              {tpLeg && <span className="hist-buyoco__leg-price mono" style={{ color: "#16a34a" }}>TP {formatCurrency(parseFloat(tpLeg.price))}</span>}
              {slLeg && <span className="hist-buyoco__leg-qty dim">SL {formatCurrency(parseFloat(slLeg.stopPrice || slLeg.price))}</span>}
            </>
          )}
        </div>

        {pnl != null && (
          <div className={`hist-buyoco__pnl${pnlUp ? " hist-buyoco__pnl--up" : " hist-buyoco__pnl--down"}`}>
            <span className="hist-buyoco__pnl-val mono">{pnlUp ? "+" : ""}{formatCurrency(pnl)}</span>
            {pnlPct != null && (
              <span className="hist-buyoco__pnl-pct">{pnlUp ? "+" : ""}{pnlPct.toFixed(2)}%</span>
            )}
          </div>
        )}
      </div>

      {/* Details row */}
      <div className="hist-card__details">
        {duration && (
          <span className="hist-detail">
            <i className="fa-regular fa-clock" />
            <span className="hist-detail__label">Durada</span>
            <span>{duration}</span>
          </span>
        )}
        {commEntries.length > 0 && (
          <span className="hist-detail">
            <span className="hist-detail__label">Comissió</span>
            <span className="mono">{commEntries.map(([a, v]) => `${v.toFixed(6)} ${a}`).join(" + ")}</span>
          </span>
        )}
        <span className="hist-detail dim">
          <i className="fa-regular fa-calendar" />
          {fmtDate(buyOrder.time)}
        </span>
      </div>
    </div>
  );
}

function HistoryCard({ order, trades, otherLeg }: {
  order:    BinanceOrder;
  trades:   BinanceTrade[];
  otherLeg?: BinanceOrder | null;
}) {
  const result   = orderResult(order);
  const cfg      = RESULT_CFG[result];
  const symbol   = order.symbol.replace(/USDT$/, "");
  const isOco    = order.orderListId !== -1;
  const isFilled = order.status === "FILLED";

  // Quantities
  const origQty   = parseFloat(order.origQty) || 0;
  const execQty   = parseFloat(order.executedQty) || 0;
  const showQty   = isFilled ? execQty : origQty;
  const isPartial = isFilled && execQty > 0 && execQty < origQty * 0.9999;

  // Prices
  const limitPrice = parseFloat(order.price) || 0;
  const stopPrice  = parseFloat(order.stopPrice) || 0;

  // Trades for this order
  const orderTrades = trades.filter(t => t.orderId === order.orderId);
  const quoteQty    = orderTrades.reduce((s, t) => s + parseFloat(t.quoteQty), 0);
  const execVal     = quoteQty > 0 ? quoteQty : (showQty * limitPrice);
  const avgFill     = orderTrades.length > 0 && execQty > 0 ? quoteQty / execQty : null;

  // Commission
  const commByAsset: Record<string, number> = {};
  orderTrades.forEach(t => {
    commByAsset[t.commissionAsset] = (commByAsset[t.commissionAsset] ?? 0) + parseFloat(t.commission);
  });
  const commEntries = Object.entries(commByAsset).filter(([, v]) => v > 0);

  // Duration (only meaningful if > 5s)
  const durationMs    = (order.updateTime || 0) - order.time;
  const durationLabel = durationMs > 5_000 ? fmtDuration(durationMs) : null;

  // OCO other leg
  const otherLimitPrice = otherLeg ? parseFloat(otherLeg.price || "0") : null;
  const otherStopPrice  = otherLeg ? parseFloat(otherLeg.stopPrice || "0") : null;
  const otherIsFilled   = otherLeg?.status === "FILLED";
  const otherLabel      = otherLeg?.type === "LIMIT_MAKER" ? "TP" : otherLeg ? "SL" : null;
  const otherHasPrice   = otherLimitPrice != null && otherLimitPrice > 0;

  const fmtDate = (ts: number) =>
    new Date(ts).toLocaleString("ca-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  const hasDetails = (isFilled && (avgFill != null || limitPrice > 0)) ||
    stopPrice > 0 || durationLabel != null || commEntries.length > 0 || otherHasPrice;

  return (
    <div className={`hist-card hist-card--${result}`} style={{ "--hist-color": cfg.color } as React.CSSProperties}>
      <div className="hist-card__accent" />

      <div className="hist-card__icon">
        <i className={`fa-solid ${cfg.icon}`} />
      </div>

      {/* Identity: symbol + type subtitle */}
      <div className="hist-card__identity">
        <div className="hist-card__id-row">
          <CoinIcon symbol={symbol} size={15} />
          <span className="hist-card__symbol">{symbol}</span>
          <span className="hist-card__quote">/USDT</span>
          <span className={`hist-chip hist-chip--side hist-chip--${order.side.toLowerCase()}`}>
            <i className={`fa-solid fa-arrow-${order.side === "BUY" ? "up" : "down"}`} />
            {order.side}
          </span>
          {isOco && <span className="hist-chip hist-chip--oco">OCO</span>}
        </div>
        <span className="hist-card__type-label">{getTypeLabel(order)}</span>
      </div>

      <span className={`hist-result hist-result--${result}`}>
        <i className={`fa-solid ${cfg.icon}`} />
        {cfg.label}
      </span>

      <div className="hist-card__value">
        {isFilled && execVal > 0
          ? <span className="hist-card__val-main mono">{formatCurrency(execVal)}</span>
          : result === "canceled"
            ? <span className="dim">—</span>
            : limitPrice > 0
              ? <span className="hist-card__val-main mono dim">{formatCurrency(origQty * limitPrice)}</span>
              : <span className="dim">—</span>
        }
        {showQty > 0 && (
          <span className="hist-card__val-qty dim">
            {isPartial
              ? `${execQty.toFixed(execQty < 1 ? 6 : 4)} / ${origQty.toFixed(origQty < 1 ? 6 : 4)}`
              : showQty.toFixed(showQty < 1 ? 6 : 4)
            } {symbol}
          </span>
        )}
      </div>

      <div className="hist-card__date dim">
        {fmtDate(order.updateTime || order.time)}
      </div>

      {hasDetails && (
        <div className="hist-card__details">
          {/* Avg fill price */}
          {isFilled && avgFill != null && (
            <span className="hist-detail">
              <span className="hist-detail__label">Preu mig exec.</span>
              <span className="mono">{formatCurrency(avgFill)}</span>
            </span>
          )}
          {/* Limit price (when no avg fill available) */}
          {isFilled && avgFill == null && limitPrice > 0 && (
            <span className="hist-detail">
              <span className="hist-detail__label">Preu límit</span>
              <span className="mono">{formatCurrency(limitPrice)}</span>
            </span>
          )}
          {/* Stop trigger */}
          {stopPrice > 0 && (
            <span className="hist-detail">
              <span className="hist-detail__label">Stop activació</span>
              <span className="mono">{formatCurrency(stopPrice)}</span>
              {limitPrice > 0 && (
                <span className="dim">→ límit {formatCurrency(limitPrice)}</span>
              )}
            </span>
          )}
          {/* Duration */}
          {durationLabel && (
            <span className="hist-detail">
              <i className="fa-regular fa-clock" />
              <span className="hist-detail__label">Durada</span>
              <span>{durationLabel}</span>
            </span>
          )}
          {/* Commission */}
          {commEntries.length > 0 && (
            <span className="hist-detail">
              <span className="hist-detail__label">Comissió</span>
              <span className="mono">
                {commEntries.map(([a, v]) => `${v.toFixed(6)} ${a}`).join(" + ")}
              </span>
            </span>
          )}
          {/* OCO other leg */}
          {otherHasPrice && otherLabel && (
            <span className={`hist-detail${otherIsFilled ? "" : " hist-detail--canceled"}`}>
              {!otherIsFilled && <i className="fa-solid fa-ban" />}
              <span className="hist-detail__label">
                {otherLabel} {otherIsFilled ? "executat" : "cancel·lat"}
              </span>
              {otherStopPrice != null && otherStopPrice > 0 && (
                <span className="mono">stop {formatCurrency(otherStopPrice)} →</span>
              )}
              <span className="mono">{formatCurrency(otherLimitPrice!)}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/* ── OCO → Trailing tree ── */
function HistoryTree({ group, trades }: { group: OcoGroup; trades: BinanceTrade[] }) {
  const [open, setOpen] = useState(true);
  const tm = group.trailingMeta!;
  const symbol = group.filled.symbol.replace(/USDT$/, "");
  const fmtDate = (ts: number) =>
    new Date(ts).toLocaleString("ca-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  // Find TP and SL legs by type
  const legs = [group.filled, group.other].filter(Boolean) as BinanceOrder[];
  const tpLeg = legs.find(l => l.type === "LIMIT_MAKER");
  const slLeg = legs.find(l => l.type === "STOP_LOSS_LIMIT" || l.type === "STOP_LOSS");

  return (
    <div className="hist-tree">
      {/* Parent row: OCO converted to trailing */}
      <div className="hist-card hist-card--trailing-parent" style={{ "--hist-color": "#8b5cf6" } as React.CSSProperties}>
        <div className="hist-card__accent" />
        <div className="hist-card__icon">
          <i className="fa-solid fa-chart-line" />
        </div>
        <div className="hist-card__identity">
          <CoinIcon symbol={symbol} size={15} />
          <span className="hist-card__symbol">{symbol}</span>
          <span className="hist-card__quote">/USDT</span>
          <span className="hist-chip hist-chip--oco">OCO</span>
          <span className="hist-chip hist-chip--trailing">→ Trailing</span>
        </div>
        <span className="hist-result hist-result--trailing">
          <i className="fa-solid fa-chart-line" />
          Trailing activat
        </span>
        <div className="hist-card__value" />
        <div className="hist-card__date dim">
          {fmtDate(group.filled.updateTime || group.filled.time)}
        </div>
        <div className="hist-card__details">
          {tpLeg && parseFloat(tpLeg.price) > 0 && (
            <span className="hist-detail hist-detail--canceled">
              <i className="fa-solid fa-ban" />
              <span className="hist-detail__label">TP cancel·lat</span>
              <span className="mono">{formatCurrency(parseFloat(tpLeg.price))}</span>
            </span>
          )}
          {slLeg && parseFloat(slLeg.stopPrice || slLeg.price) > 0 && (
            <span className="hist-detail hist-detail--canceled">
              <i className="fa-solid fa-ban" />
              <span className="hist-detail__label">SL cancel·lat</span>
              <span className="mono">{formatCurrency(parseFloat(slLeg.stopPrice || slLeg.price))}</span>
            </span>
          )}
          <span className="hist-detail">
            <span className="hist-detail__label">Dist. trail</span>
            <span className="mono">{formatCurrency(tm.trailDist)}</span>
          </span>
          <span className="hist-detail">
            <span className="hist-detail__label">Pic activació</span>
            <span className="mono">{formatCurrency(tm.peakPrice)}</span>
          </span>
        </div>
        <button className="hist-tree__toggle" onClick={() => setOpen(v => !v)} title={open ? "Amaga fill" : "Mostra fill"}>
          <i className={`fa-solid fa-chevron-${open ? "up" : "down"}`} />
        </button>
      </div>

      {/* Child: trailing SL order */}
      {open && (
        <div className="hist-tree__child">
          <div className="hist-tree__connector" />
          {group.trailingOrder ? (
            <HistoryCard order={group.trailingOrder} trades={trades} />
          ) : (
            <div className="hist-tree__stub">
              <i className="fa-solid fa-arrow-trend-up" />
              Trailing SL #{tm.slOrderId} · <span className="hist-chip hist-chip--oco" style={{ fontSize: "0.65rem" }}>{tm.status}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HistoryTable({ orders, loading, error }: {
  orders: BinanceOrder[]; loading: boolean; error: string | null;
}) {
  const [trades,         setTrades]         = useState<BinanceTrade[]>([]);
  const [trailingActives, setTrailingActives] = useState<TrailingActiveInfo[]>([]);
  const [loadingT,       setLoadingT]       = useState(true);

  useEffect(() => {
    setLoadingT(true);
    Promise.all([
      fetch("/api/trades").then(r => r.json()),
      fetch("/api/orders/trailing").then(r => r.json()),
    ]).then(([tradesData, trailingData]) => {
      if (!tradesData.error) setTrades(tradesData);
      if (trailingData.active) setTrailingActives(trailingData.active);
    }).finally(() => setLoadingT(false));
  }, []);

  if (loading || loadingT) return <div className="state-empty">Loading…</div>;
  if (error)               return <div className="state-error">{error}</div>;
  if (!orders.length)      return <div className="state-empty">No orders found.</div>;

  const items = groupOrders(orders, trailingActives);

  const wins     = orders.filter(o => orderResult(o) === "tp").length;
  const losses   = orders.filter(o => orderResult(o) === "sl").length;
  const canceled = orders.filter(o => orderResult(o) === "canceled").length;
  const winRate  = (wins + losses) > 0 ? Math.round((wins / (wins + losses)) * 100) : null;

  const totalVolume = orders
    .filter(o => o.status === "FILLED")
    .reduce((s, o) => {
      const qty   = parseFloat(o.executedQty) || 0;
      const price = parseFloat(o.price) || 0;
      return s + qty * price;
    }, 0);

  return (
    <div className="hist-wrap">

      {/* ── 5 KPIs ── */}
      <div className="section-title">
        <i className="fa-solid fa-clock-rotate-left" /> Historial
      </div>
      <div className="portfolio__cards bal-cards-row">
        {(() => {
          const wrColor = winRate === null ? "neutral" : winRate >= 50 ? "green" : "red";
          return (
            <div className={`portfolio__card portfolio__card--${wrColor}`}>
              <span className="portfolio__card-label"><i className="fa-solid fa-percent" /> Win rate</span>
              <span className="portfolio__card-value">{winRate !== null ? `${winRate}%` : "—"}</span>
              <span className="portfolio__card-sub">{wins + losses} operacions tancades</span>
            </div>
          );
        })()}
        <div className="portfolio__card portfolio__card--green">
          <span className="portfolio__card-label"><i className="fa-solid fa-check" /> TP Guanys</span>
          <span className="portfolio__card-value portfolio__card-value--count">{wins}</span>
          <span className="portfolio__card-sub">take profit assolits</span>
        </div>
        <div className="portfolio__card portfolio__card--red">
          <span className="portfolio__card-label"><i className="fa-solid fa-xmark" /> SL Pèrdues</span>
          <span className="portfolio__card-value portfolio__card-value--count">{losses}</span>
          <span className="portfolio__card-sub">stop loss activats</span>
        </div>
        <div className="portfolio__card portfolio__card--neutral">
          <span className="portfolio__card-label"><i className="fa-solid fa-ban" /> Cancel·lats</span>
          <span className="portfolio__card-value portfolio__card-value--count">{canceled}</span>
          <span className="portfolio__card-sub">ordres cancel·lades</span>
        </div>
        <div className="portfolio__card portfolio__card--neutral">
          <span className="portfolio__card-label"><i className="fa-solid fa-chart-bar" /> Volum operat</span>
          <span className="portfolio__card-value">{totalVolume > 0 ? formatCurrency(totalVolume) : "—"}</span>
          <span className="portfolio__card-sub">USDT total executat</span>
        </div>
      </div>

      {/* Cards list */}
      <div className="hist-list">
        {items.map((item) => {
          if (item.kind === "buy+oco") {
            return <BuyOcoCard key={`buyoco-${item.group.id}`} buyOrder={item.buyOrder} group={item.group} trades={trades} />;
          }
          if (item.kind === "solo") {
            return <HistoryCard key={item.order.orderId} order={item.order} trades={trades} />;
          }
          if (item.group.trailingMeta) {
            return <HistoryTree key={`oco-trail-${item.group.id}`} group={item.group} trades={trades} />;
          }
          return (
            <HistoryCard
              key={`oco-${item.group.id}`}
              order={item.group.filled}
              trades={trades}
              otherLeg={item.group.other}
            />
          );
        })}
      </div>
    </div>
  );
}

/* ── Balance cards ── */
function BalanceTable({ balances, loading, error, coins, openOrders }: {
  balances: BinanceBalance[]; loading: boolean; error: string | null; coins: CoinRow[];
  openOrders: BinanceOrder[];
}) {
  if (loading) return <div className="state-empty">Carregant…</div>;
  if (error)   return <div className="state-error">{error}</div>;
  if (!balances.length) return <div className="state-empty">Cap asset amb saldo.</div>;

  const priceMap = new Map<string, number>();
  for (const c of coins) priceMap.set(c.symbol, c.price);
  priceMap.set("USDT", 1);
  priceMap.set("USDC", 1);
  priceMap.set("BUSD", 1);
  priceMap.set("FDUSD", 1);
  priceMap.set("TUSD", 1);

  const ordersPerAsset = new Map<string, number>();
  for (const o of openOrders) {
    const asset = o.symbol.replace(/USDT$|BUSD$|USDC$|FDUSD$|TUSD$/, "");
    ordersPerAsset.set(asset, (ordersPerAsset.get(asset) ?? 0) + 1);
  }

  const enriched = balances.map(b => {
    const free   = parseFloat(b.free);
    const locked = parseFloat(b.locked);
    const total  = free + locked;
    const price  = priceMap.get(b.asset) ?? 0;
    const usdVal = total * price;
    return { ...b, free, locked, total, price, usdVal };
  }).sort((a, b_) => {
    const aStable = STABLES.has(a.asset);
    const bStable = STABLES.has(b_.asset);
    if (aStable && !bStable) return -1;
    if (!aStable && bStable) return 1;
    return b_.usdVal - a.usdVal;
  });

  const totalUsd    = enriched.reduce((s, b) => s + b.usdVal, 0);
  const totalFree   = enriched.reduce((s, b) => s + b.free * b.price, 0);
  const totalLocked = enriched.reduce((s, b) => s + b.locked * b.price, 0);
  const nonStable   = enriched.filter(b => !STABLES.has(b.asset));
  const biggest     = nonStable.length > 0 ? nonStable[0] : null;
  const assetCount  = nonStable.length;

  return (
    <div className="bal-tab">
      <div className="section-title">
        <i className="fa-solid fa-coins" /> Balanç
      </div>

      {/* ── 5 indicadors ── */}
      <div className="portfolio__cards bal-cards-row">
        <div className="portfolio__card portfolio__card--blue">
          <span className="portfolio__card-label"><i className="fa-solid fa-wallet" /> Total</span>
          <span className="portfolio__card-value">{formatCurrency(totalUsd)}</span>
          <span className="portfolio__card-sub">{enriched.length} assets</span>
        </div>
        <div className="portfolio__card portfolio__card--green">
          <span className="portfolio__card-label"><i className="fa-solid fa-lock-open" /> Lliure</span>
          <span className="portfolio__card-value">{formatCurrency(totalFree)}</span>
          <span className="portfolio__card-sub">{totalUsd > 0 ? ((totalFree / totalUsd) * 100).toFixed(1) : "0"}% del total</span>
        </div>
        <div className={`portfolio__card portfolio__card--${totalLocked > 0 ? "neutral" : "neutral"}`}>
          <span className="portfolio__card-label"><i className="fa-solid fa-lock" /> Blocat</span>
          <span className="portfolio__card-value" style={{ color: totalLocked > 0 ? "var(--yellow)" : "var(--text-3)" }}>
            {formatCurrency(totalLocked)}
          </span>
          <span className="portfolio__card-sub">{totalUsd > 0 ? ((totalLocked / totalUsd) * 100).toFixed(1) : "0"}% del total</span>
        </div>
        <div className="portfolio__card portfolio__card--neutral">
          <span className="portfolio__card-label"><i className="fa-solid fa-layer-group" /> Cryptos</span>
          <span className="portfolio__card-value portfolio__card-value--count">{assetCount}</span>
          <span className="portfolio__card-sub">actius no-stable</span>
        </div>
        <div className="portfolio__card portfolio__card--neutral">
          <span className="portfolio__card-label"><i className="fa-solid fa-trophy" /> Major posició</span>
          {biggest ? (
            <>
              <span className="portfolio__card-value" style={{ fontSize: "1rem" }}>{biggest.asset}</span>
              <span className="portfolio__card-sub">{formatCurrency(biggest.usdVal)} · {totalUsd > 0 ? ((biggest.usdVal / totalUsd) * 100).toFixed(1) : "0"}%</span>
            </>
          ) : (
            <span className="portfolio__card-value" style={{ color: "var(--text-3)" }}>—</span>
          )}
        </div>
      </div>

      <div className="bal-body">

        {/* ── Taula ── */}
        <div className="bal-table-col">
          <div className="bal-header">
            <div />
            <span>Asset</span>
            <span>Total</span>
            <span>Lliure</span>
            <span>Bloq.</span>
            <span>Ord.</span>
            <span>Preu</span>
          </div>
          <div className="bal-list">
            {enriched.map(b => {
              const isStable = STABLES.has(b.asset);
              const dp  = b.total < 1 ? 6 : b.total < 100 ? 4 : 2;
              const pct = totalUsd > 0 ? (b.usdVal / totalUsd) * 100 : 0;
              const freeUsd   = b.free   * b.price;
              const lockedUsd = b.locked * b.price;
              const ordCount  = ordersPerAsset.get(b.asset) ?? 0;
              return (
                <div key={b.asset} className="bal-row">
                  <div className="bal-row__accent"
                    style={{ background: isStable ? "var(--blue)" : "var(--accent)" }} />
                  <div className="bal-row__identity">
                    <CoinIcon symbol={b.asset} size={26} />
                    <div>
                      <span className="bal-row__symbol">{b.asset}</span>
                      {pct > 0 && <span className="bal-row__pct">{pct.toFixed(1)}%</span>}
                    </div>
                  </div>
                  {/* Total */}
                  <div className="bal-row__cell">
                    {b.usdVal > 0 && <span className="bal-row__cell-main">{formatCurrency(b.usdVal)}</span>}
                    <span className="mono bal-row__cell-sub">{b.total.toFixed(dp)}</span>
                  </div>
                  {/* Lliure */}
                  <div className="bal-row__cell bal-row__cell--free">
                    {freeUsd > 0 && <span className="bal-row__cell-main">{formatCurrency(freeUsd)}</span>}
                    <span className="mono bal-row__cell-sub">{b.free.toFixed(dp)}</span>
                  </div>
                  {/* Blocat */}
                  <div className={`bal-row__cell${b.locked > 0 ? " bal-row__cell--locked" : " bal-row__cell--zero"}`}>
                    {b.locked > 0 ? (
                      <>
                        {lockedUsd > 0 && <span className="bal-row__cell-main">{formatCurrency(lockedUsd)}</span>}
                        <span className="mono bal-row__cell-sub">
                          <i className="fa-solid fa-lock" style={{ fontSize: "0.5rem" }} /> {b.locked.toFixed(dp)}
                        </span>
                      </>
                    ) : <span className="bal-row__cell-main" style={{ color: "var(--text-3)" }}>—</span>}
                  </div>
                  {/* Ordres obertes */}
                  <div className="bal-row__orders">
                    {ordCount > 0
                      ? <span className="bal-row__orders-badge">{ordCount}</span>
                      : <span className="bal-row__orders--none">—</span>}
                  </div>
                  {/* Preu */}
                  <span className="mono bal-row__price">
                    {b.price > 0 && !isStable ? formatCurrency(b.price) : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Gràfic de barres ── */}
        <div className="bal-chart-col">
          <div className="section-title">
            <i className="fa-solid fa-chart-bar" /> Distribució
          </div>
          <div className="bal-bars">
            {(() => {
              const visible  = enriched.filter(b => b.usdVal > 0);
              const maxUsd   = Math.max(...visible.map(b => b.usdVal));
              return visible.map(b => {
                const pct       = totalUsd > 0 ? (b.usdVal / totalUsd) * 100 : 0;
                const barWidth  = maxUsd  > 0 ? (b.usdVal / maxUsd)   * 100 : 0;
                const freePct   = b.total > 0 ? (b.free   / b.total)  * 100 : 100;
                const lockedPct = b.total > 0 ? (b.locked / b.total)  * 100 : 0;
                return (
                  <div key={b.asset} className="bal-bar">
                    <div className="bal-bar__label">
                      <CoinIcon symbol={b.asset} size={11} />
                      <span className="bal-bar__sym">{b.asset}</span>
                      <span className="bal-bar__pct">{pct.toFixed(1)}%</span>
                      <span className="bal-bar__usd">{formatCurrency(b.usdVal)}</span>
                    </div>
                    <div className="bal-bar__track">
                      <div className="bal-bar__fill" style={{
                        width: `${barWidth}%`,
                        background: lockedPct > 0
                          ? `linear-gradient(to right, var(--green) ${freePct}%, var(--yellow) ${freePct}%)`
                          : `var(--green)`,
                      }} />
                    </div>
                  </div>
                );
              });
            })()}
            <div className="bal-bar__legend">
              <span className="bal-bar__legend-item bal-bar__legend-item--free">Lliure</span>
              <span className="bal-bar__legend-item bal-bar__legend-item--locked">Blocat</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

/* ── Main panel ── */
export default function OrdersPanel({ coins, tab, onTab, onOrdersCount }: {
  coins: CoinRow[];
  tab: Tab;
  onTab: (t: Tab) => void;
  onOrdersCount?: (n: number) => void;
}) {
  const setTab = onTab;
  const { viewMode } = useTradingMode();
  // Mode derived from active tab (takes precedence over global context for open orders / history)
  const tabMode = (tab === "open-real" || tab === "history-real" || tab === "portfolio-real" || tab === "balance-real") ? "real" : "paper";
  const [showNewOrder,    setShowNewOrder]    = useState(false);
  const [openOrders,      setOpenOrders]      = useState<BinanceOrder[]>([]);
  const [tgSending,       setTgSending]       = useState(false);
  const [tgStatus,        setTgStatus]        = useState<"idle" | "ok" | "err">("idle");
  const [tgOrdSending,    setTgOrdSending]    = useState(false);
  const [tgOrdStatus,     setTgOrdStatus]     = useState<"idle" | "ok" | "err">("idle");
  const [panicState,      setPanicState]      = useState<"idle" | "confirm" | "confirm-sell" | "running" | "done" | "err">("idle");
  const [panicMsg,        setPanicMsg]        = useState<string>("");
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
  const [orderMeta,   setOrderMeta  ] = useState<Record<string, OrderMeta>>({});
  const [newOrderPrefill, setNewOrderPrefill] = useState<{
    pair: string; side: "BUY" | "SELL"; tp: string; sl: string; slLimit: string; interval?: "5m" | "1h" | "4h";
  } | null>(null);

  const fmtRefreshed = (d: Date) =>
    d.toLocaleTimeString("ca-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  const fetchOpen = useCallback(() => {
    setLoadingO(true); setErrorO(null);
    fetch(`/api/orders?mode=${tabMode}`).then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setOpenOrders(d); setLastRefreshed(new Date()); onOrdersCount?.(d.length); })
      .catch(e => setErrorO(e.message)).finally(() => setLoadingO(false));
    fetch("/api/orders/meta").then(r => r.json()).then(d => { if (!d.error) setOrderMeta(d); }).catch(() => {});
  }, [tabMode]);

  const fetchHistory = useCallback(() => {
    setLoadingH(true); setErrorH(null);
    fetch(`/api/orders/history?mode=${tabMode}`).then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setHistory(d); })
      .catch(e => setErrorH(e.message)).finally(() => setLoadingH(false));
  }, [tabMode]);

  const fetchBalance = useCallback(() => {
    setLoadingB(true); setErrorB(null);
    fetch(`/api/balance?mode=${tabMode}`).then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setBalances(d); })
      .catch(e => setErrorB(e.message)).finally(() => setLoadingB(false));
  }, [tabMode]);

  useEffect(() => {
    fetchOpen();
    if (refreshMs === 0) return;
    const id = setInterval(fetchOpen, refreshMs);
    return () => clearInterval(id);
  }, [fetchOpen, refreshMs]);

  useEffect(() => {
    if ((tab === "history" || tab === "history-real") && !loadingH) fetchHistory();
  }, [tab, fetchHistory]);

  useEffect(() => {
    if ((tab === "balance" || tab === "balance-real") && !loadingB) fetchBalance();
  }, [tab, fetchBalance]);

  // Load strategies once on mount
  useEffect(() => {
    fetch("/api/strategies").then(r => r.json()).then(d => { if (!d.error) setStrategies(d); });
    fetch("/api/orders/meta").then(r => r.json()).then(d => { if (!d.error) setOrderMeta(d); });
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
    pair: string, side: "BUY" | "SELL", tp: string, sl: string, slLimit: string, interval?: "5m" | "1h" | "4h",
  ) => {
    setNewOrderPrefill({ pair, side, tp, sl, slLimit, interval });
    setShowNewOrder(true);
  }, []);

  return (
    <div className="card">
      <div className="panel-controls">
        <span className="panel-controls__title">
          {tab === "portfolio" && "Portfolio"}
          {tab === "open"      && `Open Orders${openOrders.length ? ` (${openOrders.length})` : ""}`}
          {tab === "history"   && "History"}
          {tab === "balance"   && "Balance"}
          {tab === "analysis"  && "Anàlisi"}
          {tab === "matrix"    && "Escàner"}
          {tab === "errors"    && "Errors del sistema"}
          {tab === "logs"     && "Logs del servidor"}
          {tab === "settings"  && "Configuració"}
          {tab === "journal"   && "Diari d'operacions"}
          {tab === "simulation" && "Simulació"}
          {tab === "convert"    && "Convertir crypto"}
          {tab === "bot"        && "Bot"}
          {tab === "equalizer"  && "Equalitzador"}
          {tab === "autolab"    && "AutoLab"}
          {tab === "status"     && "Motors"}
        </span>
        <div className="panel-controls__right">

          {/* Nova ordre */}
          <button className="tb-btn tb-btn--primary" onClick={() => setShowNewOrder(true)}>
            <i className="fa-solid fa-plus" /> Nova ordre
          </button>

          <div className="tb-sep" />

          {/* Grup Telegram */}
          <div className="tb-group">
            <button
              className={`tb-btn tb-btn--tg${tgOrdStatus === "ok" ? " tb-btn--ok" : tgOrdStatus === "err" ? " tb-btn--err" : ""}`}
              disabled={tgOrdSending}
              onClick={async () => {
                setTgOrdSending(true); setTgOrdStatus("idle");
                try { const r = await fetch("/api/telegram/orders", { method: "POST" }); setTgOrdStatus(r.ok ? "ok" : "err"); }
                catch { setTgOrdStatus("err"); }
                finally { setTgOrdSending(false); setTimeout(() => setTgOrdStatus("idle"), 3000); }
              }}>
              {tgOrdSending ? <i className="fa-solid fa-spinner fa-spin" /> : tgOrdStatus === "ok" ? <i className="fa-solid fa-check" /> : tgOrdStatus === "err" ? <i className="fa-solid fa-xmark" /> : <i className="fa-brands fa-telegram" />}
              {tgOrdStatus === "ok" ? "Enviat" : tgOrdStatus === "err" ? "Error" : "Ordres"}
            </button>
            <button
              className={`tb-btn tb-btn--tg${tgStatus === "ok" ? " tb-btn--ok" : tgStatus === "err" ? " tb-btn--err" : ""}`}
              disabled={tgSending}
              onClick={async () => {
                setTgSending(true); setTgStatus("idle");
                try { const r = await fetch("/api/telegram/report", { method: "POST" }); setTgStatus(r.ok ? "ok" : "err"); }
                catch { setTgStatus("err"); }
                finally { setTgSending(false); setTimeout(() => setTgStatus("idle"), 3000); }
              }}>
              {tgSending ? <i className="fa-solid fa-spinner fa-spin" /> : tgStatus === "ok" ? <i className="fa-solid fa-check" /> : tgStatus === "err" ? <i className="fa-solid fa-xmark" /> : <i className="fa-brands fa-telegram" />}
              {tgStatus === "ok" ? "Enviat" : tgStatus === "err" ? "Error" : "Informe"}
            </button>
          </div>

          <div className="tb-sep" />

          {/* Botó de pànic */}
          <button
            className="tb-btn tb-btn--panic"
            onClick={() => setPanicState("confirm")}
            title="Cancel·la totes les ordres obertes">
            <i className="fa-solid fa-triangle-exclamation" /> Pànic
          </button>

          {tab === "logs" && <>
            <div className="tb-sep" />
            <button className="tb-btn" title="Exporta informe d'estratègia (7 dies) per analitzar amb IA"
              onClick={() => window.open("/api/logs/export?days=7", "_blank")}>
              <i className="fa-solid fa-file-arrow-down" /> Exporta per IA
            </button>
          </>}

          <div className="tb-sep" />

          {/* Grup refresc */}
          <div className="tb-group">
            <select className="tb-btn tb-btn--select" value={refreshMs}
              onChange={e => setRefreshMs(Number(e.target.value))}>
              <option value={5000}>5s</option>
              <option value={15000}>15s</option>
              <option value={30000}>30s</option>
              <option value={60000}>1 min</option>
              <option value={0}>Manual</option>
            </select>
            <button className="tb-btn" onClick={() => {
              fetchOpen(); setRefreshTrigger(n => n + 1);
              if (tab === "history" || tab === "history-real") fetchHistory();
              if (tab === "balance" || tab === "balance-real") fetchBalance();
            }}>
              <i className="fa-solid fa-rotate-right" /> Refresca
            </button>
          </div>

        </div>
      </div>

      {tab === "portfolio"      && <ErrorBoundary label="Portfolio Paper"><PortfolioTab coins={coins} openOrders={openOrders} refreshTrigger={refreshTrigger} mode="paper" /></ErrorBoundary>}
      {tab === "portfolio-real" && <ErrorBoundary label="Portfolio Real"><PortfolioTab coins={coins} openOrders={openOrders} refreshTrigger={refreshTrigger} mode="real" /></ErrorBoundary>}
      {tab === "open"           && <ErrorBoundary label="Ordres Paper"><OpenOrderTable orders={openOrders} loading={loadingO} error={errorO} onRefresh={fetchOpen} coins={coins} strategies={strategies} onStrategyChange={handleStrategyChange} orderMeta={orderMeta} /></ErrorBoundary>}
      {tab === "open-real"      && <ErrorBoundary label="Ordres Real"><OpenOrderTable orders={openOrders} loading={loadingO} error={errorO} onRefresh={fetchOpen} coins={coins} strategies={strategies} onStrategyChange={handleStrategyChange} orderMeta={orderMeta} /></ErrorBoundary>}
      {tab === "history"        && <ErrorBoundary label="Historial Paper"><HistoryTable orders={history} loading={loadingH} error={errorH} /></ErrorBoundary>}
      {tab === "history-real"   && <ErrorBoundary label="Historial Real"><HistoryTable orders={history} loading={loadingH} error={errorH} /></ErrorBoundary>}
      {tab === "balance"      && <ErrorBoundary label="Balance Paper"><BalanceTable balances={balances} loading={loadingB} error={errorB} coins={coins} openOrders={openOrders} /></ErrorBoundary>}
      {tab === "balance-real" && <ErrorBoundary label="Balance Real"><BalanceTable balances={balances} loading={loadingB} error={errorB} coins={coins} openOrders={openOrders} /></ErrorBoundary>}
      {tab === "analysis"  && <ErrorBoundary label="Anàlisi"><AnalysisTab onOpenOrder={handleOpenOrderFromAnalysis} /></ErrorBoundary>}
      {tab === "matrix"    && <ErrorBoundary label="Escàner"><StrategyMatrix coins={coins} onOpenOrder={handleOpenOrderFromAnalysis} /></ErrorBoundary>}
      {tab === "errors"    && <ErrorsPanel />}
      {tab === "logs"     && <LogsPanel />}
      {tab === "settings"  && <SettingsTab />}
      {tab === "journal"      && <ErrorBoundary label="Diari Paper"><JournalTab onNewOrder={() => setShowNewOrder(true)} mode="paper" /></ErrorBoundary>}
      {tab === "journal-real" && <ErrorBoundary label="Diari Real"><JournalTab onNewOrder={() => setShowNewOrder(true)} mode="real" /></ErrorBoundary>}
      {tab === "simulation" && <ErrorBoundary label="Simulació"><SimulationTab /></ErrorBoundary>}
      {tab === "convert"    && <ErrorBoundary label="Convertir"><ConvertTab mode={viewMode} /></ErrorBoundary>}
      {tab === "bot"        && <ErrorBoundary label="Bot Paper"><BotTab mode="paper" /></ErrorBoundary>}
      {tab === "bot-real"   && <ErrorBoundary label="Bot Real"><BotTab mode="real" /></ErrorBoundary>}
      {tab === "equalizer"  && <ErrorBoundary label="Equalitzador"><EqualizerTab /></ErrorBoundary>}
      {tab === "autolab"    && <ErrorBoundary label="AutoLab"><AutoLabTab /></ErrorBoundary>}
      {tab === "status"     && <ErrorBoundary label="Motors"><StatusTab /></ErrorBoundary>}
      {tab === "deploy"     && <ErrorBoundary label="Desplegament"><DeployTab /></ErrorBoundary>}

      <div className="panel-footer">
        <span className="panel-footer__dot" />
        {tabMode === "real" ? "Binance Real" : "Binance Demo"} · {refreshMs === 0 ? "refresc manual" : `auto-refresh ${refreshMs / 1000}s`}
        {lastRefreshed && (
          <span className="panel-footer__right">
            <span className="panel-footer__refreshed">
              <i className="fa-solid fa-clock" />
              {fmtRefreshed(lastRefreshed)}
            </span>
          </span>
        )}
      </div>

      {/* ── Panic modal ── */}
      {panicState !== "idle" && (
        <div className="panic-overlay" onClick={() => { if (panicState === "confirm" || panicState === "confirm-sell" || panicState === "done" || panicState === "err") setPanicState("idle"); }}>
          <div className="panic-modal" onClick={e => e.stopPropagation()}>
            <div className="panic-modal__icon">
              <i className="fa-solid fa-triangle-exclamation" />
            </div>
            <div className="panic-modal__title">Botó de Pànic</div>

            {(panicState === "confirm" || panicState === "confirm-sell") && (<>
              <p className="panic-modal__desc">
                Selecciona el tipus de cancel·lació:
              </p>
              <div className="panic-modal__actions">
                <button className="panic-modal__btn panic-modal__btn--cancel-only"
                  onClick={async () => {
                    setPanicState("running");
                    try {
                      const r = await fetch("/api/orders/cancel-all", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sellAll: false, mode: viewMode }) });
                      const d = await r.json() as { canceledOrders?: number };
                      setPanicMsg(`${d.canceledOrders ?? 0} ordres cancel·lades.`);
                      setPanicState("done");
                      fetchOpen();
                    } catch (e) { setPanicMsg((e as Error).message); setPanicState("err"); }
                  }}>
                  <i className="fa-solid fa-xmark" /> Cancel·la ordres
                  <span className="panic-modal__btn-sub">Manté les criptos al compte</span>
                </button>
                <button className="panic-modal__btn panic-modal__btn--sell-all"
                  onClick={async () => {
                    setPanicState("running");
                    try {
                      const r = await fetch("/api/orders/cancel-all", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sellAll: true, mode: viewMode }) });
                      const d = await r.json() as { canceledOrders?: number; soldPositions?: number };
                      setPanicMsg(`${d.canceledOrders ?? 0} ordres cancel·lades · ${d.soldPositions ?? 0} posicions venudes.`);
                      setPanicState("done");
                      fetchOpen();
                    } catch (e) { setPanicMsg((e as Error).message); setPanicState("err"); }
                  }}>
                  <i className="fa-solid fa-fire" /> Cancel·la + Ven tot
                  <span className="panic-modal__btn-sub">Converteix tot a USDT</span>
                </button>
              </div>
              <button className="panic-modal__close" onClick={() => setPanicState("idle")}>Tancar</button>
            </>)}

            {panicState === "running" && (
              <p className="panic-modal__desc">
                <i className="fa-solid fa-spinner fa-spin" /> Executant…
              </p>
            )}

            {(panicState === "done" || panicState === "err") && (<>
              <p className="panic-modal__desc" style={{ color: panicState === "done" ? "#059669" : "#dc2626" }}>
                {panicState === "done" ? <i className="fa-solid fa-check" /> : <i className="fa-solid fa-xmark" />}
                {" "}{panicMsg}
              </p>
              <button className="panic-modal__close" onClick={() => setPanicState("idle")}>Tancar</button>
            </>)}
          </div>
        </div>
      )}

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
            interval: newOrderPrefill.interval,
          } : undefined}
        />
      )}
    </div>
  );
}
