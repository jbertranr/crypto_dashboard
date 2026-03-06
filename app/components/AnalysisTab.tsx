"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { AnalysisResult, Signal, StrategyProposal, OHLCV } from "../lib/indicators";
import { formatCurrency } from "../lib/format";
import CoinIcon from "./CoinIcon";

const PAIRS = [
  { symbol: "BTC", pair: "BTCUSDT", color: "#F7931A" },
  { symbol: "ETH", pair: "ETHUSDT", color: "#627EEA" },
  { symbol: "BNB", pair: "BNBUSDT", color: "#F3BA2F" },
  { symbol: "SOL", pair: "SOLUSDT", color: "#00FFA3" },
  { symbol: "XRP", pair: "XRPUSDT", color: "#00AAE4" },
];

const INTERVALS = ["5m", "1h", "4h"] as const;
type Interval = (typeof INTERVALS)[number];

type LoadState = AnalysisResult | "loading" | "error";

function SignalBadge({ signal }: { signal: Signal }) {
  const map: Record<Signal, { label: string; cls: string }> = {
    bullish: { label: "Alcista", cls: "sig-badge--bull" },
    bearish: { label: "Bajista", cls: "sig-badge--bear" },
    neutral: { label: "Neutre",  cls: "sig-badge--neut" },
  };
  const { label, cls } = map[signal];
  return <span className={`sig-badge ${cls}`}>{label}</span>;
}

function ScoreBar({ score, verdict }: { score: number; verdict: "BUY" | "WAIT" | "AVOID" }) {
  const cls = verdict === "BUY" ? "score-bar--buy" : verdict === "AVOID" ? "score-bar--avoid" : "score-bar--wait";
  const vLabel = verdict === "BUY" ? "COMPRA" : verdict === "AVOID" ? "EVITA" : "ESPERA";
  const vCls   = verdict === "BUY" ? "verdict--buy" : verdict === "AVOID" ? "verdict--avoid" : "verdict--wait";
  return (
    <div className="score-bar-wrap">
      <div className="score-bar">
        <div className={`score-bar__fill ${cls}`} style={{ width: `${score}%` }} />
      </div>
      <div className="score-bar__label">
        <span className="score-bar__pct">{score}%</span>
        <span className={`verdict-badge ${vCls}`}>{vLabel}</span>
      </div>
    </div>
  );
}

function priceFmt(n: number): string {
  if (n >= 100)   return n.toFixed(2);
  if (n >= 1)     return n.toFixed(4);
  return n.toFixed(6);
}

export default function AnalysisTab({ onOpenOrder }: {
  onOpenOrder: (pair: string, side: "BUY" | "SELL", tp: string, sl: string, slLimit: string) => void;
}) {
  const [pair,     setPair]     = useState(PAIRS[0].pair);
  const [interval, setInterval] = useState<Interval>("1h");
  const [cache,    setCache]    = useState<Record<string, LoadState>>({});

  const load = useCallback(async (p: string, i: string) => {
    const key = `${p}:${i}`;
    setCache(prev => ({ ...prev, [key]: "loading" }));
    try {
      const res = await fetch(`/api/analysis?symbol=${p}&interval=${i}`);
      const d   = await res.json();
      if (d.error) throw new Error(d.error);
      setCache(prev => ({ ...prev, [key]: d as AnalysisResult }));
    } catch {
      setCache(prev => ({ ...prev, [key]: "error" }));
    }
  }, []);

  // Load all pairs for the current interval on mount/interval change
  useEffect(() => {
    PAIRS.forEach(p => load(p.pair, interval));
  }, [interval, load]);

  const current = cache[`${pair}:${interval}`];

  const handleOpenOrder = (r: AnalysisResult) => {
    const prec = r.price >= 100 ? 2 : r.price >= 1 ? 4 : 6;
    onOpenOrder(
      r.symbol,
      "SELL",
      r.suggestedTP.toFixed(prec),
      r.suggestedSL.toFixed(prec),
      r.suggestedSLLimit.toFixed(prec),
    );
  };

  return (
    <div className="analysis-tab">
      {/* Top bar: pairs + intervals */}
      <div className="analysis-topbar">
        <div className="analysis-pairs">
          {PAIRS.map(p => {
            const st = cache[`${p.pair}:${interval}`];
            const isResult = st && st !== "loading" && st !== "error";
            const v = isResult ? (st as AnalysisResult).verdict : null;
            const vCls = v === "BUY" ? "analysis-pair-btn--buy" : v === "AVOID" ? "analysis-pair-btn--avoid" : v === "WAIT" ? "analysis-pair-btn--wait" : "";
            return (
              <button
                key={p.pair}
                className={`analysis-pair-btn ${vCls}${pair === p.pair ? " analysis-pair-btn--active" : ""}`}
                onClick={() => setPair(p.pair)}
              >
                <CoinIcon symbol={p.symbol} size={14} />
                {p.symbol}
                {st === "loading" && <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: "0.6rem" }} />}
                {v && <span className={`analysis-pair-verdict ${vCls}`}>{v === "BUY" ? "▲" : v === "AVOID" ? "▼" : "—"}</span>}
              </button>
            );
          })}
        </div>
        <div className="analysis-intervals">
          {INTERVALS.map(i => (
            <button
              key={i}
              className={`analysis-interval-btn${interval === i ? " analysis-interval-btn--active" : ""}`}
              onClick={() => setInterval(i)}
            >
              {i}
            </button>
          ))}
          <button
            className="analysis-refresh-btn"
            onClick={async () => {
              await fetch("/api/cache/invalidate?prefix=analysis%3A", { method: "DELETE" });
              PAIRS.forEach(p => load(p.pair, interval));
            }}
            title="Refresca tots"
          >
            <i className="fa-solid fa-rotate-right" />
          </button>
        </div>
      </div>

      {/* Main panel */}
      <div className="analysis-panel">
        {!current || current === "loading" ? (
          <div className="state-empty">
            <i className="fa-solid fa-spinner fa-spin" /> Carregant anàlisi…
          </div>
        ) : current === "error" ? (
          <div className="state-error">
            Error carregant anàlisi.{" "}
            <button className="analysis-retry" onClick={() => load(pair, interval)}>Reintenta</button>
          </div>
        ) : (
          <AnalysisView result={current} onOpenOrder={handleOpenOrder} />
        )}
      </div>
    </div>
  );
}

function CandlestickChart({ candles, tp, sl, price, coinColor, trailingActivate }: {
  candles: OHLCV[];
  tp: number;
  sl: number;
  price: number;
  coinColor: string;
  trailingActivate?: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hovered, setHovered] = useState<{ c: OHLCV; sx: number; sy: number } | null>(null);

  if (!candles.length) return null;

  const W = 600, H = 300;
  const PAD = { top: 10, right: 58, bottom: 22, left: 6 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;

  const minRaw = Math.min(...candles.map(c => c.low),  sl);
  const maxRaw = Math.max(...candles.map(c => c.high), tp);
  const mg = (maxRaw - minRaw) * 0.04;
  const minP = minRaw - mg, maxP = maxRaw + mg;
  const range = maxP - minP || 1;

  const toY  = (p: number) => PAD.top + ((maxP - p) / range) * cH;
  const barW = cW / candles.length;
  const bodyW = Math.max(1.5, barW * 0.55);

  const pFmt = (p: number) => p >= 1000 ? p.toFixed(0) : p >= 1 ? p.toFixed(2) : p.toFixed(5);
  const vFmt = (v: number) => v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? (v / 1e3).toFixed(0) + "K" : v.toFixed(0);
  const tFmt = (ts: number) => new Date(ts).toLocaleString("ca-ES", {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  const ticks = [0, 1, 2, 3].map(i => minP + (range * i) / 3);
  const timeIdxs = [0, Math.floor(candles.length / 2), candles.length - 1];

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.max(0, Math.min(candles.length - 1, Math.floor((svgX - PAD.left) / barW)));
    setHovered({ c: candles[idx], sx: e.clientX - rect.left, sy: e.clientY - rect.top });
  };

  const hc = hovered?.c;
  const isHovUp = hc ? hc.close >= hc.open : false;

  return (
    <div style={{ position: "relative" }}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" height="275"
        className="strat-chart" style={{ display: "block", cursor: "crosshair" }}
        onMouseMove={handleMouseMove} onMouseLeave={() => setHovered(null)}>

        {/* Grid */}
        {ticks.map((t, i) => (
          <line key={i} x1={PAD.left} y1={toY(t)} x2={W - PAD.right} y2={toY(t)}
            stroke="#00000012" strokeWidth={1} />
        ))}

        {/* TP zone */}
        {tp > price && tp <= maxP && (
          <rect x={PAD.left} y={toY(tp)} width={cW} height={toY(price) - toY(tp)} fill="#16a34a0c" />
        )}
        {/* SL zone */}
        {sl < price && sl >= minP && (
          <rect x={PAD.left} y={toY(price)} width={cW} height={toY(sl) - toY(price)} fill="#dc26260c" />
        )}

        {/* Candles */}
        {candles.map((c, i) => {
          const cx = PAD.left + i * barW + barW / 2;
          const isUp = c.close >= c.open;
          const col = isUp ? "#16a34a" : "#dc2626";
          const bodyTop = toY(Math.max(c.open, c.close));
          const bodyBot = toY(Math.min(c.open, c.close));
          const bH = Math.max(1, bodyBot - bodyTop);
          const isH = hovered && candles[i] === hovered.c;
          return (
            <g key={i}>
              <line x1={cx} y1={toY(c.high)} x2={cx} y2={toY(c.low)}
                stroke={col} strokeWidth={0.8} opacity={isH ? 1 : 0.8} />
              <rect x={cx - bodyW / 2} y={bodyTop} width={bodyW} height={bH}
                fill={isUp ? col : col} opacity={isH ? 1 : 0.75}
                stroke={isH ? col : "none"} strokeWidth={isH ? 1 : 0} />
            </g>
          );
        })}

        {/* Hovered candle vertical guide */}
        {hovered && (() => {
          const idx = candles.indexOf(hovered.c);
          const cx = PAD.left + idx * barW + barW / 2;
          return <line x1={cx} y1={PAD.top} x2={cx} y2={H - PAD.bottom}
            stroke="#94a3b8" strokeWidth={0.8} strokeDasharray="3,2" />;
        })()}

        {/* Current price */}
        <line x1={PAD.left} y1={toY(price)} x2={W - PAD.right} y2={toY(price)}
          stroke="#94a3b8" strokeWidth={0.8} strokeDasharray="3,2" />
        <text x={W - PAD.right + 3} y={toY(price) + 3} fontSize={7.5} fill="#64748b" fontFamily="monospace">Ara</text>

        {/* TP line */}
        {tp >= minP && tp <= maxP && (
          <>
            <line x1={PAD.left} y1={toY(tp)} x2={W - PAD.right} y2={toY(tp)}
              stroke="#16a34a" strokeWidth={1.2} strokeDasharray="5,3" />
            <text x={W - PAD.right + 3} y={toY(tp) + 3} fontSize={8} fill="#16a34a" fontFamily="monospace">TP</text>
            <text x={W - PAD.right + 3} y={toY(tp) + 12} fontSize={7} fill="#16a34a" fontFamily="monospace">{pFmt(tp)}</text>
          </>
        )}

        {/* SL line */}
        {sl >= minP && sl <= maxP && (
          <>
            <line x1={PAD.left} y1={toY(sl)} x2={W - PAD.right} y2={toY(sl)}
              stroke="#dc2626" strokeWidth={1.2} strokeDasharray="5,3" />
            <text x={W - PAD.right + 3} y={toY(sl) + 3} fontSize={8} fill="#dc2626" fontFamily="monospace">SL</text>
            <text x={W - PAD.right + 3} y={toY(sl) + 12} fontSize={7} fill="#dc2626" fontFamily="monospace">{pFmt(sl)}</text>
          </>
        )}

        {/* Trailing activation line */}
        {trailingActivate !== undefined && trailingActivate >= minP && trailingActivate <= maxP && (
          <>
            <line x1={PAD.left} y1={toY(trailingActivate)} x2={W - PAD.right} y2={toY(trailingActivate)}
              stroke="#d97706" strokeWidth={1} strokeDasharray="3,4" />
            <text x={W - PAD.right + 3} y={toY(trailingActivate) + 3} fontSize={8} fill="#d97706" fontFamily="monospace">TS</text>
            <text x={W - PAD.right + 3} y={toY(trailingActivate) + 12} fontSize={7} fill="#d97706" fontFamily="monospace">{pFmt(trailingActivate)}</text>
          </>
        )}

        {/* Price axis */}
        {ticks.map((t, i) => (
          <text key={i} x={W - PAD.right + 3} y={toY(t) + 3} fontSize={7.5} fill="#94a3b8" fontFamily="monospace">
            {pFmt(t)}
          </text>
        ))}

        {/* Time axis */}
        {timeIdxs.map(idx => {
          const cx = PAD.left + idx * barW + barW / 2;
          const anchor = idx === 0 ? "start" : idx === candles.length - 1 ? "end" : "middle";
          return (
            <text key={idx} x={cx} y={H - 5} fontSize={7.5} fill="#94a3b8"
              textAnchor={anchor} fontFamily="sans-serif">{tFmt(candles[idx].time)}</text>
          );
        })}

        {/* Coin accent bar */}
        <rect x={PAD.left} y={PAD.top} width={cW} height={2} fill={coinColor} opacity={0.4} rx={1} />
      </svg>

      {/* Tooltip */}
      {hovered && hc && (
        <div className="strat-chart-tooltip" style={{
          left: hovered.sx > 160 ? hovered.sx - 138 : hovered.sx + 12,
          top:  Math.max(4, hovered.sy - 80),
        }}>
          <div className="strat-chart-tooltip__time">{tFmt(hc.time)}</div>
          <div className="strat-chart-tooltip__row">
            <span>O</span><span className="mono">{pFmt(hc.open)}</span>
          </div>
          <div className="strat-chart-tooltip__row">
            <span>H</span><span className="mono" style={{ color: "#16a34a" }}>{pFmt(hc.high)}</span>
          </div>
          <div className="strat-chart-tooltip__row">
            <span>L</span><span className="mono" style={{ color: "#dc2626" }}>{pFmt(hc.low)}</span>
          </div>
          <div className="strat-chart-tooltip__row">
            <span>C</span>
            <span className="mono" style={{ color: isHovUp ? "#16a34a" : "#dc2626", fontWeight: 700 }}>{pFmt(hc.close)}</span>
          </div>
          <div className="strat-chart-tooltip__row dim">
            <span>Vol</span><span className="mono">{vFmt(hc.volume)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function StrategyCard({ s, price, atr, coinColor, candles, onOpenOrder }: {
  s: StrategyProposal;
  price: number;
  atr: number;
  coinColor: string;
  candles: OHLCV[];
  onOpenOrder: (tp: string, sl: string, slLimit: string) => void;
}) {
  const [open, setOpen] = useState(s.active);

  const typeColor = s.type === "bullish" ? "#16a34a" : s.type === "bearish" ? "#dc2626" : "#64748b";
  const confCls   = s.confidence === "alta" ? "strat-conf--alta" : s.confidence === "moderada" ? "strat-conf--mod" : "strat-conf--baixa";
  const riskCls   = s.risk === "baix" ? "strat-risk--baix" : s.risk === "mig" ? "strat-risk--mig" : "strat-risk--alt";
  const typeLabel = s.type === "bullish" ? "▲ ALCISTA" : s.type === "bearish" ? "▼ BAJISTA" : "◆ NEUTRE";

  const prec = price >= 100 ? 2 : price >= 1 ? 4 : 6;
  const tpStr = s.tp.toFixed(prec);
  const slStr = s.sl.toFixed(prec);
  const slLimStr = s.slLimit.toFixed(prec);

  // Per bajista: el profit és que el preu baixi cap al TP, el risc és que pugi cap al SL
  const bearish    = s.type === "bearish";
  const profitPct  = Math.abs((s.tp - price) / price * 100);
  const riskPct    = Math.abs((s.sl - price) / price * 100);
  const rrRatio    = riskPct > 0 ? profitPct / riskPct : 0;
  const tpDir      = bearish ? "▼" : "▲";
  const slDir      = bearish ? "▲" : "▼";

  return (
    <div className={`strat-card strat-card--${s.type}${s.active ? "" : " strat-card--inactive"}`} style={{ borderColor: s.active ? `${coinColor}55` : undefined, borderLeftColor: s.active ? coinColor : undefined }}>
      <div className="strat-card__header" onClick={() => setOpen(o => !o)} role="button">
        <div className="strat-card__title-row">
          <span className="strat-card__name">{s.name}</span>
          <span className={`strat-conf ${confCls}`}>{s.confidence.toUpperCase()}</span>
          <span className="strat-card__type" style={{ color: typeColor }}>{typeLabel}</span>
        </div>
        <div className="strat-card__key">
          <i className="fa-solid fa-key" style={{ fontSize: "0.6rem", color: "var(--text-3)" }} />
          <span className="strat-card__key-text">{s.keySignal}</span>
        </div>
        <i className={`fa-solid fa-chevron-${open ? "up" : "down"} strat-card__toggle`} />
      </div>

      {open && (
        <div className="strat-card__body">
          {/* Motius per no recomanar (si inactiva) */}
          {!s.active && s.whyNot.length > 0 && (
            <ul className="strat-whynot">
              {s.whyNot.map((line, i) => (
                <li key={i} className="strat-whynot__item">
                  <i className="fa-solid fa-xmark strat-whynot__icon" />
                  {line}
                </li>
              ))}
            </ul>
          )}

          {/* Rationale (només si activa) */}
          {s.active && <>
            {/* Gràfic de veles */}
            <div className="strat-chart-wrap">
              <CandlestickChart candles={candles} tp={s.tp} sl={s.sl} price={price} coinColor={coinColor} trailingActivate={s.trailing.activateAt} />
            </div>

            <ul className="strat-rationale">
              {s.rationale.map((line, i) => (
                <li key={i} className="strat-rationale__item">
                  <span className="strat-rationale__dot" style={{ color: typeColor }}>✓</span>
                  {line}
                </li>
              ))}
            </ul>

            {/* Blockers */}
            {s.blockers.length > 0 && (
              <ul className="strat-blockers">
                {s.blockers.map((line, i) => (
                  <li key={i} className="strat-blockers__item">{line}</li>
                ))}
              </ul>
            )}

            {/* Trailing Stop */}
            <div className="strat-trailing">
              <div className="strat-trailing__header">
                <i className="fa-solid fa-flag-checkered" style={{ color: "#d97706", fontSize: "0.7rem" }} />
                <span className="strat-trailing__title">Trailing Stop</span>
              </div>
              <div className="strat-trailing__levels">
                <div className="strat-trailing__level">
                  <span className="strat-trailing__label">Activa a</span>
                  <span className="mono strat-trailing__price">{formatCurrency(s.trailing.activateAt)}</span>
                  <span className="strat-trailing__atr">{s.trailing.activateAtr}×ATR</span>
                </div>
                <div className="strat-trailing__level">
                  <span className="strat-trailing__label">Distància</span>
                  <span className="mono strat-trailing__price">{priceFmt(s.trailing.distance)}</span>
                  <span className="strat-trailing__atr">{s.trailing.distanceAtr}×ATR</span>
                </div>
              </div>
              <div className="strat-trailing__logic">{s.trailing.logic}</div>
            </div>

            {/* Metrics + action */}
            <div className="strat-card__footer">
            <div className="strat-card__levels">
              {bearish && (
                <span className="strat-short-badge" title="Estratègia de venda en curt — no disponible en spot trading">
                  <i className="fa-solid fa-triangle-exclamation" /> SHORT · futures/marges
                </span>
              )}
              <div className="strat-level">
                <span className="strat-level__label">TP {tpDir}</span>
                <span className="strat-level__price mono tp-color">{formatCurrency(s.tp)}</span>
                <span className="strat-level__pct up">+{profitPct.toFixed(2)}%</span>
              </div>
              <div className="strat-level">
                <span className="strat-level__label">SL {slDir}</span>
                <span className="strat-level__price mono sl-color">{formatCurrency(s.sl)}</span>
                <span className="strat-level__pct dn">−{riskPct.toFixed(2)}%</span>
              </div>
              <div className="strat-level">
                <span className="strat-level__label">ATR</span>
                <span className="strat-level__price mono">{priceFmt(atr)}</span>
              </div>
              <div className="strat-level">
                <span className="strat-level__label">R:R</span>
                <span className="strat-level__price mono">{rrRatio.toFixed(1)}×</span>
              </div>
              <span className={`strat-risk ${riskCls}`}>Risc {s.risk}</span>
            </div>
            {!bearish && (
              <button className="strat-oco-btn" onClick={() => onOpenOrder(tpStr, slStr, slLimStr)}>
                <i className="fa-solid fa-plus" /> Obre OCO
              </button>
            )}
          </div>
          </>}
        </div>
      )}
    </div>
  );
}

function AnalysisView({ result, onOpenOrder }: {
  result: AnalysisResult;
  onOpenOrder: (r: AnalysisResult) => void;
}) {
  const p = PAIRS.find(x => x.pair === result.symbol);
  const symbol    = p?.symbol ?? result.symbol.replace("USDT", "");
  const coinColor = p?.color ?? "#6366f1";
  const [showIndicators, setShowIndicators] = useState(false);

  const handleStratOCO = (r: AnalysisResult, tp: string, sl: string, slLimit: string) => {
    const prec = r.price >= 100 ? 2 : r.price >= 1 ? 4 : 6;
    const side = (parseFloat(tp) > r.price) ? "SELL" : "BUY";
    // Use passed TP/SL directly
    const event = new CustomEvent("__analysis_oco", { detail: { pair: r.symbol, side, tp, sl, slLimit } });
    window.dispatchEvent(event);
  };

  return (
    <div className="analysis-view">
      {/* Header */}
      <div className="analysis-header">
        <div className="analysis-header__identity">
          <CoinIcon symbol={symbol} size={22} />
          <span className="analysis-header__pair">
            {symbol}<span className="analysis-header__quote">/USDT</span>
          </span>
          <span className="analysis-header__interval">{result.interval}</span>
          <span className="analysis-header__price mono">{formatCurrency(result.price)}</span>
        </div>
        <ScoreBar score={result.score} verdict={result.verdict} />
      </div>

      {/* Strategy proposals */}
      <div className="strat-section">
        <div className="strat-section__title">
          <i className="fa-solid fa-brain" />
          Estratègies proposades
          <span className="strat-section__count">{result.strategies.length}</span>
        </div>
        {result.strategies.length === 0 ? (
          <div className="state-empty" style={{ padding: "1rem" }}>No hi ha estratègies clares en aquest moment.</div>
        ) : (
          <div className="strat-list">
            {result.strategies.map((s, i) => (
              <StrategyCard
                key={i} s={s} price={result.price} atr={result.atr} coinColor={coinColor} candles={result.candles}
                onOpenOrder={(tp, sl, slLimit) => {
                  const side = parseFloat(tp) > result.price ? "SELL" : "BUY";
                  onOpenOrder({ ...result, suggestedTP: parseFloat(tp), suggestedSL: parseFloat(sl), suggestedSLLimit: parseFloat(slLimit) });
                  void handleStratOCO(result, tp, sl, slLimit);
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Indicator groups — collapsible reference */}
      <div className="analysis-indicators-toggle">
        <button
          className="analysis-indicators-toggle__btn"
          onClick={() => setShowIndicators(v => !v)}
        >
          <i className={`fa-solid fa-chevron-${showIndicators ? "up" : "down"}`} />
          {showIndicators ? "Amaga" : "Mostra"} indicadors tècnics
        </button>
      </div>

      {showIndicators && (
        <div className="analysis-groups">
          {result.groups.map(g => {
            const gCls = g.score > 0.3 ? "analysis-group--bull" : g.score < -0.3 ? "analysis-group--bear" : "";
            return (
              <div key={g.name} className={`analysis-group ${gCls}`}>
                <div className="analysis-group__title">{g.name}</div>
                {g.indicators.map(ind => (
                  <div key={ind.name} className="analysis-indicator">
                    <span className="analysis-indicator__name">{ind.name}</span>
                    <span className="analysis-indicator__value mono">{ind.value}</span>
                    <SignalBadge signal={ind.signal} />
                    {ind.detail && <span className="analysis-indicator__detail dim">{ind.detail}</span>}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
