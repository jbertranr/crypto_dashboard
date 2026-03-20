"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { CoinRow } from "../lib/types";
import CoinIcon from "./CoinIcon";
import { formatCurrency } from "../lib/format";
import {
  ResponsiveContainer, AreaChart, Area,
  XAxis, YAxis, ReferenceLine,
} from "recharts";

const INTERVALS = ["5m", "1h", "4h"] as const;
type Interval = (typeof INTERVALS)[number];

const COIN_COLORS: Record<string, string> = {
  BTC: "#F7931A", ETH: "#627EEA", BNB: "#F3BA2F",
  SOL: "#9945FF", XRP: "#00AAE4", ADA: "#0033AD",
  AVAX: "#E84142", DOT: "#E6007A", LINK: "#2A5ADA",
  MATIC: "#8247E5", DOGE: "#C2A633", SHIB: "#FFA409",
  UNI: "#FF007A", LTC: "#A0A0A0", ATOM: "#6F4E9C",
  NEAR: "#00C08B", OP: "#FF0420", ARB: "#12AAFF",
  TRX: "#EB0029", TON: "#0088CC",
};

const CONF_OPACITY: Record<string, number> = { alta: 1, moderada: 0.6, baixa: 0.3 };
const TYPE_COLOR: Record<string, string> = {
  bullish: "#16a34a",
  bearish: "#ef4444",
  neutral: "#64748b",
};

/* Short strategy names for the legend */
const STRAT_META = [
  { short: "TF↑", label: "Trend Following Alcista", color: "#16a34a" },
  { short: "TF↓", label: "Trend Following Bajista", color: "#ef4444" },
  { short: "Rev↑", label: "Reversió Alcista",       color: "#22c55e" },
  { short: "Rev↓", label: "Reversió Bajista",       color: "#f97316" },
  { short: "BRK", label: "Breakout Alcista",        color: "#a78bfa" },
];

type TrailingSuggestion = {
  activateAt: number; distance: number;
  activateAtr: number; distanceAtr: number; logic: string;
};

type StratRow = {
  type: "bullish" | "bearish" | "neutral";
  confidence: "alta" | "moderada" | "baixa";
  active: boolean;
  tp: number; sl: number; slLimit: number;
  name: string;
  keySignal: string;
  trailing: TrailingSuggestion | null;
};

type CellData = {
  score: number;
  verdict: "BUY" | "WAIT" | "AVOID";
  strategies: StratRow[];
  price: number;
  atr: number;
  fetchedAt: number; // ms timestamp quan es van carregar les dades
};

type CellState = CellData | "loading" | "error";

const INTERVAL_BONUS: Record<string, number> = { "4h": 10, "1h": 5, "5m": 0 };
const CONF_BONUS: Record<string, number>     = { alta: 10, moderada: 5, baixa: 0 };

type Opportunity = {
  coin: CoinRow;
  interval: Interval;
  probability: number;
  strategy: StratRow | null;
  price: number;
  tp: number;
  sl: number;
  recommended: boolean;
  trailing: TrailingSuggestion | null;
  fetchedAt: number;
};

function computeOpportunities(
  coins: CoinRow[],
  cache: Record<string, CellState>,
): Opportunity[] {
  const opps: Opportunity[] = [];

  for (const coin of coins) {
    // Pass 1: best BUY interval with active bullish strategy
    let best: Opportunity | null = null;

    const confluence = INTERVALS.filter(i => {
      const c = cache[`${coin.pair}:${i}`];
      return c && c !== "loading" && c !== "error" && (c as CellData).verdict === "BUY";
    }).length;

    for (const iv of INTERVALS) {
      const d = cache[`${coin.pair}:${iv}`];
      if (!d || d === "loading" || d === "error") continue;
      if (d.verdict !== "BUY") continue;
      const strat = d.strategies.find(s => s.active && s.type !== "bearish");
      if (!strat) continue;

      const probability = Math.min(95, Math.round(
        d.score * 0.7 + INTERVAL_BONUS[iv] + CONF_BONUS[strat.confidence] + (confluence - 1) * 5,
      ));

      if (!best || probability > best.probability) {
        // Skip if tp/sl are missing or zero (broken strategy data)
        if (!(strat.tp > 0) || !(strat.sl > 0)) continue;
        best = { coin, interval: iv, probability, strategy: strat, recommended: true,
          price: d.price, tp: strat.tp, sl: strat.sl, trailing: strat.trailing ?? null,
          fetchedAt: d.fetchedAt ?? 0 };
      }
    }

    // Pass 2: fallback — best available interval regardless of verdict
    if (!best) {
      for (const iv of INTERVALS) {
        const d = cache[`${coin.pair}:${iv}`];
        if (!d || d === "loading" || d === "error") continue;
        const strat = d.strategies.find(s => s.active && s.type !== "bearish") ?? null;
        const probability = Math.min(45, Math.round(d.score * 0.7 + INTERVAL_BONUS[iv]));

        if (!best || probability > best.probability) {
          best = { coin, interval: iv, probability, strategy: strat, recommended: false,
            price: d.price, tp: strat ? strat.tp : 0, sl: strat ? strat.sl : 0,
            trailing: strat?.trailing ?? null, fetchedAt: d.fetchedAt ?? 0 };
        }
      }
    }

    if (best) opps.push(best);
  }

  return opps.sort((a, b) => b.probability - a.probability).slice(0, 5);
}

function computeBearishOpportunities(
  coins: CoinRow[],
  cache: Record<string, CellState>,
): Opportunity[] {
  const opps: Opportunity[] = [];

  for (const coin of coins) {
    let best: Opportunity | null = null;

    for (const iv of INTERVALS) {
      const d = cache[`${coin.pair}:${iv}`];
      if (!d || d === "loading" || d === "error") continue;
      const strat = d.strategies.find(s => s.active && s.type === "bearish");
      if (!strat || !(strat.tp > 0) || !(strat.sl > 0)) continue;

      // For bearish: higher = more pronounced downtrend (inverted score)
      const probability = Math.min(95, Math.round(
        (100 - d.score) * 0.7 + INTERVAL_BONUS[iv] + CONF_BONUS[strat.confidence],
      ));

      if (!best || probability > best.probability) {
        best = { coin, interval: iv, probability, strategy: strat, recommended: true,
          price: d.price, tp: strat.tp, sl: strat.sl, trailing: strat.trailing ?? null,
          fetchedAt: d.fetchedAt ?? 0 };
      }
    }

    if (best) opps.push(best);
  }

  return opps.sort((a, b) => b.probability - a.probability).slice(0, 5);
}

/* ── Mini price curve ── */
function MiniChart({ pair, interval, tpPrice, slPrice }: {
  pair: string; interval: string; tpPrice: number; slPrice: number;
}) {
  const [data, setData] = useState<{ time: number; close: number }[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/klines?pair=${pair}&interval=${interval}&limit=48`)
      .then(r => r.json())
      .then(d => { if (!cancelled && Array.isArray(d)) setData(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [pair, interval]);

  if (!data.length) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-3)", fontSize: "0.75rem" }}>
        <i className="fa-solid fa-spinner fa-spin" />
      </div>
    );
  }

  const prices = data.map(d => d.close);
  const minP   = Math.min(...prices, slPrice > 0 ? slPrice : Infinity);
  const maxP   = Math.max(...prices, tpPrice > 0 ? tpPrice : -Infinity);
  const range  = maxP - minP || minP * 0.01;
  const pad    = range * 0.12;
  const last   = data[data.length - 1].close;
  const first  = data[0].close;
  const color  = last >= first ? "#059669" : "#dc2626";
  const gradId = `mc-${pair}-${interval}`;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={color} stopOpacity={0.25} />
            <stop offset="95%" stopColor={color} stopOpacity={0}    />
          </linearGradient>
        </defs>
        <XAxis dataKey="time" type="number" domain={["dataMin", "dataMax"]}
          hide padding={{ left: 4, right: 4 }} />
        <YAxis domain={[minP - pad, maxP + pad]} hide />
        {tpPrice > 0 && (
          <ReferenceLine y={tpPrice} stroke="#059669" strokeDasharray="4 2" strokeWidth={1} />
        )}
        {slPrice > 0 && (
          <ReferenceLine y={slPrice} stroke="#dc2626" strokeDasharray="4 2" strokeWidth={1} />
        )}
        <Area type="monotone" dataKey="close"
          stroke={color} strokeWidth={1.5}
          fill={`url(#${gradId})`} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* ── Single opportunity card ── */
function OpportunityCard({ o, onOpenOrder, isBearish = false }: {
  o: Opportunity;
  isBearish?: boolean;
  onOpenOrder: (pair: string, side: "BUY" | "SELL", tp: string, sl: string, slLimit: string, interval?: Interval) => void;
}) {
  const [confirm, setConfirm] = useState<{ usdt: string } | null>(null);
  const [buying,  setBuying]  = useState(false);
  const [msg,     setMsg]     = useState<{ ok: boolean; text: string } | null>(null);

  const prec  = o.price >= 100 ? 2 : o.price >= 1 ? 4 : 6;
  const tpPct = isBearish
    ? (o.tp > 0 && o.price > 0 ? ((o.price - o.tp) / o.price) * 100 : null)
    : (o.tp > 0 && o.price > 0 ? ((o.tp - o.price) / o.price) * 100 : null);
  const slPct = isBearish
    ? (o.sl > 0 && o.price > 0 ? ((o.sl - o.price) / o.price) * 100 : null)
    : (o.sl > 0 && o.price > 0 ? ((o.price - o.sl) / o.price) * 100 : null);
  const probColor = o.probability >= 70 ? "#059669" : o.probability >= 50 ? "#d97706" : "#dc2626";
  const dataAgeSecs = o.fetchedAt ? Math.round((Date.now() - o.fetchedAt) / 1000) : 999;
  const isStale   = dataAgeSecs > 90;

  const handleBuy = async () => {
    if (!confirm || parseFloat(confirm.usdt) <= 0) return;
    setBuying(true);
    try {
      const info = await execBuyAndExit(o, confirm.usdt);
      setMsg({ ok: true, text: `Executat · ${info}` });
      setConfirm(null);
    } catch (e: unknown) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBuying(false);
    }
  };

  const coinColor = COIN_COLORS[o.coin.symbol] ?? "#6366f1";

  if (o.tp <= 0 && !o.recommended) return null;

  return (
    <div className="order-card opp-card">

      {/* Colored header */}
      <div
        className="opp-card__color-header"
        style={{
          background: `${coinColor}18`,
          borderBottom: `1px solid ${coinColor}30`,
        }}
      >
        <CoinIcon symbol={o.coin.symbol} size={36} />
        <div className="opp-card__header-left">
          <div className="opp-card__coin-name">
            <span className="opp-card__coin-sym">{o.coin.symbol}</span>
            <span className="opp-card__coin-quote">/USDT</span>
          </div>
          <div className="opp-card__header-pills">
            <span className={`pill ${isBearish ? "pill--sell" : "pill--buy"}`}>{isBearish ? "SELL" : "BUY"}</span>
            <span className="opp-card__iv-badge">{o.interval}</span>
            {o.recommended
              ? <span className="opp-card__recom-badge">Recom.</span>
              : <span className="opp-card__wait-badge">WAIT</span>}
          </div>
        </div>
      </div>

      {/* Staleness warning */}
      {isStale && (
        <div className="opp-card__stale">
          <i className="fa-solid fa-clock" />
          {" "}Dades de fa {dataAgeSecs < 120 ? `${dataAgeSecs}s` : `${Math.floor(dataAgeSecs / 60)}min`} — preu pot haver canviat
        </div>
      )}

      {/* Probability banner */}
      <div className="order-card__amount">
        <span className="order-card__amount-value" style={{ color: probColor }}>
          {o.probability}%
        </span>
        <span className="order-card__amount-label">
          {o.strategy?.name ?? "probabilitat"}
        </span>
      </div>

      {/* Mini curve chart */}
      <div className="order-card__chart opp-card__chart">
        <MiniChart pair={o.coin.pair} interval={o.interval}
          tpPrice={o.tp} slPrice={o.sl} />
      </div>

      {/* Compact SL | Price | TP row */}
      <div className="opp-card__levels">
        <div className="opp-card__level opp-card__level--sl">
          <span className="opp-card__level-lbl">SL</span>
          {slPct !== null
            ? <span className="opp-card__level-pct opp-card__level-pct--sl">-{slPct.toFixed(1)}%</span>
            : <span className="opp-card__level-val mono">{formatCurrency(o.sl)}</span>}
          <span className="opp-card__level-ref mono">{formatCurrency(o.sl)}</span>
        </div>
        <div className="opp-card__level opp-card__level--price">
          <span className="opp-card__level-lbl">Preu</span>
          <span className="opp-card__level-val mono">{formatCurrency(o.price)}</span>
          {o.strategy?.keySignal && <span className="opp-card__level-ref">{o.strategy.keySignal}</span>}
        </div>
        <div className="opp-card__level opp-card__level--tp">
          <span className="opp-card__level-lbl">TP</span>
          {tpPct !== null
            ? <span className="opp-card__level-pct opp-card__level-pct--tp">{isBearish ? "-" : "+"}{tpPct.toFixed(1)}%</span>
            : <span className="opp-card__level-val mono">{formatCurrency(o.tp)}</span>}
          <span className="opp-card__level-ref mono">{formatCurrency(o.tp)}</span>
        </div>
      </div>

      {/* Message */}
      {msg && (
        <div className={`sm-top__msg${msg.ok ? " sm-top__msg--ok" : " sm-top__msg--err"}`}
          style={{ margin: "0 14px 10px" }}>
          {msg.ok
            ? <i className="fa-solid fa-check" />
            : <i className="fa-solid fa-triangle-exclamation" />}
          {" "}{msg.text}
          <button className="sm-top__msg-close" onClick={() => setMsg(null)}>×</button>
        </div>
      )}

      {/* Actions */}
      {!msg && (
        <div className="order-card__actions">
          {confirm ? (
            <>
              <input
                className="sm-top__confirm-input"
                type="number" min="1"
                value={confirm.usdt}
                onChange={e => setConfirm({ usdt: e.target.value })}
                onKeyDown={e => e.key === "Enter" && handleBuy()}
                style={{ width: 70 }}
              />
              <span style={{ fontSize: "0.75rem", color: "var(--text-2)" }}>USDT</span>
              <button className="sm-top__confirm-ok" onClick={handleBuy} disabled={buying}>
                {buying ? <i className="fa-solid fa-spinner fa-spin" /> : "Confirmar"}
              </button>
              <button className="sm-top__confirm-cancel" onClick={() => setConfirm(null)} disabled={buying}>
                Cancel·lar
              </button>
            </>
          ) : (
            <>
              <button className="order-btn order-btn--edit"
                onClick={() => onOpenOrder(
                  o.coin.pair, "SELL",
                  o.tp.toFixed(prec), o.sl.toFixed(prec), (o.sl * 0.999).toFixed(prec),
                  o.interval,
                )}>
                <i className="fa-solid fa-cart-shopping" /><span> Ordre manual</span>
              </button>
              <button className="order-btn order-btn--buy"
                onClick={() => setConfirm({ usdt: "50" })}
                disabled={isStale || !o.recommended}
                title={!o.recommended ? "No recomanat per compra directa" : isStale ? `Dades de fa ${dataAgeSecs}s — clica el botó actualitzar primer` : undefined}>
                <i className="fa-solid fa-bolt" /><span> Compra directa</span>
              </button>
            </>
          )}
        </div>
      )}

    </div>
  );
}

const MANUAL_BUY_THRESHOLD = 65; // offer ⚡ button

async function execBuyAndExit(o: Opportunity, usdt: string): Promise<string> {
  if (!(o.tp > 0) || !(o.sl > 0)) {
    // Invalidate stale analysis cache for this pair so next load gets fresh data
    void fetch(`/api/cache/invalidate?prefix=analysis:${o.coin.pair}`, { method: "DELETE" });
    throw new Error(`Preus TP/SL invàlids per ${o.coin.pair}: TP=${o.tp} SL=${o.sl} — recarregant dades…`);
  }
  // Always activate trailing stop — use opportunity trailing, fallback to strategy trailing
  const trailing = o.trailing ?? o.strategy?.trailing ?? null;
  const body: Record<string, unknown> = { symbol: o.coin.pair, quoteOrderQty: usdt, tpPrice: o.tp, slPrice: o.sl, trailing };
  const res = await fetch("/api/orders/buy-and-exit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = await res.json();
  if (d.error) throw new Error(d.error);
  return `fill ${d.fillPrice?.toFixed(4)} · OCO #${d.ocoOrderListId}`;
}

function TopOpportunities({
  coins, cache, onOpenOrder, loading, onScan,
}: {
  coins: CoinRow[];
  cache: Record<string, CellState>;
  onOpenOrder: (pair: string, side: "BUY" | "SELL", tp: string, sl: string, slLimit: string, interval?: Interval) => void;
  loading: boolean;
  onScan: () => void;
}) {
  const bullOpps = computeOpportunities(coins, cache);
  const bearOpps = computeBearishOpportunities(coins, cache);
  const hasData  = Object.keys(cache).length > 0;

  return (
    <div className="sm-top">
      <div className="portfolio__section-title sm-top__title">
        <i className="fa-solid fa-star" /> Top oportunitats
        {!loading && !hasData && (
          <button className="sm-scan-btn" onClick={onScan}>
            <i className="fa-solid fa-magnifying-glass-chart" /> Analitzar ara
          </button>
        )}
        {loading && <span className="sm-top__scanning"><i className="fa-solid fa-spinner fa-spin" /> Analitzant…</span>}
      </div>

      {!hasData && !loading ? (
        <div className="sm-top__empty sm-top__empty--prompt">
          <i className="fa-solid fa-circle-info" /> Fes clic a <strong>Analitzar ara</strong> per iniciar l'escàner.
        </div>
      ) : loading ? (
        <div className="sm-top__loading">
          <i className="fa-solid fa-spinner fa-spin" />
          <span>Calculant estratègies per a tots els parells…</span>
          <span className="sm-top__loading-count">{Object.keys(cache).length} / {coins.length * INTERVALS.length} analitzats</span>
        </div>
      ) : (
        <div className="sm-top__rows">
          {/* Bullish row */}
          <div className="sm-top__row-section">
            <div className="sm-top__row-label sm-top__row-label--bull">
              <i className="fa-solid fa-arrow-trend-up" /> Alcistes
            </div>
            <div className="opp-cards opp-cards--fixed">
              {bullOpps.map((o, i) => (
                <OpportunityCard key={i} o={o} onOpenOrder={onOpenOrder} />
              ))}
              {bullOpps.length === 0 && (
                <div className="sm-top__empty">Sense senyals alcistes actius</div>
              )}
            </div>
          </div>

          {/* Bearish row */}
          <div className="sm-top__row-section">
            <div className="sm-top__row-label sm-top__row-label--bear">
              <i className="fa-solid fa-arrow-trend-down" /> Baixistes
            </div>
            <div className="opp-cards opp-cards--fixed">
              {bearOpps.map((o, i) => (
                <OpportunityCard key={i} o={o} onOpenOrder={onOpenOrder} isBearish />
              ))}
              {bearOpps.length === 0 && (
                <div className="sm-top__empty">Sense senyals baixistes actius</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StratDot({ s, idx }: { s: StratRow; idx: number }) {
  const bg = s.active
    ? `${TYPE_COLOR[s.type]}${Math.round(CONF_OPACITY[s.confidence] * 255).toString(16).padStart(2, "0")}`
    : "var(--border)";
  const title = `${STRAT_META[idx]?.label ?? ""}: ${s.active ? s.confidence : "inactiva"}`;
  return (
    <span
      className={`sm-dot${s.active ? " sm-dot--active" : ""}`}
      style={{ background: bg }}
      title={title}
    />
  );
}

type CoinGroup = {
  coin: CoinRow;
  bestInterval: Interval | null;
  bestVerdict: "BUY" | "WAIT" | "AVOID";
  bestScore: number;
};

function groupCoins(
  coins: CoinRow[],
  cache: Record<string, CellState>,
): { buy: CoinGroup[]; wait: CoinGroup[]; avoid: CoinGroup[] } {
  const buy: CoinGroup[] = [], wait: CoinGroup[] = [], avoid: CoinGroup[] = [];

  for (const coin of coins) {
    let bestVerdict: "BUY" | "WAIT" | "AVOID" = "WAIT";
    let bestScore = 0;
    let bestInterval: Interval | null = null;
    let hasData = false;

    for (const iv of INTERVALS) {
      const d = cache[`${coin.pair}:${iv}`];
      if (!d || d === "loading" || d === "error") continue;
      hasData = true;
      if (d.verdict === "BUY" && (bestVerdict !== "BUY" || d.score > bestScore)) {
        bestVerdict = "BUY"; bestScore = d.score; bestInterval = iv;
      } else if (d.verdict === "AVOID" && bestVerdict === "WAIT") {
        bestVerdict = "AVOID"; bestScore = d.score; bestInterval = iv;
      } else if (d.verdict === "WAIT" && bestVerdict === "WAIT" && d.score > bestScore) {
        bestScore = d.score; bestInterval = iv;
      }
    }

    if (!hasData) continue;
    const entry = { coin, bestInterval, bestVerdict, bestScore };
    if (bestVerdict === "BUY")   buy.push(entry);
    else if (bestVerdict === "AVOID") avoid.push(entry);
    else wait.push(entry);
  }

  buy.sort((a,  b) => b.bestScore - a.bestScore);
  wait.sort((a, b) => b.bestScore - a.bestScore);
  avoid.sort((a, b) => a.bestScore - b.bestScore);
  return { buy, wait, avoid };
}

function GroupedMatrixRow({ coin, group, cache, onHandleClick, onHover, onPin }: {
  coin: CoinRow;
  group: CoinGroup;
  cache: Record<string, CellState>;
  onHandleClick: (coin: CoinRow, iv: Interval) => void;
  onHover: (coin: CoinRow | null) => void;
  onPin: (coin: CoinRow) => void;
}) {
  const verdictCls = group.bestVerdict === "BUY" ? "sm-badge--buy" : group.bestVerdict === "AVOID" ? "sm-badge--avoid" : "sm-badge--wait";
  const verdictLabel = group.bestVerdict === "BUY" ? "BUY" : group.bestVerdict === "AVOID" ? "EVIT" : "WAIT";

  return (
    <div className="sm-grow"
      onMouseEnter={() => onHover(coin)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onPin(coin)}
      style={{ cursor: "pointer" }}>
      <div className="sm-grow__coin">
        <CoinIcon symbol={coin.symbol} size={22} />
        <span className="sm-grow__sym">{coin.symbol}</span>
      </div>
      <div className="sm-grow__best">
        <span className={`sm-badge ${verdictCls}`}>{verdictLabel}</span>
        {group.bestScore > 0 && <span className="sm-grow__score">{group.bestScore}%</span>}
      </div>
      {INTERVALS.map(iv => {
        const d = cache[`${coin.pair}:${iv}`];
        if (!d || d === "loading" || d === "error") {
          return (
            <div key={iv} className="sm-grow__dots"
              onClick={e => { e.stopPropagation(); if (d !== undefined) onHandleClick(coin, iv); }}>
              {d === "loading" ? <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: "0.55rem", color: "var(--text-3)" }} /> : null}
            </div>
          );
        }
        return (
          <div key={iv} className="sm-grow__dots"
            onClick={e => { e.stopPropagation(); onHandleClick(coin, iv); }}
            title={`${iv}: ${d.verdict} · ${d.score}%`} role="button" tabIndex={0}>
            <span className="sm-grow__iv-score">{d.score}%</span>
            <div className="sm-grow__dot-row">
              {d.strategies.map((s, i) => <StratDot key={i} s={s} idx={i} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function StrategyMatrix({ coins, onOpenOrder }: {
  coins: CoinRow[];
  onOpenOrder: (pair: string, side: "BUY" | "SELL", tp: string, sl: string, slLimit: string, interval?: Interval) => void;
}) {
  const [cache,         setCache]         = useState<Record<string, CellState>>({});
  const [loading,       setLoading]       = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<number | null>(null);
  const [ageSecs,       setAgeSecs]       = useState<number>(0);
  const [hoveredCoin,   setHoveredCoin]   = useState<CoinRow | null>(null);
  const [pinnedCoin,    setPinnedCoin]    = useState<CoinRow | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadCell = useCallback(async (pair: string, interval: string, soft = false) => {
    const key = `${pair}:${interval}`;
    if (!soft) setCache(prev => ({ ...prev, [key]: "loading" }));
    try {
      const res = await fetch(`/api/analysis?symbol=${pair}&interval=${interval}`);
      const d   = await res.json();
      if (d.error) throw new Error(d.error);
      setCache(prev => ({
        ...prev,
        [key]: {
          score:      d.score,
          verdict:    d.verdict,
          price:      d.price,
          atr:        d.atr ?? 0,
          strategies: (d.strategies as Array<StratRow & { trailing?: TrailingSuggestion }>)
            .slice(0, 5)
            .map(s => ({ ...s, trailing: s.trailing ?? null })),
          fetchedAt:  Date.now(),
        },
      }));
    } catch {
      if (!soft) setCache(prev => ({ ...prev, [key]: "error" }));
    }
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setCache({});
    const tasks: Array<[string, string]> = [];
    for (const c of coins) {
      for (const iv of INTERVALS) tasks.push([c.pair, iv]);
    }
    let idx = 0;
    const next = async (): Promise<void> => {
      if (idx >= tasks.length) return;
      const [pair, iv] = tasks[idx++];
      await loadCell(pair, iv, false);
      return next();
    };
    await Promise.all([next(), next(), next(), next()]);
    setLoading(false);
    setLastRefreshed(Date.now());
  }, [coins, loadCell]);

  // Soft refresh: actualitza les dades sense esborrar la UI (no mostra "loading")
  const fetchAllSoft = useCallback(async () => {
    if (loading) return;
    const tasks: Array<[string, string]> = [];
    for (const c of coins) {
      for (const iv of INTERVALS) tasks.push([c.pair, iv]);
    }
    let idx = 0;
    const next = async (): Promise<void> => {
      if (idx >= tasks.length) return;
      const [pair, iv] = tasks[idx++];
      await loadCell(pair, iv, true);
      return next();
    };
    await Promise.all([next(), next(), next(), next()]);
    setLastRefreshed(Date.now());
  }, [coins, loadCell, loading]);

  // Auto-fetch on first mount
  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Comptador d'edat en temps real
  useEffect(() => {
    if (!lastRefreshed) return;
    setAgeSecs(Math.round((Date.now() - lastRefreshed) / 1000));
    const id = setInterval(() => {
      setAgeSecs(Math.round((Date.now() - lastRefreshed) / 1000));
    }, 5_000);
    return () => clearInterval(id);
  }, [lastRefreshed]);

  const handleHover = useCallback((coin: CoinRow | null) => {
    if (pinnedCoin) return; // no canviar si hi ha un fixat
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    if (coin) {
      setHoveredCoin(coin);
    } else {
      hoverTimer.current = setTimeout(() => setHoveredCoin(null), 180);
    }
  }, [pinnedCoin]);

  const handlePin = useCallback((coin: CoinRow) => {
    setPinnedCoin(prev => prev?.pair === coin.pair ? null : coin);
    setHoveredCoin(null);
  }, []);

  const handleClick = (coin: CoinRow, interval: Interval) => {
    const d = cache[`${coin.pair}:${interval}`];
    if (!d || d === "loading" || d === "error") return;
    const prec   = d.price >= 100 ? 2 : d.price >= 1 ? 4 : 6;
    const top    = d.strategies.find(s => s.active && s.type !== "bearish");
    const side   = "SELL";
    const tp     = top ? top.tp.toFixed(prec) : "";
    const sl     = top ? top.sl.toFixed(prec) : "";
    const slLim  = top ? top.slLimit.toFixed(prec) : "";
    onOpenOrder(coin.pair, side, tp, sl, slLim, interval);
  };

  const activeCount = Object.values(cache).filter(v => v && v !== "loading" && v !== "error").length;
  const total       = coins.length * INTERVALS.length;
  const buyCount    = Object.values(cache).filter(v => v && v !== "loading" && v !== "error" && (v as CellData).verdict === "BUY").length;
  const topOpp      = computeOpportunities(coins, cache)[0];
  const topProb     = topOpp?.probability ?? 0;

  return (
    <div className="strat-matrix">

      {/* Stat cards (full width, above both columns) */}
      <div className="portfolio__cards">
        <div className="portfolio__card portfolio__card--blue">
          <span className="portfolio__card-label">
            <i className="fa-solid fa-table-cells" /> Parells analitzats
          </span>
          <span className="portfolio__card-value">
            {activeCount}<span style={{ fontSize: "1rem", fontWeight: 600, color: "var(--text-3)" }}>/{total}</span>
          </span>
          <span className="portfolio__card-sub">{coins.length} actius · {INTERVALS.length} intervals</span>
        </div>

        <div className={`portfolio__card portfolio__card--${buyCount > 0 ? "green" : "neutral"}`}>
          <span className="portfolio__card-label">
            <i className={`fa-solid fa-arrow-trend-${buyCount > 0 ? "up" : "right"}`} /> Senyals BUY
          </span>
          <span className="portfolio__card-value">{buyCount}</span>
          <span className="portfolio__card-sub">de {activeCount} cel·les analitzades</span>
        </div>

        <div className="portfolio__card portfolio__card--neutral">
          <span className="portfolio__card-label">
            <i className="fa-solid fa-star" /> Millor oportunitat
          </span>
          <span className="portfolio__card-value"
            style={{ color: topProb >= 70 ? "var(--green)" : topProb >= 50 ? "#d97706" : "var(--text-1)" }}>
            {topProb > 0 ? `${topProb}%` : "—"}
          </span>
          <span className="portfolio__card-sub">
            {topOpp ? `${topOpp.coin.symbol} · ${topOpp.interval}` : "sense dades"}
          </span>
        </div>
      </div>

      {/* Popover: centrat, hover o fixat */}
      {(pinnedCoin ?? hoveredCoin) && (() => {
        const activeCoin = pinnedCoin ?? hoveredCoin!;
        const isPinned   = !!pinnedCoin;
        const bullOpp = computeOpportunities([activeCoin], cache)[0] ?? null;
        const bearOpp = computeBearishOpportunities([activeCoin], cache)[0] ?? null;
        if (!bullOpp && !bearOpp) return null;
        return (
          <>
            {isPinned && (
              <div className="sm-popover-backdrop" onClick={() => setPinnedCoin(null)} />
            )}
            <div className="sm-popover sm-popover--centered"
              onMouseEnter={() => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }}
              onMouseLeave={() => { if (!isPinned) setHoveredCoin(null); }}>
              {isPinned && (
                <button className="sm-popover__close" onClick={() => setPinnedCoin(null)}>
                  <i className="fa-solid fa-xmark" />
                </button>
              )}
              {bullOpp && <OpportunityCard o={bullOpp} onOpenOrder={onOpenOrder} />}
              {bearOpp && <OpportunityCard o={bearOpp} onOpenOrder={onOpenOrder} isBearish />}
            </div>
          </>
        );
      })()}

      {/* Taula (ocupa tot l'ample) */}
      <div className="strat-matrix__body">
        <div className="strat-matrix__left">

          {/* Legend */}
          <div className="strat-matrix__bar">
            <div className="strat-matrix__legend">
              {STRAT_META.map((m, i) => (
                <span key={i} className="sm-legend-item">
                  <span className="sm-legend-dot" style={{ background: m.color }} />
                  <span className="sm-legend-short">{m.short}</span>
                  <span className="sm-legend-label">{m.label}</span>
                </span>
              ))}
            </div>
          </div>

          {/* Colour key */}
          <div className="strat-matrix__key">
            <span className="sm-key-item"><span className="sm-key-dot" style={{ background: "#16a34a" }} />Alta confiança</span>
            <span className="sm-key-item"><span className="sm-key-dot" style={{ background: "#16a34a99" }} />Moderada</span>
            <span className="sm-key-item"><span className="sm-key-dot" style={{ background: "#16a34a4d" }} />Baixa</span>
            <span className="sm-key-item"><span className="sm-key-dot" style={{ background: "var(--border)" }} />Inactiva</span>
            <span className="sm-key-sep" />
            <span className="sm-key-item sm-key-item--buy">■ BUY</span>
            <span className="sm-key-item sm-key-item--wait">■ WAIT</span>
            <span className="sm-key-item sm-key-item--avoid">■ EVIT</span>
          </div>

          {/* Grouped matrix */}
          <div className="portfolio__section-title strat-matrix__section-title">
            <i className="fa-solid fa-table-list" /> Matriu d'estratègies
            <span className="strat-matrix__bar-right">
              {loading
                ? <span className="sm-progress">{activeCount}/{total}</span>
                : lastRefreshed && (
                    <span className={`sm-age${ageSecs > 90 ? " sm-age--stale" : ""}`}
                      title={`Actualitzat ${new Date(lastRefreshed).toLocaleTimeString("ca-ES")}`}>
                      {ageSecs < 60 ? `fa ${ageSecs}s` : `fa ${Math.floor(ageSecs / 60)}min`}
                    </span>
                  )
              }
              <button className="sm-refresh" onClick={fetchAll} disabled={loading} title="Recarregar ara">
                <i className={`fa-solid fa-arrows-rotate${loading ? " fa-spin" : ""}`} />
              </button>
            </span>
          </div>
          {(() => {
            const { buy, wait, avoid } = groupCoins(coins, cache);
            const groups = [
              { key: "buy",   list: buy,   label: "BUY potential",  icon: "fa-fire",                cls: "sm-group--buy"   },
              { key: "wait",  list: wait,  label: "WAIT potential", icon: "fa-clock",               cls: "sm-group--wait"  },
              { key: "avoid", list: avoid, label: "EVIT potential", icon: "fa-triangle-exclamation", cls: "sm-group--avoid" },
            ] as const;
            return (
              <div className="sm-grouped">
                {groups.map(g => g.list.length === 0 ? null : (
                  <div key={g.key} className={`sm-group ${g.cls}`}>
                    <div className="sm-group__header">
                      <span className="sm-group__title"><i className={`fa-solid ${g.icon}`} /> {g.label}</span>
                      <span className="sm-group__col sm-group__col--iv">5m</span>
                      <span className="sm-group__col sm-group__col--iv">1h</span>
                      <span className="sm-group__col sm-group__col--iv">4h</span>
                    </div>
                    {g.list.map(entry => (
                      <GroupedMatrixRow
                        key={entry.coin.pair}
                        coin={entry.coin}
                        group={entry}
                        cache={cache}
                        onHandleClick={handleClick}
                        onHover={handleHover}
                        onPin={handlePin}
                      />
                    ))}
                  </div>
                ))}
              </div>
            );
          })()}
        </div>

        {/* ── Right panel: strategy guide ── */}
        <div className="strat-matrix__right">
          <StrategyGuide />
        </div>

      </div>
    </div>
  );
}

/* ── Strategy Guide ──────────────────────────────────────────────────────── */

const STRATEGY_GUIDE = [
  {
    short: "TF↑",
    label: "Trend Following Alcista",
    color: "#16a34a",
    icon: "fa-arrow-trend-up",
    tagline: "Segueix la tendència alcista en marcha",
    description: "Opera a favor del moviment principal del mercat quan el preu ja es troba en una tendència alcista consolidada. L'objectiu és capturar la part central del moviment, no el mínim ni el màxim.",
    conditions: [
      { label: "Preu > EMA200", desc: "El preu es troba per sobre la mitjana de 200 períodes, confirmant tendència alcista" },
      { label: "ADX > 25",      desc: "La força de la tendència és suficient per operar (no lateral)" },
      { label: "RSI 45–65",     desc: "Momentum positiu sense sobrecompra extrema" },
      { label: "MACD alcista",  desc: "Línia MACD per sobre de la seva senyal" },
    ],
    when: "Mercats en tendència clara. Evitar en laterals (ADX < 20).",
    risk: "Moderat — SL per sota del suport de swing anterior",
  },
  {
    short: "TF↓",
    label: "Trend Following Bajista",
    color: "#ef4444",
    icon: "fa-arrow-trend-down",
    tagline: "Segueix la tendència baixista en marcha",
    description: "La versió inversa del TF↑. Opera a la baixa quan el mercat es troba en tendència bajista. Útil per gestionar posicions curtes o ajustar stops.",
    conditions: [
      { label: "Preu < EMA200", desc: "El preu per sota la mitjana confirma la pressió venedora dominant" },
      { label: "ADX > 25",      desc: "Tendència definida, no escursat aleatori" },
      { label: "RSI 35–55",     desc: "Momentum negatiu sense sobrevenda extrema" },
      { label: "MACD bajista",  desc: "Línia MACD per sota de la seva senyal" },
    ],
    when: "Mercats en correcció o bear. Útil per tancar posicions llargues.",
    risk: "Moderat — SL per sobre del màxim de swing recent",
  },
  {
    short: "Rev↑",
    label: "Reversió Alcista",
    color: "#22c55e",
    icon: "fa-rotate-left",
    tagline: "Captura el gir de baixa a alça",
    description: "Busca punts de gir on el mercat ha caigut excessivament i es prepara per recuperar-se. Ofereix entrades amb molt bon ratio risc:benefici però requereix confirmació.",
    conditions: [
      { label: "RSI < 35",       desc: "Sobrevenda: el mercat ha caigut massa ràpid" },
      { label: "Estocàstic baix", desc: "Confirma sobrevenda en timeframe curt" },
      { label: "Prop suport",    desc: "El preu es troba a prop d'un suport horitzontal o EMA clau" },
      { label: "Espelma verda",  desc: "Patró de reversió (engoliment, martell, doji en suport)" },
    ],
    when: "Correccions de mercat alcista. No operar si la tendència principal és bajista.",
    risk: "Baix (si confirmat) — SL per sota del mínim recent",
  },
  {
    short: "Rev↓",
    label: "Reversió Bajista",
    color: "#f97316",
    icon: "fa-rotate-right",
    tagline: "Captura el gir d'alça a baixa",
    description: "Detecta quan el preu ha pujat excessivament i es prepara per corregir. Indica que convé reduir exposició o tancar parcials.",
    conditions: [
      { label: "RSI > 70",        desc: "Sobrecompra: el mercat ha pujat massa ràpid" },
      { label: "Estocàstic alt",  desc: "Confirma sobrecompra en timeframe curt" },
      { label: "Prop resistència",desc: "El preu es troba a prop d'un màxim anterior o resistència clau" },
      { label: "Espelma vermella",desc: "Patró de topall (estrella caient, engoliment bajista)" },
    ],
    when: "Finals de rally en mercat lateral. Bona senyal per tancar posicions llargues.",
    risk: "Mig — requereix paciència i confirmació del gir",
  },
  {
    short: "BRK",
    label: "Breakout Alcista",
    color: "#a78bfa",
    icon: "fa-bolt",
    tagline: "Ruptura de resistència amb volum",
    description: "El preu trenca un nivell de resistència important amb un augment significatiu de volum. Els breakouts amb volum solen generar moviments ràpids i contundents.",
    conditions: [
      { label: "Preu > resistència", desc: "Tancament per sobre del màxim de consolidació anterior" },
      { label: "Volum > 1.5×",       desc: "El volum és almenys 1.5 vegades la mitjana: confirma la ruptura" },
      { label: "ADX creixent",       desc: "La força de la tendència augmenta just en el moment de la ruptura" },
      { label: "RSI > 55",           desc: "Momentum positiu acompanya la ruptura" },
    ],
    when: "Ideal després de llargues consolidacions (ADX < 20 previ). Màxim impacte quan coincideix en 1h i 4h.",
    risk: "Alt si no hi ha volum — molts breakouts fassen (fals breakout). Sempre confirmar amb volum.",
  },
];

const CONFIDENCE_GUIDE = [
  { level: "Alta",    color: "#16a34a",   dot: "#16a34a",   desc: "Totes les condicions de l'estratègia es compleixen simultàniament. Màxima probabilitat d'èxit." },
  { level: "Moderada",color: "#d97706",   dot: "#16a34a99", desc: "La majoria de condicions es compleixen, però alguna és marginal. Opera amb mida de posició reduïda." },
  { level: "Baixa",   color: "#94a3b8",   dot: "#16a34a4d", desc: "Condicions mínimes. Pot ser un setup en formació. Ideal per vigilar, no entrar encara." },
  { level: "Inactiva",color: "var(--text-3)", dot: "var(--border)", desc: "L'estratègia no es detecta en aquest timeframe. No hi ha senyal." },
];

const VERDICT_GUIDE = [
  { verdict: "BUY",  color: "#16a34a", icon: "fa-fire", desc: "Almenys un timeframe mostra oportunitat clara. Revisa la card de detall per al setup exacte." },
  { verdict: "WAIT", color: "#d97706", icon: "fa-clock", desc: "Condicions parcials. El setup s'està formant. Prepara l'ordre però espera confirmació." },
  { verdict: "EVIT", color: "#ef4444", icon: "fa-triangle-exclamation", desc: "Condicions desfavorables o mercat lateral sense tendència. Risc de pèrdua elevat." },
];

function StrategyGuide() {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="sm-guide">
      <div className="sm-guide__header">
        <i className="fa-solid fa-book-open" /> Guia d'estratègies
      </div>

      <div className="sm-guide__section-title">Estratègies</div>
      {STRATEGY_GUIDE.map(s => {
        const isOpen = expanded === s.short;
        return (
          <div key={s.short}
            className={`sm-guide-card${isOpen ? " sm-guide-card--open" : ""}`}
            style={{ borderLeftColor: s.color }}>
            <button className="sm-guide-card__head" onClick={() => setExpanded(isOpen ? null : s.short)}>
              <span className="sm-guide-card__badge" style={{ background: s.color }}>
                {s.short}
              </span>
              <span className="sm-guide-card__name">{s.label}</span>
              <i className={`fa-solid fa-chevron-${isOpen ? "up" : "down"} sm-guide-card__chevron`} />
            </button>
            {isOpen && (
              <div className="sm-guide-card__body">
                <p className="sm-guide-card__tagline">
                  <i className={`fa-solid ${s.icon}`} /> {s.tagline}
                </p>
                <p className="sm-guide-card__desc">{s.description}</p>
                <div className="sm-guide-card__conds-title">Condicions</div>
                <ul className="sm-guide-card__conds">
                  {s.conditions.map((c, i) => (
                    <li key={i}>
                      <span className="sm-guide-card__cond-label">{c.label}</span>
                      <span className="sm-guide-card__cond-desc">{c.desc}</span>
                    </li>
                  ))}
                </ul>
                <div className="sm-guide-card__meta">
                  <span><strong>Quan operar:</strong> {s.when}</span>
                  <span><strong>Gestió de risc:</strong> {s.risk}</span>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <div className="sm-guide__section-title" style={{ marginTop: "1.25rem" }}>Nivells de confiança</div>
      {CONFIDENCE_GUIDE.map(c => (
        <div key={c.level} className="sm-guide-row">
          <span className="sm-key-dot" style={{ background: c.dot, flexShrink: 0 }} />
          <span className="sm-guide-row__level" style={{ color: c.color }}>{c.level}</span>
          <span className="sm-guide-row__desc">{c.desc}</span>
        </div>
      ))}

      <div className="sm-guide__section-title" style={{ marginTop: "1.25rem" }}>Veredictes</div>
      {VERDICT_GUIDE.map(v => (
        <div key={v.verdict} className="sm-guide-row">
          <i className={`fa-solid ${v.icon} sm-guide-row__icon`} style={{ color: v.color }} />
          <span className="sm-guide-row__level" style={{ color: v.color }}>{v.verdict}</span>
          <span className="sm-guide-row__desc">{v.desc}</span>
        </div>
      ))}

      <div className="sm-guide__tip">
        <i className="fa-solid fa-lightbulb" />
        <span>Passa el ratolí sobre una cripto de la matriu per veure el setup detallat. Clica per fixar la card.</span>
      </div>
    </div>
  );
}
