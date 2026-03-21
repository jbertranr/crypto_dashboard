"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { AnalysisResult, Signal, StrategyProposal, OHLCV, TradeDecision, calcDirectionScore, calcContextScore, calcTriggerScore, tradeDecisionFromScore } from "../lib/indicators";
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

function priceFmt(n: number): string {
  if (n >= 100)   return n.toFixed(2);
  if (n >= 1)     return n.toFixed(4);
  return n.toFixed(6);
}

/* ── Multi-Timeframe Dashboard ────────────────────────────────────── */
type TfState = AnalysisResult | "loading" | "error" | undefined;

type LayerStatus = "green" | "yellow" | "red" | "grey";

interface LayerMetric {
  label: string;
  value: string;
  desc:  string;
  sig:   "ok" | "warn" | "neutral";
}

interface LayerInfo {
  status:   LayerStatus;
  label:    string;
  metrics:  LayerMetric[];
  score:    number;   // 0–100 sub-score for this layer
}

function mtfLayer(
  tf:     string,
  r:      TfState,
  role:   "direction" | "context" | "trigger",
): LayerInfo {
  if (!r || r === "loading") return { status: "grey", label: "Carregant…",     metrics: [], score: 50 };
  if (r === "error")         return { status: "grey", label: "Error de dades", metrics: [], score: 50 };

  const { raw, price, score } = r;
  const fmt1 = (n: number) => isNaN(n) ? "—" : n.toFixed(1);
  const fmtP = (n: number) => isNaN(n) ? "—" : priceFmt(n);
  const pctOf200 = !isNaN(raw.ema200) ? ((price - raw.ema200) / raw.ema200 * 100) : NaN;

  if (role === "direction") {
    const aboveEma200 = !isNaN(raw.ema200) && price > raw.ema200;
    const metrics: LayerMetric[] = [
      {
        label: "EMA200",
        value: !isNaN(raw.ema200) ? fmtP(raw.ema200) : "—",
        desc:  "Mitjana mòbil 200 · referència de tendència global",
        sig:   aboveEma200 ? "ok" : "warn",
      },
      ...(!isNaN(pctOf200) ? [{
        label: "Preu vs EMA",
        value: `${pctOf200 >= 0 ? "+" : ""}${pctOf200.toFixed(1)}%`,
        desc:  "Distància del preu a l'EMA200 · positiu = tendència alcista",
        sig:   (pctOf200 >= 0 ? "ok" : "warn") as "ok" | "warn" | "neutral",
      }] : []),
      {
        label: "ADX",
        value: fmt1(raw.adx),
        desc:  "Força de la tendència · >25 = tendència definida, <15 = lateral",
        sig:   raw.adx > 25 ? "ok" : raw.adx < 15 ? "warn" : "neutral",
      },
      {
        label: "+DI / −DI",
        value: `${fmt1(raw.plusDI)} / ${fmt1(raw.minusDI)}`,
        desc:  "+DI > −DI = pressió compradora dominant",
        sig:   raw.plusDI > raw.minusDI ? "ok" : "warn",
      },
    ];

    const dirSc = calcDirectionScore(raw, price);
    if (aboveEma200 && score >= 55)
      return { status: "green",  label: "LONG perm\u00e8s",                 metrics, score: dirSc };
    if (aboveEma200)
      return { status: "yellow", label: "Preu > EMA200 \u00b7 tend. feble", metrics, score: dirSc };
    if (!isNaN(raw.ema200) && score <= 45)
      return { status: "red",    label: "Bear mercat \u00b7 no operar",      metrics, score: dirSc };
    return   { status: "yellow", label: "Preu < EMA200 \u00b7 caute\u00b7la",  metrics, score: dirSc };
  }

  if (role === "context") {
    const metrics: LayerMetric[] = [
      {
        label: "RSI",
        value: fmt1(raw.rsi),
        desc:  "Força relativa · 40–60 = zona neutral prop suport ideal",
        sig:   raw.rsi >= 40 && raw.rsi <= 60 ? "ok" : raw.rsi > 65 ? "warn" : "neutral",
      },
      {
        label: "Vol. relatiu",
        value: `${raw.volRatio.toFixed(1)}×`,
        desc:  "Volum vs. mitjana · >1.2 = mercat actiu, <0.65 = mercat lateral",
        sig:   raw.volRatio > 1.2 ? "ok" : raw.volRatio < 0.65 ? "warn" : "neutral",
      },
      {
        label: "Rang %",
        value: `${Math.round(raw.rangePct * 100)}%`,
        desc:  "Posició dins el rang 1h · <45% = prop suport, >80% = prop resistència",
        sig:   raw.rangePct < 0.45 ? "ok" : raw.rangePct > 0.80 ? "warn" : "neutral",
      },
      ...(raw.stochK < 60 ? [{
        label: "Estocàstic",
        value: fmt1(raw.stochK),
        desc:  "Oscil·lador de sobrecompra/sobrevenda · <40 = sobrevenda (bon moment)",
        sig:   (raw.stochK < 40 ? "ok" : "neutral") as "ok" | "warn" | "neutral",
      }] : []),
    ];

    const ctxSc = calcContextScore(raw);
    if (raw.volRatio < 0.65)
      return { status: "red",    label: "Mercat lateral \u00b7 no operar",      metrics, score: ctxSc };
    if (raw.rsi >= 40 && raw.rsi <= 60 && raw.rangePct < 0.45)
      return { status: "green",  label: "Prepara entrada \u00b7 prop suport",   metrics, score: ctxSc };
    if (raw.rangePct > 0.80)
      return { status: "yellow", label: "Resist\u00e8ncia propera \u00b7 precauci\u00f3", metrics, score: ctxSc };
    if (raw.rsi > 65)
      return { status: "yellow", label: "RSI alt \u00b7 espera retroc\u00e9s",       metrics, score: ctxSc };
    return   { status: "yellow", label: "Vigilancia activa",               metrics, score: ctxSc };
  }

  // trigger (5m)
  const upCandles = r.candles.slice(-5).filter((c: { close: number; open: number }) => c.close >= c.open).length;
  const dnCandles = 5 - upCandles;
  const metrics: LayerMetric[] = [
    {
      label: "RSI 5m",
      value: fmt1(raw.rsi),
      desc:  "Momentum a curt termini · >55 = pressió alcista, <35 = sobrevenut",
      sig:   raw.rsi > 55 ? "ok" : raw.rsi < 35 ? "warn" : "neutral",
    },
    {
      label: "MACD",
      value: raw.macdBull ? "Alcista ↑" : "Bajista ↓",
      desc:  "Creuament de mitjanes ràpides · confirma direcció del moviment",
      sig:   raw.macdBull ? "ok" : "warn",
    },
    {
      label: "Rang %",
      value: `${Math.round(raw.rangePct * 100)}%`,
      desc:  "Posició dins el rang 5m · >55% = momentum actiu al terci superior",
      sig:   raw.rangePct > 0.55 ? "ok" : "neutral",
    },
    {
      label: "Espelmes",
      value: `${upCandles}↑ ${dnCandles}↓`,
      desc:  "Darreres 5 espelmes alcistes vs. bajistes · momentum visual immediat",
      sig:   upCandles > dnCandles ? "ok" : upCandles < dnCandles ? "warn" : "neutral",
    },
  ];

  const trgSc = calcTriggerScore(raw, raw.volRatio);
  if (raw.rsi > 55 && raw.macdBull && raw.rangePct > 0.55)
    return { status: "green",  label: "Senyal alcista \u00b7 entrada OK",    metrics, score: trgSc };
  if (raw.rsi < 45 || (!raw.macdBull && raw.adx < 20))
    return { status: "red",    label: "Sense momentum \u00b7 evita entrada", metrics, score: trgSc };
  return   { status: "yellow", label: "Espera confirmaci\u00f3",             metrics, score: trgSc };
}

function MultiTimeframeDashboard({ cache, pair }: {
  cache: Record<string, TfState>;
  pair:  string;
}) {
  const r5m = cache[`${pair}:5m`];
  const r1h = cache[`${pair}:1h`];
  const r4h = cache[`${pair}:4h`];

  const dir  = mtfLayer("4h", r4h,  "direction");
  const ctx  = mtfLayer("1h", r1h,  "context");
  const trg  = mtfLayer("5m", r5m,  "trigger");

  // ── Weighted composite score (40 / 30 / 30) ──
  const allLoaded = r5m && r1h && r4h && r5m !== "loading" && r1h !== "loading" && r4h !== "loading"
    && r5m !== "error" && r1h !== "error" && r4h !== "error";

  const weightedScore = allLoaded
    ? Math.round(0.4 * dir.score + 0.3 * ctx.score + 0.3 * trg.score)
    : 0;
  const mtfDecision: TradeDecision | null = allLoaded ? tradeDecisionFromScore(weightedScore) : null;

  let globalStatus: LayerStatus = "grey";
  let globalLabel = "Carregant dades MTF…";
  let globalSub   = "";

  if (allLoaded) {
    if (mtfDecision === "ENTRY SIGNAL") {
      globalStatus = "green";  globalLabel = "ENTRY SIGNAL";    globalSub = `Score ponderat ${weightedScore} · les 3 capes confirmen`; }
    else if (mtfDecision === "PREPARE ENTRY") {
      globalStatus = "yellow"; globalLabel = "PREPARA ENTRADA"; globalSub = `Score ${weightedScore} · espera trigger final`; }
    else if (mtfDecision === "WATCH") {
      globalStatus = "yellow"; globalLabel = "VIGILA";          globalSub = `Score ${weightedScore} · condicions parcials`; }
    else {
      globalStatus = "red";    globalLabel = "IGNORA";          globalSub = `Score ${weightedScore} · condicions desfavorables`; }
  }

  const LAYERS: { key: string; tf: string; role: string; icon: string; weight: string; layer: LayerInfo }[] = [
    { key: "dir",  tf: "4h", role: "Direcció",  icon: "fa-compass",     weight: "40%", layer: dir },
    { key: "ctx",  tf: "1h", role: "Context",   icon: "fa-layer-group", weight: "30%", layer: ctx },
    { key: "trg",  tf: "5m", role: "Trigger",   icon: "fa-bolt",        weight: "30%", layer: trg },
  ];

  // Extra context from loaded results
  const r4hResult = (allLoaded && r4h) ? r4h as AnalysisResult : null;
  const r1hResult = (allLoaded && r1h) ? r1h as AnalysisResult : null;

  const decisionCls =
    mtfDecision === "ENTRY SIGNAL"  ? "entry" :
    mtfDecision === "PREPARE ENTRY" ? "prepare" :
    mtfDecision === "WATCH"         ? "watch" : "ignore";

  return (
    <div className="mtf-dashboard">

      {/* ── Verdict bar ── */}
      <div className={`mtf-verdict mtf-verdict--${globalStatus}`}>
        <div className="mtf-verdict__left">
          <span className="mtf-verdict__dot" />
          <div>
            <div className="mtf-verdict__label">{globalLabel}</div>
            {globalSub && <div className="mtf-verdict__sub">{globalSub}</div>}
          </div>
        </div>
        {allLoaded && (
          <span className={`mtf-decision-badge mtf-decision-badge--${decisionCls}`}>
            {mtfDecision}
          </span>
        )}
        {allLoaded && (
          <span className="mtf-verdict__total">
            <span className="mtf-verdict__total-bar">
              <span className="mtf-verdict__total-fill" style={{ width: `${weightedScore}%` }} />
            </span>
            <span className="mono mtf-verdict__total-val">{weightedScore}</span>
          </span>
        )}
      </div>

      {/* ── Market context cards (above layers) ── */}
      {r4hResult && r1hResult && (() => {
        const distOk   = r4hResult.distanceToResistance >= (r4hResult.suggestedTP - r4hResult.price) / r4hResult.price;
        const volCls   = r1hResult.relativeVolume > 1.5 ? "bull" : r1hResult.relativeVolume < 0.7 ? "bear" : "neut";
        const volLbl   = r1hResult.relativeVolume > 1.5 ? "Confirma" : r1hResult.relativeVolume < 0.7 ? "Baix" : "Normal";
        const volClass = r4hResult.volatilityClass;
        const volCatCls = volClass === "NORMAL" ? "bull" : volClass === "HIGH" ? "bear" : "neut";
        const volCatLbl = volClass === "NORMAL" ? "Òptima" : volClass === "HIGH" ? "Risc alt" : "Comprimit";
        const prec = r1hResult.price >= 100 ? 2 : 4;
        return (
          <div className="mtf-market-row">
            <div className="section-title">
              <i className="fa-solid fa-gauge-high" /> Mercat
            </div>
            <div className="analysis-group__cards">
              <div className={`analysis-ind-card analysis-ind-card--${distOk ? "bull" : "bear"}`}>
                <span className="analysis-ind-card__name">Dist. Resistència · 4h</span>
                <span className="analysis-ind-card__value mono">{(r4hResult.distanceToResistance * 100).toFixed(2)}%</span>
                <div className="analysis-ind-card__foot">
                  <span className="analysis-ind-card__detail">{distOk ? "Marge OK" : "Poc marge"}</span>
                  <span className={`sig-badge ${distOk ? "sig-badge--bull" : "sig-badge--bear"}`}>{distOk ? "Alcista" : "Bajista"}</span>
                </div>
              </div>
              <div className={`analysis-ind-card analysis-ind-card--${volCls}`}>
                <span className="analysis-ind-card__name">Vol. Relatiu · 1h</span>
                <span className="analysis-ind-card__value mono">{r1hResult.relativeVolume.toFixed(2)}×</span>
                <div className="analysis-ind-card__foot">
                  <span className="analysis-ind-card__detail">{volLbl}</span>
                  <span className={`sig-badge ${volCls === "bull" ? "sig-badge--bull" : volCls === "bear" ? "sig-badge--bear" : "sig-badge--neut"}`}>
                    {volCls === "bull" ? "Alcista" : volCls === "bear" ? "Bajista" : "Neutre"}
                  </span>
                </div>
              </div>
              <div className={`analysis-ind-card analysis-ind-card--${volCatCls}`}>
                <span className="analysis-ind-card__name">Volatilitat · 4h</span>
                <span className="analysis-ind-card__value mono">{volClass}</span>
                <div className="analysis-ind-card__foot">
                  <span className="analysis-ind-card__detail">{volCatLbl}</span>
                  <span className={`sig-badge ${volCatCls === "bull" ? "sig-badge--bull" : volCatCls === "bear" ? "sig-badge--bear" : "sig-badge--neut"}`}>
                    {volCatCls === "bull" ? "Alcista" : volCatCls === "bear" ? "Bajista" : "Neutre"}
                  </span>
                </div>
              </div>
              {r1hResult.pivotLow && (
                <div className="analysis-ind-card analysis-ind-card--bull">
                  <span className="analysis-ind-card__name">Pivot Low · 1h</span>
                  <span className="analysis-ind-card__value mono">{r1hResult.pivotLow.toFixed(prec)}</span>
                  <div className="analysis-ind-card__foot">
                    <span className="analysis-ind-card__detail">Suport identificat</span>
                    <span className="sig-badge sig-badge--bull">Alcista</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── Three layers row ── */}
      <div className="mtf-body">
        <div className="mtf-body__layers">
          {LAYERS.map(({ key, tf, role, icon, weight, layer }) => (
            <div key={key} className={`mtf-cell mtf-cell--${layer.status}`}>
              <div className="mtf-cell__head">
                <span className="mtf-cell__tf-tag">{tf}</span>
                <i className={`fa-solid ${icon} mtf-cell__icon`} />
                <span className="mtf-cell__role">{role}</span>
                <div className="mtf-cell__head-right">
                  <span className="mtf-cell__score">{layer.score}</span>
                  <span className="mtf-cell__weight">{weight}</span>
                </div>
              </div>
              <div className="mtf-cell__scorebar">
                <div className="mtf-cell__scorebar-track">
                  <div className="mtf-cell__scorebar-fill" style={{ width: `${layer.score}%` }} />
                </div>
              </div>
              <div className="mtf-cell__metrics">
                {layer.metrics.map((m, i) => (
                  <div key={i} className="mtf-cell__metric">
                    <span className="mtf-cell__metric-label">{m.label}</span>
                    <span className={`mono mtf-cell__metric-value mtf-cell__metric-value--${m.sig}`}>{m.value}</span>
                    <span className="mtf-cell__metric-desc">{m.desc}</span>
                  </div>
                ))}
              </div>
              <div className={`mtf-cell__status mtf-cell__status--${layer.status}`}>
                <span className="mtf-cell__dot" />
                {layer.label}
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}

export default function AnalysisTab({ onOpenOrder }: {
  onOpenOrder: (pair: string, side: "BUY" | "SELL", tp: string, sl: string, slLimit: string, interval?: Interval) => void;
}) {
  const [pair,      setPair]     = useState(PAIRS[0].pair);
  const [interval,  setInterval] = useState<Interval>("1h");
  const [cache,     setCache]    = useState<Record<string, LoadState>>({});
  const [cardView,  setCardView] = useState<"full" | "simple">("full");

  const abortRefs = useRef<Record<string, AbortController>>({});

  const load = useCallback(async (p: string, i: string) => {
    const key = `${p}:${i}`;
    abortRefs.current[key]?.abort();
    const controller = new AbortController();
    abortRefs.current[key] = controller;
    setCache(prev => ({ ...prev, [key]: "loading" }));
    try {
      const res = await fetch(`/api/analysis?symbol=${p}&interval=${i}`, { signal: controller.signal });
      const d   = await res.json();
      if (d.error) throw new Error(d.error);
      setCache(prev => ({ ...prev, [key]: d as AnalysisResult }));
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setCache(prev => ({ ...prev, [key]: "error" }));
    } finally {
      delete abortRefs.current[key];
    }
  }, []);

  // Load all pairs for the current interval on mount/interval change
  useEffect(() => {
    PAIRS.forEach(p => load(p.pair, interval));
  }, [interval, load]);

  // Always load all 3 TFs for the selected pair (needed by MTF dashboard)
  useEffect(() => {
    INTERVALS.forEach(i => load(pair, i));
  }, [pair, load]);

  // Abort all in-flight requests on unmount
  useEffect(() => () => { Object.values(abortRefs.current).forEach(c => c.abort()); }, []);

  const current = cache[`${pair}:${interval}`];

  const handleOpenOrder = (r: AnalysisResult) => {
    const prec = r.price >= 100 ? 2 : r.price >= 1 ? 4 : 6;
    onOpenOrder(
      r.symbol,
      "SELL",
      r.suggestedTP.toFixed(prec),
      r.suggestedSL.toFixed(prec),
      r.suggestedSLLimit.toFixed(prec),
      r.interval as Interval,
    );
  };

  return (
    <div className="analysis-tab">

      {/* ── Top: coin selector bar ── */}
      <div className="analysis-topbar">
        {PAIRS.map(p => {
          const st = cache[`${p.pair}:${interval}`];
          const isRes = st && st !== "loading" && st !== "error";
          const r  = isRes ? (st as AnalysisResult) : null;
          const sc = r?.score ?? null;
          const v  = r?.verdict ?? null;
          const scColor = v === "BUY" ? "var(--green)" : v === "AVOID" ? "var(--red)" : v === "WAIT" ? "#d97706" : "var(--text-3)";
          return (
            <button key={p.pair}
              className={`analysis-coin-btn${pair === p.pair ? " analysis-coin-btn--active" : ""}`}
              style={{ "--coin-color": p.color } as React.CSSProperties}
              onClick={() => setPair(p.pair)}>
              <CoinIcon symbol={p.symbol} size={14} />
              <span className="analysis-coin-btn__sym">{p.symbol}</span>
              {st === "loading"
                ? <i className="fa-solid fa-spinner fa-spin analysis-coin-btn__spin" />
                : sc != null
                  ? <span className="analysis-coin-btn__score" style={{ color: scColor }}>{sc}</span>
                  : null}
            </button>
          );
        })}
        <div className="analysis-topbar__right">
          <div className="analysis-intervals">
            {INTERVALS.map(i => (
              <button key={i}
                className={`analysis-interval-btn${interval === i ? " analysis-interval-btn--active" : ""}`}
                onClick={() => setInterval(i)}>
                {i}
              </button>
            ))}
          </div>
          <button className="analysis-refresh-btn"
            onClick={async () => {
              await fetch("/api/cache/invalidate?prefix=analysis%3A", { method: "DELETE" });
              PAIRS.forEach(p => load(p.pair, interval));
            }}
            title="Refresca tots">
            <i className="fa-solid fa-rotate-right" />
          </button>
        </div>
      </div>

      <div className="analysis-body">

        {/* ── Detail column (full width) ── */}
        <div className="analysis-detail-col">
          <div className="section-title">
            <i className="fa-solid fa-chart-area" /> Detall
            <span className="section-title__right">
              <button
                className={`analysis-view-btn${cardView === "full" ? " analysis-view-btn--active" : ""}`}
                onClick={() => setCardView("full")}>
                <i className="fa-solid fa-chart-area" /> Completa
              </button>
              <button
                className={`analysis-view-btn${cardView === "simple" ? " analysis-view-btn--active" : ""}`}
                onClick={() => setCardView("simple")}>
                <i className="fa-solid fa-table-list" /> Simple
              </button>
            </span>
          </div>

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
              <AnalysisView result={current} onOpenOrder={handleOpenOrder}
                cache={cache} pair={pair} simplified={cardView === "simple"} />
            )}
          </div>
        </div>


      </div>
    </div>
  );
}

function PriceLineChart({ candles, price, coinColor }: {
  candles: OHLCV[];
  price:   number;
  coinColor: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hovered, setHovered] = useState<{ c: OHLCV; sx: number; sy: number } | null>(null);

  if (!candles.length) return null;

  const W = 600, H = 370;
  const PAD = { top: 16, right: 72, bottom: 28, left: 8 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;

  const closes = candles.map(c => c.close);
  const minRaw = Math.min(...closes);
  const maxRaw = Math.max(...closes);
  const mg     = (maxRaw - minRaw) * 0.08 || maxRaw * 0.005;
  const minP   = minRaw - mg;
  const maxP   = maxRaw + mg;
  const range  = maxP - minP || 1;

  const toX = (i: number) => PAD.left + (i / (candles.length - 1)) * cW;
  const toY = (p: number) => PAD.top  + ((maxP - p) / range) * cH;

  const pts = candles.map((c, i) => `${toX(i)},${toY(c.close)}`).join(" ");
  const areaPath =
    `M${toX(0)},${toY(candles[0].close)} ` +
    candles.slice(1).map((c, i) => `L${toX(i + 1)},${toY(c.close)}`).join(" ") +
    ` L${toX(candles.length - 1)},${H - PAD.bottom} L${toX(0)},${H - PAD.bottom} Z`;

  const pFmt = (p: number) => p >= 1000 ? p.toFixed(0) : p >= 1 ? p.toFixed(2) : p.toFixed(5);
  const tFmt = (ts: number) => new Date(ts).toLocaleString("ca-ES", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });

  const ticks = [0, 1, 2, 3].map(i => minP + (range * i) / 3);
  const timeIdxs = [0, Math.floor(candles.length / 2), candles.length - 1];

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.max(0, Math.min(candles.length - 1,
      Math.round((svgX - PAD.left) / cW * (candles.length - 1))));
    setHovered({ c: candles[idx], sx: e.clientX - rect.left, sy: e.clientY - rect.top });
  };

  const hi = hovered ? candles.indexOf(hovered.c) : -1;

  return (
    <div style={{ position: "relative" }}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%"
        className="strat-chart" style={{ display: "block", cursor: "crosshair" }}
        onMouseMove={handleMouseMove} onMouseLeave={() => setHovered(null)}>

        {/* Grid lines */}
        {ticks.map((t, i) => (
          <line key={i} x1={PAD.left} y1={toY(t)} x2={W - PAD.right} y2={toY(t)}
            stroke="#00000010" strokeWidth={1} />
        ))}

        {/* Area fill */}
        <defs>
          <linearGradient id="price-area-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"  stopColor={coinColor} stopOpacity={0.18} />
            <stop offset="100%" stopColor={coinColor} stopOpacity={0.01} />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#price-area-grad)" />

        {/* Line */}
        <polyline points={pts} fill="none" stroke={coinColor} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />

        {/* Hover vertical guide */}
        {hi >= 0 && (
          <line x1={toX(hi)} y1={PAD.top} x2={toX(hi)} y2={H - PAD.bottom}
            stroke="#94a3b8" strokeWidth={0.8} strokeDasharray="3,2" />
        )}

        {/* Hover dot */}
        {hi >= 0 && (
          <circle cx={toX(hi)} cy={toY(candles[hi].close)} r={3}
            fill={coinColor} stroke="#fff" strokeWidth={1.5} />
        )}

        {/* Current price dashed */}
        <line x1={PAD.left} y1={toY(price)} x2={W - PAD.right} y2={toY(price)}
          stroke="#94a3b8" strokeWidth={0.8} strokeDasharray="3,2" />
        <text x={W - PAD.right + 4} y={toY(price) + 4} fontSize={11} fill="#64748b" fontFamily="monospace">Ara</text>

        {/* Price axis */}
        {ticks.map((t, i) => (
          <text key={i} x={W - PAD.right + 4} y={toY(t) + 4} fontSize={11} fill="#94a3b8" fontFamily="monospace">
            {pFmt(t)}
          </text>
        ))}

        {/* Time axis */}
        {timeIdxs.map(idx => (
          <text key={idx} x={toX(idx)} y={H - 6} fontSize={11} fill="#94a3b8"
            textAnchor={idx === 0 ? "start" : idx === candles.length - 1 ? "end" : "middle"}
            fontFamily="sans-serif">{tFmt(candles[idx].time)}</text>
        ))}

        {/* Coin accent top bar */}
        <rect x={PAD.left} y={PAD.top} width={cW} height={2} fill={coinColor} opacity={0.4} rx={1} />
      </svg>

      {/* Tooltip */}
      {hovered && hi >= 0 && (() => {
        const c = candles[hi];
        const up = c.close >= candles[Math.max(0, hi - 1)].close;
        return (
          <div className="strat-chart-tooltip" style={{
            left:  Math.min(hovered.sx + 10, 9999),
            top:   Math.max(4, hovered.sy - 56),
            transform: hovered.sx > 350 ? "translateX(-110%)" : undefined,
          }}>
            <div style={{ fontSize: "0.62rem", color: "#94a3b8", marginBottom: 2 }}>{tFmt(c.time)}</div>
            <div style={{ color: up ? "#4ade80" : "#f87171", fontWeight: 700, fontFamily: "monospace" }}>
              {pFmt(c.close)}
            </div>
          </div>
        );
      })()}
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
    <div className={`strat-card strat-card--${s.type}${s.active ? "" : " strat-card--inactive"}`}>
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

function AnalysisView({ result, onOpenOrder, cache, pair, simplified = false, hideStrategies = false }: {
  result: AnalysisResult;
  onOpenOrder: (r: AnalysisResult) => void;
  cache: Record<string, TfState>;
  pair:  string;
  simplified?: boolean;
  hideStrategies?: boolean;
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

  const verdictColor = result.verdict === "BUY" ? "green" : result.verdict === "AVOID" ? "red" : "neutral";
  const verdictLabel = result.verdict === "BUY" ? "COMPRA" : result.verdict === "AVOID" ? "EVITA" : "ESPERA";
  const activeStrats = result.strategies.filter(s => s.active).length;

  // Map tradeDecision to display
  const decisionIcon =
    result.tradeDecision === "ENTRY SIGNAL"  ? "fa-circle-check" :
    result.tradeDecision === "PREPARE ENTRY" ? "fa-circle-half-stroke" :
    result.tradeDecision === "WATCH"         ? "fa-eye" : "fa-ban";
  const decisionColor =
    result.tradeDecision === "ENTRY SIGNAL"  ? "green" :
    result.tradeDecision === "PREPARE ENTRY" ? "yellow" :
    result.tradeDecision === "WATCH"         ? "yellow" : "red";

  return (
    <div className="analysis-view">

      {/* ── 3 stat cards ── */}
      <div className="section-title">
        <i className="fa-solid fa-gauge-high" /> {symbol} · {result.interval}
      </div>
      <div className="portfolio__cards">

        <div className="portfolio__card portfolio__card--blue">
          <span className="portfolio__card-label">
            <CoinIcon symbol={symbol} size={12} />
            {symbol}<span style={{ fontWeight: 400, color: "var(--text-3)" }}>/USDT</span>
          </span>
          <span className="portfolio__card-value mono" style={{ fontSize: "1.2rem" }}>
            {formatCurrency(result.price)}
          </span>
          <span className="portfolio__card-sub">
            {result.interval} · ATR <span className="mono">{priceFmt(result.atr)}</span>
          </span>
        </div>

        <div className={`portfolio__card portfolio__card--${verdictColor}`}>
          <span className="portfolio__card-label">
            <i className="fa-solid fa-gauge-high" /> Score {result.interval}
          </span>
          <span className="portfolio__card-value">
            {result.score}
            <span style={{ fontSize: "0.75rem", fontWeight: 500, color: "var(--text-3)" }}>%</span>
          </span>
          <span className="portfolio__card-sub">
            <span className={`verdict-badge verdict--${result.verdict === "BUY" ? "buy" : result.verdict === "AVOID" ? "avoid" : "wait"}`}>
              {verdictLabel}
            </span>
          </span>
        </div>

        <div className="portfolio__card portfolio__card--neutral">
          <span className="portfolio__card-label">
            <i className={`fa-solid ${decisionIcon}`} /> Decisió MTF
          </span>
          <span className={`portfolio__card-value analysis-decision analysis-decision--${decisionColor}`}>
            {result.tradeDecision === "ENTRY SIGNAL"  ? "ENTRY" :
             result.tradeDecision === "PREPARE ENTRY" ? "PREPARE" :
             result.tradeDecision === "WATCH"         ? "WATCH" : "IGNORE"}
          </span>
          <span className="portfolio__card-sub">
            {activeStrats > 0 ? `${activeStrats}/${result.strategies.length} estratègies actives` : "Cap estratègia activa"}
          </span>
        </div>

      </div>

      {/* ── Price Chart + Panel ── */}
      {!simplified && result.candles.length > 0 && (() => {
        const prec      = result.price >= 100 ? 2 : result.price >= 1 ? 4 : 6;
        const profitPct = Math.abs((result.suggestedTP - result.price) / result.price * 100);
        const riskPct   = Math.abs((result.suggestedSL - result.price) / result.price * 100);
        const rrRatio   = riskPct > 0 ? profitPct / riskPct : 0;

        const pros: string[] = [];
        const cons: string[] = [];

        if (!isNaN(result.raw.ema200) && result.price > result.raw.ema200)
          pros.push(`Preu per sobre de l'EMA200 — tendència alcista confirmada`);
        else
          cons.push(`Preu per sota de l'EMA200 — tendència baixista dominant`);

        if (result.raw.adx > 25)
          pros.push(`ADX ${result.raw.adx.toFixed(1)} — tendència forta i definida`);
        else if (result.raw.adx < 15)
          cons.push(`ADX ${result.raw.adx.toFixed(1)} — mercat lateral, sense tendència clara`);

        if (result.raw.rsi > 70)
          cons.push(`RSI ${result.raw.rsi.toFixed(1)} — sobrecomprat, risc de correcció`);
        else if (result.raw.rsi < 35)
          cons.push(`RSI ${result.raw.rsi.toFixed(1)} — sobrevenda, risc de caiguda prolongada`);
        else if (result.raw.rsi >= 45 && result.raw.rsi <= 65)
          pros.push(`RSI ${result.raw.rsi.toFixed(1)} — zona òptima d'entrada`);

        if (result.relativeVolume > 1.5)
          pros.push(`Volum ${result.relativeVolume.toFixed(2)}× — confirma el moviment`);
        else if (result.relativeVolume < 0.7)
          cons.push(`Volum baix ${result.relativeVolume.toFixed(2)}× — moviment sense convicció`);

        if (result.volatilityClass === "NORMAL")
          pros.push("Volatilitat normal — condicions de trading òptimes");
        else if (result.volatilityClass === "HIGH")
          cons.push("Volatilitat alta — risc de slippage i SL prematur");
        else
          cons.push("Volatilitat baixa — mercat comprimit, espera expansió");

        const th = (result.suggestedTP - result.price) / result.price;
        if (result.distanceToResistance >= th)
          pros.push(`Marge fins resistència ${(result.distanceToResistance * 100).toFixed(1)}% — TP assolible`);
        else
          cons.push(`Resistència propera ${(result.distanceToResistance * 100).toFixed(1)}% — TP pot ser bloquejat`);

        if (result.raw.macdBull)
          pros.push("MACD en zona alcista — moment comprador actiu");
        else
          cons.push("MACD en zona baixista — pressió venedora dominant");

        if (result.pivotLow)
          pros.push(`Pivot Low a ${priceFmt(result.pivotLow)} — nivell de suport identificat`);

        const summaryMap: Record<string, string> = {
          "ENTRY SIGNAL":  `Les 3 capes MTF confirmen l'entrada. Score ${result.score}/100 — condicions tècniques favorables per obrir posició ara.`,
          "PREPARE ENTRY": `Condicions parcials completes (score ${result.score}/100). Prepara l'ordre i espera el trigger final al timeframe curt.`,
          "WATCH":         `Mercat en observació (score ${result.score}/100). Algunes condicions es compleixen però falta confirmació. No operar encara.`,
          "IGNORE":        `Condicions desfavorables. Score ${result.score}/100 — risc elevat de pèrdua. Espera un millor setup.`,
        };
        const summary  = summaryMap[result.tradeDecision] ?? "";
        const canEnter = result.tradeDecision === "ENTRY SIGNAL" || result.tradeDecision === "PREPARE ENTRY";

        return (
          <div className="analysis-section analysis-section--flush">
            <div className="section-title">
              <i className="fa-solid fa-chart-line" /> Gràfic {symbol} · {result.interval}
              <span className="analysis-section__tf">{result.candles.length} espelmes</span>
            </div>
            <div className="analysis-chart-row">
              <div className="analysis-chart-row__chart">
                <div className="analysis-chart-wrap">
                  <PriceLineChart candles={result.candles} price={result.price} coinColor={coinColor} />
                </div>
              </div>

              <div className="analysis-chart-row__panel">
                <div className={`chart-panel__decision chart-panel__decision--${decisionColor}`}>
                  <i className={`fa-solid ${decisionIcon}`} />
                  <span>{result.tradeDecision}</span>
                </div>

                <p className="chart-panel__summary">{summary}</p>

                <div className="chart-panel__reasons">
                  {pros.map((t, i) => (
                    <div key={i} className="chart-panel__reason chart-panel__reason--pro">
                      <i className="fa-solid fa-check" /><span>{t}</span>
                    </div>
                  ))}
                  {cons.map((t, i) => (
                    <div key={i} className="chart-panel__reason chart-panel__reason--con">
                      <i className="fa-solid fa-xmark" /><span>{t}</span>
                    </div>
                  ))}
                </div>

                <div className="chart-panel__levels">
                  <div className="chart-panel__lvl">
                    <span className="chart-panel__lvl-label">Take Profit ▲</span>
                    <span className="mono chart-panel__lvl-price" style={{ color: "var(--green)" }}>{result.suggestedTP.toFixed(prec)}</span>
                    <span className="chart-panel__lvl-pct" style={{ color: "var(--green)" }}>+{profitPct.toFixed(2)}%</span>
                  </div>
                  <div className="chart-panel__lvl">
                    <span className="chart-panel__lvl-label">Stop Loss ▼</span>
                    <span className="mono chart-panel__lvl-price" style={{ color: "var(--red)" }}>{result.suggestedSL.toFixed(prec)}</span>
                    <span className="chart-panel__lvl-pct" style={{ color: "var(--red)" }}>−{riskPct.toFixed(2)}%</span>
                  </div>
                  <div className="chart-panel__lvl">
                    <span className="chart-panel__lvl-label">Ratio R:R</span>
                    <span className="mono chart-panel__lvl-price">{rrRatio.toFixed(2)}×</span>
                    <span className="chart-panel__lvl-pct">{rrRatio >= 2 ? "Excel·lent" : rrRatio >= 1.5 ? "Acceptable" : "Baix"}</span>
                  </div>
                </div>

                {canEnter && (
                  <button className="chart-panel__btn" onClick={() => onOpenOrder(result)}>
                    <i className="fa-solid fa-plus" /> Obre ordre OCO
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Simplified: TP/SL/Decision panel (no chart) ── */}
      {simplified && (() => {
        const prec      = result.price >= 100 ? 2 : result.price >= 1 ? 4 : 6;
        const profitPct = Math.abs((result.suggestedTP - result.price) / result.price * 100);
        const riskPct   = Math.abs((result.suggestedSL - result.price) / result.price * 100);
        const rrRatio   = riskPct > 0 ? profitPct / riskPct : 0;
        const canEnter  = result.tradeDecision === "ENTRY SIGNAL" || result.tradeDecision === "PREPARE ENTRY";
        const decisionColor = result.tradeDecision === "ENTRY SIGNAL" ? "green" : result.tradeDecision === "PREPARE ENTRY" ? "yellow" : result.tradeDecision === "WATCH" ? "yellow" : "red";
        const decisionIcon  = result.tradeDecision === "ENTRY SIGNAL" ? "fa-circle-check" : result.tradeDecision === "PREPARE ENTRY" ? "fa-circle-half-stroke" : result.tradeDecision === "WATCH" ? "fa-eye" : "fa-ban";
        return (
          <div className="analysis-section">
            <div className={`chart-panel__decision chart-panel__decision--${decisionColor}`}>
              <i className={`fa-solid ${decisionIcon}`} /><span>{result.tradeDecision}</span>
            </div>
            <div className="chart-panel__levels" style={{ marginTop: "0.75rem" }}>
              <div className="chart-panel__lvl">
                <span className="chart-panel__lvl-label">Take Profit ▲</span>
                <span className="mono chart-panel__lvl-price" style={{ color: "var(--green)" }}>{result.suggestedTP.toFixed(prec)}</span>
                <span className="chart-panel__lvl-pct" style={{ color: "var(--green)" }}>+{profitPct.toFixed(2)}%</span>
              </div>
              <div className="chart-panel__lvl">
                <span className="chart-panel__lvl-label">Stop Loss ▼</span>
                <span className="mono chart-panel__lvl-price" style={{ color: "var(--red)" }}>{result.suggestedSL.toFixed(prec)}</span>
                <span className="chart-panel__lvl-pct" style={{ color: "var(--red)" }}>−{riskPct.toFixed(2)}%</span>
              </div>
              <div className="chart-panel__lvl">
                <span className="chart-panel__lvl-label">Ratio R:R</span>
                <span className="mono chart-panel__lvl-price">{rrRatio.toFixed(2)}×</span>
                <span className="chart-panel__lvl-pct">{rrRatio >= 2 ? "Excel·lent" : rrRatio >= 1.5 ? "Acceptable" : "Baix"}</span>
              </div>
            </div>
            {canEnter && (
              <button className="chart-panel__btn" style={{ marginTop: "0.75rem" }} onClick={() => onOpenOrder(result)}>
                <i className="fa-solid fa-plus" /> Obre ordre OCO
              </button>
            )}
          </div>
        );
      })()}

      {/* ── MTF Dashboard ── */}
      <div className="analysis-section analysis-section--flush">
        <div className="section-title">
          <i className="fa-solid fa-chart-bar" /> Dashboard Multi-Timeframe
          <span className="analysis-section__tf">5m · 1h · 4h</span>
        </div>
        <MultiTimeframeDashboard cache={cache} pair={pair} />
      </div>

      {/* ── Indicators (collapsible) ── */}
      <div className="analysis-section analysis-section--flush analysis-section--indicators">
        <div
          className="section-title"
          onClick={() => setShowIndicators(v => !v)}
        >
          <i className="fa-solid fa-sliders" /> Indicadors tècnics
          <span className="section-title__right">
            <span className="analysis-section__toggle-btn">
              <i className={`fa-solid fa-chevron-${showIndicators ? "up" : "down"}`} />
              {showIndicators ? "Amaga" : "Mostra"}
            </span>
          </span>
        </div>
        {showIndicators && (
          <div className="analysis-groups">
            {result.groups.map(g => (
              <div key={g.name} className="analysis-group">
                <div className="section-title analysis-group__title">
                  <i className="fa-solid fa-layer-group" /> {g.name}
                </div>
                <div className="analysis-group__cards">
                  {g.indicators.map(ind => {
                    const sigCls = ind.signal === "bullish" ? "analysis-ind-card--bull"
                                 : ind.signal === "bearish" ? "analysis-ind-card--bear"
                                 : "analysis-ind-card--neut";
                    return (
                      <div key={ind.name} className={`analysis-ind-card ${sigCls}`}>
                        <span className="analysis-ind-card__name">{ind.name}</span>
                        <span className="analysis-ind-card__value mono">{ind.value}</span>
                        <div className="analysis-ind-card__foot">
                          {ind.detail && <span className="analysis-ind-card__detail">{ind.detail}</span>}
                          <SignalBadge signal={ind.signal} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Strategies (after indicators) ── */}
      <div className="analysis-section analysis-section--flush analysis-section--strategies">
        <div className="section-title">
          <i className="fa-solid fa-brain" /> Estratègies proposades
          <span className="section-title__right">
            <span className="analysis-section__count">{result.strategies.length} total</span>
          </span>
        </div>
        {result.strategies.length === 0 ? (
          <div className="state-empty">No hi ha estratègies clares en aquest moment.</div>
        ) : (
          <div className="strat-list">
            {result.strategies.map((s, i) => (
              <StrategyCard
                key={i} s={s} price={result.price} atr={result.atr} coinColor={coinColor} candles={result.candles}
                onOpenOrder={(tp, sl, slLimit) => {
                  onOpenOrder({ ...result, suggestedTP: parseFloat(tp), suggestedSL: parseFloat(sl), suggestedSLLimit: parseFloat(slLimit) });
                  void handleStratOCO(result, tp, sl, slLimit);
                }}
              />
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
