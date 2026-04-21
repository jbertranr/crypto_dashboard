"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import type { SimConfig, SimStats, SimTrade } from "../api/simulation/run/route";
import {
  ParamDef, ParamRange, ParamRanges, OptMetric,
  P_TRAILING, P_BREAK_EVEN, P_LET_RUN, P_MOON, P_PUMP_VOL, P_CANDLES,
  PARAM_DEFS, metricValue, AdaptiveSampler, createAdaptiveSampler, adaptiveSample,
} from "../lib/sim-optimizer";

/* ── Types ────────────────────────────────────────────────────────── */

interface SavedConfig {
  id: string; name: string; savedAt: string; pnlPct?: number; config: SimConfig;
}
interface EqPoint    { time: number; value: number; }
interface RunResult  { stats: SimStats; equityCurve: EqPoint[]; trades?: SimTrade[]; }
interface IterResult { id: number; params: Partial<SimConfig>; stats: SimStats; equityCurve: EqPoint[]; minProbability?: number; }

const METRIC_OPTIONS: { key: OptMetric; label: string }[] = [
  { key: "pnlPct",        label: "P&L %"        },
  { key: "profitFactor",  label: "Profit Factor" },
  { key: "winRate",       label: "Win Rate"      },
  { key: "score",         label: "Score compost" },
];

/* ── Overlay equity chart ─────────────────────────────────────────── */

function OverlayChart({ results, picked, initialCapital }: {
  results: IterResult[];
  picked:  IterResult | null;
  initialCapital: number;
}) {
  const curves = results.filter(r => r.equityCurve && r.equityCurve.length > 1);
  if (curves.length === 0) return null;

  const W = 600, H = 180, padL = 44, padR = 8, padT = 8, padB = 18;
  const cW = W - padL - padR;
  const cH = H - padT - padB;

  const allVals = curves.flatMap(r => r.equityCurve.map(p => p.value));
  const rawMin  = Math.min(...allVals, initialCapital);
  const rawMax  = Math.max(...allVals, initialCapital);
  const pad     = (rawMax - rawMin) * 0.04 || rawMin * 0.02 || 1;
  const minV    = rawMin - pad;
  const maxV    = rawMax + pad;
  const vR      = maxV - minV;

  const xs = (i: number, total: number) =>
    padL + (i / Math.max(1, total - 1)) * cW;
  const ys = (v: number) =>
    padT + cH - ((v - minV) / vR) * cH;

  const yTicks = [minV, (minV + maxV) / 2, maxV];
  const fmtY   = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0);

  const nonPicked = curves.filter(r => !picked || r.id !== picked.id);
  const pickedCurve = picked && picked.equityCurve.length > 1 ? picked : null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="eq-overlay-svg" preserveAspectRatio="none">
      {/* Grid lines + Y labels */}
      {yTicks.map((v, i) => (
        <g key={i}>
          <line x1={padL} y1={ys(v).toFixed(1)} x2={W - padR} y2={ys(v).toFixed(1)}
            stroke="var(--border)" strokeWidth="0.5" />
          <text x={padL - 4} y={(ys(v) + 3).toFixed(1)} fontSize="7"
            fill="var(--text-3)" textAnchor="end">{fmtY(v)}</text>
        </g>
      ))}

      {/* Baseline at initial capital */}
      <line x1={padL} y1={ys(initialCapital).toFixed(1)}
        x2={W - padR} y2={ys(initialCapital).toFixed(1)}
        stroke="#94a3b8" strokeWidth="1" strokeDasharray="3,2" opacity="0.5" />

      {/* Background curves */}
      {nonPicked.map(r => {
        const pos = r.stats.totalPnlPct >= 0;
        const pts = r.equityCurve
          .map((p, i) => `${xs(i, r.equityCurve.length).toFixed(1)},${ys(p.value).toFixed(1)}`)
          .join(" ");
        return (
          <polyline key={r.id} points={pts} fill="none"
            stroke={pos ? "#059669" : "#dc2626"}
            strokeWidth="0.8" opacity="0.25" strokeLinejoin="round" />
        );
      })}

      {/* Picked curve — highlighted on top */}
      {pickedCurve && (() => {
        const pos = pickedCurve.stats.totalPnlPct >= 0;
        const pts = pickedCurve.equityCurve
          .map((p, i) => `${xs(i, pickedCurve.equityCurve.length).toFixed(1)},${ys(p.value).toFixed(1)}`)
          .join(" ");
        const last = pickedCurve.equityCurve[pickedCurve.equityCurve.length - 1];
        const lx   = xs(pickedCurve.equityCurve.length - 1, pickedCurve.equityCurve.length);
        return (<>
          <polyline points={pts} fill="none"
            stroke={pos ? "#10b981" : "#ef4444"}
            strokeWidth="2.2" opacity="0.95" strokeLinejoin="round" />
          <circle cx={lx.toFixed(1)} cy={ys(last.value).toFixed(1)} r="3"
            fill={pos ? "#10b981" : "#ef4444"} />
        </>);
      })()}

      {/* Legend */}
      <g transform={`translate(${padL + 6}, ${padT + 6})`}>
        <line x1="0" y1="4" x2="10" y2="4" stroke="#10b981" strokeWidth="2" opacity="0.7" />
        <text x="13" y="7" fontSize="7" fill="var(--text-3)">+P&amp;L</text>
        <line x1="32" y1="4" x2="42" y2="4" stroke="#ef4444" strokeWidth="2" opacity="0.7" />
        <text x="45" y="7" fontSize="7" fill="var(--text-3)">–P&amp;L</text>
        {pickedCurve && <>
          <line x1="64" y1="4" x2="74" y2="4"
            stroke={pickedCurve.stats.totalPnlPct >= 0 ? "#10b981" : "#ef4444"}
            strokeWidth="2.2" />
          <text x="77" y="7" fontSize="7" fill="var(--text-2)">seleccionat</text>
        </>}
      </g>
    </svg>
  );
}

/* ── Mini equity chart (validation panel) ─────────────────────────── */

function MiniChart({ curve, initial }: { curve: EqPoint[]; initial: number }) {
  if (curve.length < 2) return <div className="eq-chart-empty">—</div>;
  const W = 320, H = 80;
  const vals  = curve.map(p => p.value);
  const minV  = Math.min(...vals, initial) * 0.98;
  const maxV  = Math.max(...vals, initial) * 1.02;
  const vR    = maxV - minV || 1;
  const times = curve.map(p => p.time);
  const minT  = times[0], tR = times[times.length - 1] - minT || 1;
  const xs    = (t: number) => ((t - minT) / tR) * W;
  const ys    = (v: number) => H - ((v - minV) / vR) * H;
  const last  = vals[vals.length - 1];
  const clr   = last >= initial ? "#059669" : "#dc2626";
  const pts   = curve.map(p => `${xs(p.time).toFixed(1)},${ys(p.value).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="eq-chart-svg" preserveAspectRatio="none">
      <line x1="0" y1={ys(initial).toFixed(1)} x2={W} y2={ys(initial).toFixed(1)}
        stroke="#94a3b8" strokeWidth="1" strokeDasharray="4,3" opacity="0.5" />
      <polyline points={pts} fill="none" stroke={clr} strokeWidth="2" strokeLinejoin="round" />
      <circle cx={xs(times[times.length - 1])} cy={ys(last)} r="3" fill={clr} />
    </svg>
  );
}

/* ── Helpers ──────────────────────────────────────────────────────── */

function fmtDate(ms: number | undefined | null) {
  if (!ms || isNaN(ms)) return "";
  return new Date(ms).toISOString().slice(0, 10);
}
function parseDate(s: string) { return new Date(s).getTime(); }
function fmtSavedAt(iso: string) {
  return new Date(iso).toLocaleDateString("ca-ES", { day: "2-digit", month: "short", year: "2-digit" });
}
function pnlColor(v: number) { return v >= 0 ? "var(--green)" : "var(--red)"; }

/* ── Range param row ──────────────────────────────────────────────── */

function RangeRow({ def, range, onChange }: {
  def:      ParamDef;
  range:    ParamRange;
  onChange: (r: ParamRange) => void;
}) {
  return (
    <div className="eq-range-row">
      <span className="eq-range-row__label">{def.label}</span>
      <input
        type="number" className="eq-range-input"
        min={def.min} max={range.hi} step={def.step}
        value={range.lo}
        onChange={e => onChange({ ...range, lo: parseFloat(e.target.value) || def.min })}
      />
      <div className="eq-range-bar">
        <div className="eq-range-bar__fill"
          style={{
            left:  `${((range.lo - def.min) / (def.max - def.min)) * 100}%`,
            right: `${(1 - (range.hi - def.min) / (def.max - def.min)) * 100}%`,
          }}
        />
      </div>
      <input
        type="number" className="eq-range-input"
        min={range.lo} max={def.max} step={def.step}
        value={range.hi}
        onChange={e => onChange({ ...range, hi: parseFloat(e.target.value) || def.max })}
      />
      <span className="eq-range-row__hint dim">{def.fmt(range.lo)} – {def.fmt(range.hi)}</span>
    </div>
  );
}

/* ── Main component ───────────────────────────────────────────────── */

export default function EqualizerTab() {
  const [configs,  setConfigs]  = useState<SavedConfig[]>([]);
  const [selected, setSelected] = useState<SavedConfig | null>(null);

  const [ranges,   setRanges]   = useState<ParamRanges>({});
  const [aFrom,    setAFrom]    = useState("");
  const [aTo,      setATo]      = useState("");
  const [bFrom,    setBFrom]    = useState("");
  const [bTo,      setBTo]      = useState("");

  const [iterations, setIterations] = useState(30);
  const [metric,     setMetric]     = useState<OptMetric>("pnlPct");
  const [probSweep,  setProbSweep]  = useState(false);
  const [probValues, setProbValues] = useState<number[]>([60, 70, 80]);

  const [warming,    setWarming]    = useState(false);
  const [running,    setRunning]    = useState(false);
  const [progress,   setProgress]   = useState(0);
  const [results,    setResults]    = useState<IterResult[]>([]);
  const [error,      setError]      = useState<string | null>(null);
  const [errCount,   setErrCount]   = useState(0);
  const [lastErrMsg, setLastErrMsg] = useState<string | null>(null);

  const [picked,     setPicked]     = useState<IterResult | null>(null);
  const [valResult,  setValResult]  = useState<RunResult  | null>(null);
  const [validating, setValidating] = useState(false);

  const [savingReport, setSavingReport] = useState<number | null>(null);
  const [savingBot,    setSavingBot]    = useState<number | null>(null);
  const [savedBotMsg,  setSavedBotMsg]  = useState<string | null>(null);

  const abortRef     = useRef(false);
  const pendingRunRef = useRef(false);

  useEffect(() => {
    fetch("/api/simulation/configs")
      .then(r => r.json())
      .then(d => {
        const list = Array.isArray(d) ? d : (d?.configs ?? []);
        setConfigs(list);
      });
  }, []);

  const buildDefaultRanges = useCallback((defs: ParamDef[], baseConfig: SimConfig): ParamRanges => {
    const r: ParamRanges = {};
    for (const def of defs) {
      const cur = (baseConfig as unknown as Record<string, unknown>)[String(def.key)];
      const val = typeof cur === "number" ? cur : (def.min + def.max) / 2;
      const span = (def.max - def.min) * 0.3;
      r[String(def.key)] = {
        lo: parseFloat(Math.max(def.min, val - span).toFixed(8)),
        hi: parseFloat(Math.min(def.max, val + span).toFixed(8)),
      };
    }
    return r;
  }, []);

  const selectConfig = useCallback((cfg: SavedConfig) => {
    setSelected(cfg);
    setResults([]);
    setProgress(0);
    setPicked(null);
    setValResult(null);
    setError(null);

    setAFrom("2023-01-01");
    setATo("2024-12-31");
    setBFrom("2025-01-01");
    setBTo("2025-12-31");

    const exitMode  = String(cfg.config.exitMode  ?? "TRAILING");
    const entryMode = String(cfg.config.entryMode ?? "ANALYSIS");
    const baseDefs  = PARAM_DEFS[exitMode] ?? P_TRAILING;
    const allDefs   = entryMode === "PUMP" ? [P_PUMP_VOL, ...baseDefs] : entryMode === "CANDLES" ? [P_CANDLES, ...baseDefs] : baseDefs;
    setRanges(buildDefaultRanges(allDefs, cfg.config));
  }, [buildDefaultRanges]);

  const narrowRanges = useCallback(() => {
    if (!selected || results.length === 0) return;
    const best = results[0];
    const exitMode  = String(selected.config.exitMode  ?? "TRAILING");
    const entryMode = String(selected.config.entryMode ?? "ANALYSIS");
    const baseDefs  = PARAM_DEFS[exitMode] ?? P_TRAILING;
    const allDefs   = entryMode === "PUMP" ? [P_PUMP_VOL, ...baseDefs] : entryMode === "CANDLES" ? [P_CANDLES, ...baseDefs] : baseDefs;

    const newRanges: ParamRanges = {};
    for (const def of allDefs) {
      const key = String(def.key);
      const val = (best.params as Record<string, number>)[key];
      if (val === undefined) continue;
      const cur  = ranges[key] ?? { lo: def.min, hi: def.max };
      const span = (cur.hi - cur.lo) * 0.4;
      newRanges[key] = {
        lo: parseFloat(Math.max(def.min, val - span).toFixed(8)),
        hi: parseFloat(Math.min(def.max, val + span).toFixed(8)),
      };
    }
    setRanges(newRanges);
    setResults([]);
    setProgress(0);
    setPicked(null);
    setValResult(null);
  }, [selected, results, ranges]);

  async function runWith(params: Partial<SimConfig>, from: number, to: number): Promise<RunResult> {
    const body: SimConfig = { ...selected!.config, ...params, from, to };
    const res = await fetch("/api/simulation/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error((d as { error?: string }).error ?? `Error ${res.status}`);
    }
    return res.json();
  }

  const handleWarmup = useCallback(async () => {
    if (!selected) return;
    const af = parseDate(aFrom), at = parseDate(aTo);
    if (isNaN(af) || isNaN(at) || af >= at) { setError("Periode d'anàlisi invàlid"); return; }
    setWarming(true);
    setError(null);
    try {
      const r = await fetch("/api/simulation/warmup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols: selected.config.symbols, interval: selected.config.interval, from: af, to: at }),
      });
      const d = await r.json() as { ok?: boolean; error?: string };
      if (!d.ok) setError(d.error ?? "Error escalfant cache");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWarming(false);
    }
  }, [selected, aFrom, aTo]);

  const handleSearch = useCallback(async () => {
    if (!selected) return;
    const af = parseDate(aFrom), at = parseDate(aTo);
    if (isNaN(af) || isNaN(at) || af >= at) { setError("Periode d'anàlisi invàlid"); return; }

    const exitMode  = String(selected.config.exitMode  ?? "TRAILING");
    const entryMode = String(selected.config.entryMode ?? "ANALYSIS");
    const baseDefs  = PARAM_DEFS[exitMode] ?? P_TRAILING;
    const allDefs   = entryMode === "PUMP" ? [P_PUMP_VOL, ...baseDefs] : entryMode === "CANDLES" ? [P_CANDLES, ...baseDefs] : baseDefs;

    setRunning(true);
    setProgress(0);
    setError(null);
    setErrCount(0);
    setLastErrMsg(null);
    abortRef.current = false;

    const accumulated: IterResult[] = [];

    // Sweep mode: executa un bloc d'iteracions per cada valor de probabilitat fixat
    const probBlocks = (probSweep && entryMode === "ANALYSIS" && probValues.length > 0)
      ? probValues.slice().sort((a, b) => a - b)
      : [null];

    const totalIter = iterations * probBlocks.length;
    let globalIter  = 0;

    for (const prob of probBlocks) {
      if (abortRef.current) break;
      const sampler = createAdaptiveSampler(iterations);

      for (let i = 0; i < iterations; i++) {
        if (abortRef.current) break;
        try {
          const params = adaptiveSample(allDefs, ranges, sampler, metric);
          if (prob !== null) params.minProbability = prob;
          const result = await runWith(params, af, at);
          const entry: IterResult = {
            id: Date.now() + globalIter,
            params,
            stats: result.stats,
            equityCurve:    result.equityCurve ?? [],
            minProbability: prob ?? undefined,
          };
          accumulated.push(entry);
          const sorted = [...accumulated]
            .sort((a, b) => metricValue(b.stats, metric) - metricValue(a.stats, metric))
            .slice(0, 200);
          setResults([...sorted]);
          globalIter++;
          setProgress(Math.round((globalIter / totalIter) * 100));
          sampler.history   = sorted
            .filter(r => r.minProbability === (prob ?? undefined))
            .map(r => ({ params: r.params, score: metricValue(r.stats, metric) }));
          sampler.iteration = i + 1;
        } catch (err) {
          const msg = (err as Error).message ?? "Error desconegut";
          setErrCount(c => c + 1);
          setLastErrMsg(msg);
          sampler.iteration = i + 1;
          globalIter++;
        }
      }
    }

    setRunning(false);
  }, [selected, aFrom, aTo, iterations, metric, ranges, probSweep, probValues]);

  const handleAbort = () => { abortRef.current = true; };

  const handleRunConfig = useCallback((cfg: SavedConfig) => {
    pendingRunRef.current = true;
    selectConfig(cfg);
  }, [selectConfig]);

  useEffect(() => {
    if (pendingRunRef.current && selected) {
      pendingRunRef.current = false;
      handleSearch();
    }
  }, [selected, handleSearch]);

  const handleValidate = useCallback(async (item: IterResult) => {
    if (!selected) return;
    const bf = parseDate(bFrom), bt = parseDate(bTo);
    if (isNaN(bf) || isNaN(bt) || bf >= bt) { setError("Periode de validació invàlid"); return; }

    setPicked(item);
    setValidating(true);
    setValResult(null);
    setError(null);
    try {
      const r = await runWith(item.params, bf, bt);
      setValResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setValidating(false);
    }
  }, [selected, bFrom, bTo]);

  /* ── Save handlers ──────────────────────────────────────────────── */

  function downloadJSON(obj: unknown, filename: string) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  const handleSaveReport = useCallback(async (item: IterResult) => {
    if (!selected) return;
    setSavingReport(item.id);
    try {
      // ── Determine modes and relevant param defs ──────────────────────
      const exitMode_  = String(selected.config.exitMode  ?? "TRAILING");
      const entryMode_ = String(selected.config.entryMode ?? "ANALYSIS");
      const interval_  = String(selected.config.interval  ?? "?");
      const symbols_   = (selected.config.symbols ?? []).join(", ");
      const capital_   = Number(selected.config.initialCapital ?? 1000);
      const capMode_   = String(selected.config.capitalMode ?? "FIXED");

      const baseDefs_ = PARAM_DEFS[exitMode_] ?? P_TRAILING;
      const allDefs_  = entryMode_ === "PUMP" ? [P_PUMP_VOL, ...baseDefs_] : entryMode_ === "CANDLES" ? [P_CANDLES, ...baseDefs_] : baseDefs_;

      // ── Build entry mode description ─────────────────────────────────
      const entryDesc =
        entryMode_ === "PUMP"
          ? `Mode PUMP: l'entrada s'activa quan el volum relatiu supera ${
              (item.params as Record<string, number>).pumpVolMin
                ?? (selected.config as unknown as Record<string, number>).pumpVolMin
                ?? 3.0
            }× la mitjana. La vela ha de ser verda i tancar en el 60% superior del seu rang. No s'utilitza cap indicador tècnic d'anàlisi.`
          : entryMode_ === "CANDLES"
          ? `Mode CANDLES: l'entrada s'activa quan es detecta un patró de candlestick bullish amb confiança ≥ ${
              (item.params as Record<string, number>).candlePatternScore
                ?? (selected.config as unknown as Record<string, number>).candlePatternScore
                ?? 70
            }%. Patrons actius: ${
              (selected.config.candlePatterns ?? []).length === 0
                ? "tots"
                : (selected.config.candlePatterns ?? []).join(", ")
            }.`
          : `Mode ANALYSIS (3 capes): la IA analitza cada barra amb EMA200/ADX (capa tendència), RSI/Volum/Rang (capa context) i MACD/RSI/VolRel (capa trigger). Només entra si el veredicte és BUY i la probabilitat supera el mínim configurat. ${
              selected.config.useMarketFilter
                ? "Filtre de mercat actiu: no s'obre cap posició si el preu és per sota de l'EMA(200) diari del símbol (protecció contra mercats bajistes)."
                : "Filtre de mercat inactiu: s'admet entrada en qualsevol condició de mercat."
            }`;

      // ── Build exit mode description ───────────────────────────────────
      const p = { ...selected.config, ...item.params } as unknown as Record<string, number>;
      const exitDesc: Record<string, string> = {
        TRAILING:
          `Mode TRAILING STOP: SL inicial a ${p.slAtr?.toFixed(1)}×ATR per sota de l'entrada. ` +
          `TP fix a ${p.tpAtr?.toFixed(1)}×ATR. Quan el preu puja ${p.trailActivateAtr?.toFixed(1)}×ATR s'activa el trailing: ` +
          `el SL segueix el màxim a ${p.trailDistanceAtr?.toFixed(1)}×ATR de distància. ` +
          `Timeout: màxim ${p.maxHoldingBars} barres. ` +
          `Objectiu: capturar tendències mitjanes amb protecció de guanys progressiva. Risc inicial controlat, benefici il·limitat fins al TP.`,
        BREAK_EVEN:
          `Mode BREAK-EVEN: SL inicial a ${p.slAtr?.toFixed(1)}×ATR per sota de l'entrada. ` +
          `TP fix a ${p.tpAtr?.toFixed(1)}×ATR. Quan el preu puja ${p.breakEvenAtr?.toFixed(1)}×ATR s'activa el Break Even: ` +
          `el SL es mou al preu d'entrada (risc 0). A partir d'aquí l'operació no pot perdre. ` +
          `Timeout: màxim ${p.maxHoldingBars} barres. ` +
          `Objectiu: eliminar el risc un cop el mercat confirma el moviment. Moltes operacions tancades sense P&L.`,
        LET_RUN:
          `Mode LET THE WINNERS RUN: SL inicial a ${p.slAtr?.toFixed(1)}×ATR. Sense TP fix. ` +
          `Quan el preu puja ${p.breakEvenAtr?.toFixed(1)}×ATR s'activa el trailing: ` +
          `SL es mou a l'entrada i queda a ${p.trailDistanceAtr?.toFixed(1)}×ATR del màxim assolit. ` +
          `Timeout: màxim ${p.maxHoldingBars} barres. ` +
          `Objectiu: capturar tendències llargues sense cap límit de guany. Win rate baix, guanys grans en els encerts.`,
        MOON:
          `Mode TO THE MOON: SL inicial al ${p.moonSlPct?.toFixed(0)}% per sota de l'entrada (SL ampli). ` +
          `Quan el preu arriba a ${p.moonPartialAt?.toFixed(1)}× l'entrada es ven el ${p.moonPartialPct?.toFixed(0)}% de la posició (parcial). ` +
          `El ${100 - (p.moonPartialPct ?? 50)}% restant (moon bag) queda amb trailing del ${p.moonTrailPct?.toFixed(0)}% del màxim. ` +
          `Timeout: màxim ${p.maxHoldingBars} barres. ` +
          `Objectiu: assegurar guanys moderats en el parcial i deixar córrer el moon bag per capturar moviments explossius.`,
      };

      // ── Build capital sizing description ──────────────────────────────
      const capDesc: Record<string, string> = {
        FIXED:         `FIXED: cada trade usa ${selected.config.capitalFixed ?? "?"} USDC fixos.`,
        PCT:           `PCT: cada trade usa el ${selected.config.capitalPct ?? "?"}% del capital disponible en aquell moment.`,
        RISK_PCT:      `RISK_PCT: cada trade arrisca el ${selected.config.riskPct ?? "?"}% del capital (la mida s'adapta al SL).`,
        ANTI_MARTINGALE: `ANTI-MARTINGALA: base del ${selected.config.amBasePct ?? 60}% del capital. Redueix la mida un 50% per cada dues pèrdues consecutives. Recupera la mida base quan hi ha un guany.`,
      };

      // ── Optimized params (only relevant ones, with human-readable label) ─
      const optimizedParamsClean: Record<string, { value: unknown; label: string; unit: string }> = {};
      for (const def of allDefs_) {
        const k = String(def.key);
        const v = (item.params as Record<string, number>)[k];
        if (v !== undefined) {
          optimizedParamsClean[k] = { value: v, label: def.label, unit: def.fmt(v) };
        }
      }

      // ── Effective config (only fields relevant to the active mode) ────
      const relevantFields = new Set<string>([
        "symbols", "interval", "initialCapital", "capitalMode", "exitMode", "entryMode",
        "useMarketFilter", "maxHoldingBars",
        ...allDefs_.map(d => String(d.key)),
      ]);
      if (capMode_ === "FIXED")           relevantFields.add("capitalFixed");
      if (capMode_ === "PCT")             relevantFields.add("capitalPct");
      if (capMode_ === "RISK_PCT")        relevantFields.add("riskPct");
      if (capMode_ === "ANTI_MARTINGALE") relevantFields.add("amBasePct");
      if (entryMode_ === "PUMP")          relevantFields.add("pumpVolMin");
      if (entryMode_ === "CANDLES")       { relevantFields.add("candlePatterns"); relevantFields.add("candlePatternScore"); }

      const effectiveConfig: Record<string, unknown> = {};
      const merged = { ...selected.config, ...item.params } as unknown as Record<string, unknown>;
      for (const k of relevantFields) {
        if (merged[k] !== undefined) effectiveConfig[k] = merged[k];
      }

      // ── Run simulations ───────────────────────────────────────────────
      const af = parseDate(aFrom), at = parseDate(aTo);
      const analysisRun = await runWith(item.params, af, at);

      let backtestRun: RunResult | null = null;
      const bf = parseDate(bFrom), bt = parseDate(bTo);
      if (!isNaN(bf) && !isNaN(bt) && bf < bt) {
        backtestRun = await runWith(item.params, bf, bt);
      }

      // ── Assemble report ───────────────────────────────────────────────
      const report = {
        _description:
          "Informe d'optimització de l'Equalitzador per a IA. " +
          "Conté: (1) descripció detallada de l'estratègia i els seus paràmetres; " +
          "(2) estadístiques in-sample (periode d'anàlisi, usades per l'optimització); " +
          "(3) estadístiques out-of-sample (backtest, validen la generalització); " +
          "(4) totes les operacions de cada periode per analitzar patrons. " +
          "Els camps 'result' de cada trade poden ser: TP (objectiu assolit), SL (stop de pèrdues inicial), " +
          "TRAILING_SL (stop mòbil), BREAK_EVEN (tancament al preu d'entrada), LET_RUN_SL (trailing LET_RUN), " +
          "TIMEOUT (màxim de barres esgotat), MOON_SL/MOON_PARTIAL_SL/MOON_PARTIAL_TIMEOUT/MOON_TIMEOUT (mode Moon).",

        generatedAt:      new Date().toISOString(),
        simulationName:   selected.name,
        symbols:          selected.config.symbols,
        interval:         interval_,
        initialCapital:   capital_,

        strategy: {
          exitMode:    exitMode_,
          entryMode:   entryMode_,
          capitalMode: capMode_,
          entryDescription:   entryDesc,
          exitDescription:    exitDesc[exitMode_] ?? exitMode_,
          capitalDescription: capDesc[capMode_]   ?? capMode_,
          expectedBehavior:
            exitMode_ === "TRAILING"
              ? "Win rate moderat (40-60%). Trades amb TP clar i pèrdues controlades. La corba equity hauria de créixer de forma suau i continua sense grans drawdowns."
              : exitMode_ === "BREAK_EVEN"
              ? "Win rate baix en guanys clars (arribar al TP), però molts trades tancats sense pèrdua al Break Even. Drawdown molt controlat. Profit Factor clau: ha de ser > 1.5."
              : exitMode_ === "LET_RUN"
              ? "Win rate baix (20-40%) amb guanys molt asimètrics: les pèrdues són petites, els guanys poden ser molt grans. Drawdowns temporals elevats fins que apareix un moviment fort. Profit Factor és l'indicador crític."
              : exitMode_ === "MOON"
              ? "Dues fases independents: el parcial assegura un retorn base, el moon bag juga sense risc addicional. Win rate baix però impacte alt quan encerta. Analitza moonPartialHits per saber quantes operacions van arribar al parcial."
              : "",
        },

        optimizationMethod: {
          algorithm:       "Biased Gaussian Search (adaptatiu)",
          explorationRatio: "30% iteracions exploració uniforme, 70% refinament Gaussià",
          center:          "Mitjana ponderada per rang dels top-5 resultats acumulats",
          sigmaDecay:      "sigma inicial = 35% del rang → decau exponencialment fins ~3% al final",
          metric:          metric,
          totalIterations: iterations,
        },

        optimizedParams: optimizedParamsClean,
        effectiveConfig,

        analysisStats: {
          _description:
            `Periode IN-SAMPLE (${aFrom} → ${aTo}). ` +
            `Dades usades per guiar l'optimització. ` +
            `Un bon resultat aquí no garanteix generalització: compara sempre amb el backtest.`,
          period:        { from: aFrom, to: aTo },
          totalTrades:   analysisRun.stats.totalTrades,
          wins:          analysisRun.stats.wins,
          losses:        analysisRun.stats.losses,
          winRate:       `${analysisRun.stats.winRate.toFixed(1)}%`,
          totalPnl:      `${analysisRun.stats.totalPnlPct >= 0 ? "+" : ""}${analysisRun.stats.totalPnlPct.toFixed(2)}% (${analysisRun.stats.totalPnl.toFixed(2)} USDC)`,
          maxDrawdown:   `-${analysisRun.stats.maxDrawdown.toFixed(2)}%`,
          profitFactor:  analysisRun.stats.profitFactor.toFixed(3),
          avgWin:        `${analysisRun.stats.avgWin.toFixed(2)} USDC`,
          avgLoss:       `${analysisRun.stats.avgLoss.toFixed(2)} USDC`,
          finalCapital:  `${analysisRun.stats.finalCapital.toFixed(2)} USDC`,
          totalCommission: `${analysisRun.stats.totalCommission.toFixed(2)} USDC`,
          ...(analysisRun.stats.moonPartialHits !== undefined
            ? { moonPartialHits: analysisRun.stats.moonPartialHits }
            : {}),
        },

        analysisTrades: {
          _description:
            "Totes les operacions del periode d'anàlisi. " +
            "Cada trade inclou: símbol, entrada/sortida (ISO 8601), preus, motiu de tancament (result), " +
            "P&L en USDC i en %, capital resultant, comissió, i si el trailing / break-even s'havia activat.",
          count: analysisRun.trades?.length ?? 0,
          trades: (analysisRun.trades ?? []).map(t => ({
            symbol:             t.symbol,
            entryTime:          new Date(t.entryTime).toISOString(),
            exitTime:           new Date(t.exitTime).toISOString(),
            entryPrice:         t.entryPrice,
            exitPrice:          t.exitPrice,
            result:             t.result,
            pnlUsdt:            +t.pnlUsdt.toFixed(4),
            pnlPct:             +t.pnlPct.toFixed(3),
            capitalAfter:       +t.capitalAfter.toFixed(4),
            commission:         +t.commission.toFixed(4),
            trailActivated:     t.trailActive,
            breakEvenActivated: t.breakEvenActivated,
            ...(t.partialExitPrice !== undefined ? { partialExitPrice: t.partialExitPrice } : {}),
            ...(t.partialExitPnl   !== undefined ? { partialExitPnl:   +t.partialExitPnl.toFixed(4) } : {}),
          })),
        },

        ...(backtestRun ? {
          backtestStats: {
            _description:
              `Periode OUT-OF-SAMPLE (${bFrom} → ${bTo}). ` +
              `Dades no vistes durant l'optimització. ` +
              `Si el resultat és similar a l'anàlisi, l'estratègia generalitza bé. ` +
              `Una degradació > 30% en P&L o Profit Factor pot indicar overfitting.`,
            period:       { from: bFrom, to: bTo },
            totalTrades:  backtestRun.stats.totalTrades,
            wins:         backtestRun.stats.wins,
            losses:       backtestRun.stats.losses,
            winRate:      `${backtestRun.stats.winRate.toFixed(1)}%`,
            totalPnl:     `${backtestRun.stats.totalPnlPct >= 0 ? "+" : ""}${backtestRun.stats.totalPnlPct.toFixed(2)}% (${backtestRun.stats.totalPnl.toFixed(2)} USDC)`,
            maxDrawdown:  `-${backtestRun.stats.maxDrawdown.toFixed(2)}%`,
            profitFactor: backtestRun.stats.profitFactor.toFixed(3),
            avgWin:       `${backtestRun.stats.avgWin.toFixed(2)} USDC`,
            avgLoss:      `${backtestRun.stats.avgLoss.toFixed(2)} USDC`,
            finalCapital: `${backtestRun.stats.finalCapital.toFixed(2)} USDC`,
            totalCommission: `${backtestRun.stats.totalCommission.toFixed(2)} USDC`,
            ...(backtestRun.stats.moonPartialHits !== undefined
              ? { moonPartialHits: backtestRun.stats.moonPartialHits }
              : {}),
          },
          backtestTrades: {
            _description: "Totes les operacions del periode de backtest.",
            count: backtestRun.trades?.length ?? 0,
            trades: (backtestRun.trades ?? []).map(t => ({
              symbol:             t.symbol,
              entryTime:          new Date(t.entryTime).toISOString(),
              exitTime:           new Date(t.exitTime).toISOString(),
              entryPrice:         t.entryPrice,
              exitPrice:          t.exitPrice,
              result:             t.result,
              pnlUsdt:            +t.pnlUsdt.toFixed(4),
              pnlPct:             +t.pnlPct.toFixed(3),
              capitalAfter:       +t.capitalAfter.toFixed(4),
              commission:         +t.commission.toFixed(4),
              trailActivated:     t.trailActive,
              breakEvenActivated: t.breakEvenActivated,
              ...(t.partialExitPrice !== undefined ? { partialExitPrice: t.partialExitPrice } : {}),
              ...(t.partialExitPnl   !== undefined ? { partialExitPnl:   +t.partialExitPnl.toFixed(4) } : {}),
            })),
          },
        } : {}),
      };

      const fname = `eq_report_${selected.name.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.json`;
      downloadJSON(report, fname);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingReport(null);
    }
  }, [selected, aFrom, aTo, bFrom, bTo, metric, iterations, runWith]);

  const handleSaveBot = useCallback(async (item: IterResult) => {
    if (!selected) return;
    setSavingBot(item.id);
    setSavedBotMsg(null);
    try {
      const exitMode  = String(selected.config.exitMode  ?? "TRAILING");
      const entryMode = String(selected.config.entryMode ?? "ANALYSIS");
      const interval  = String(selected.config.interval  ?? "?");
      const symbols   = (selected.config.symbols ?? []).join(", ");
      const capital   = Number(selected.config.initialCapital ?? 1000);

      const mergedConfig = { ...selected.config, ...item.params };

      // Build param description lines
      const baseDefs_ = PARAM_DEFS[exitMode] ?? P_TRAILING;
      const allDefs_  = entryMode === "PUMP" ? [P_PUMP_VOL, ...baseDefs_] : entryMode === "CANDLES" ? [P_CANDLES, ...baseDefs_] : baseDefs_;
      const paramLines = allDefs_.map(def => {
        const v = (item.params as Record<string, number>)[String(def.key)];
        return v !== undefined ? `  - ${def.label}: ${def.fmt(v)}` : null;
      }).filter(Boolean).join("\n");

      const pnlStr   = `${item.stats.totalPnlPct >= 0 ? "+" : ""}${item.stats.totalPnlPct.toFixed(1)}%`;
      const wrStr    = `${item.stats.winRate.toFixed(0)}%`;
      const ddStr    = `-${item.stats.maxDrawdown.toFixed(1)}%`;
      const pfStr    = item.stats.profitFactor.toFixed(2);
      const trStr    = String(item.stats.totalTrades);

      const description = [
        `Simulació optimitzada amb l'Equalitzador adaptatiu.`,
        ``,
        `Mode de sortida: ${exitMode} | Mode d'entrada: ${entryMode}`,
        `Interval: ${interval} | Símbols: ${symbols}`,
        `Capital inicial: ${capital} USDC`,
        ``,
        `Paràmetres optimitzats (periode ${aFrom} → ${aTo}):`,
        paramLines,
        ``,
        `Resultats periode d'anàlisi (${aFrom} → ${aTo}):`,
        `  P&L: ${pnlStr} | Win Rate: ${wrStr} | Drawdown: ${ddStr} | Profit Factor: ${pfStr} | Trades: ${trStr}`,
        ``,
        `Generat el ${new Date().toLocaleDateString("ca-ES", { day: "2-digit", month: "long", year: "numeric" })}.`,
      ].join("\n");

      const name = `${selected.name} [EQ ${new Date().toISOString().slice(0, 10)}]`;

      const res = await fetch("/api/simulation/configs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          config:  mergedConfig,
          pnlPct:  item.stats.totalPnlPct,
          description,
        }),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const d = await res.json() as { name?: string };
      setSavedBotMsg(`Desat: "${d.name ?? name}"`);

      // Refresh configs list
      const r2 = await fetch("/api/simulation/configs");
      const d2 = await r2.json();
      const list = Array.isArray(d2) ? d2 : (d2?.configs ?? []);
      setConfigs(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingBot(null);
    }
  }, [selected, aFrom, aTo]);

  const exitMode       = String(selected?.config.exitMode  ?? "TRAILING");
  const entryMode      = String(selected?.config.entryMode ?? "ANALYSIS");
  const baseDefs       = PARAM_DEFS[exitMode] ?? P_TRAILING;
  const allDefs        = entryMode === "PUMP" ? [P_PUMP_VOL, ...baseDefs] : entryMode === "CANDLES" ? [P_CANDLES, ...baseDefs] : baseDefs;
  const initialCapital = Number(selected?.config.initialCapital) || 1000;

  /* ── Render ─────────────────────────────────────────────────────── */

  const bestResult = results[0] ?? null;

  return (
    <div className="eq-tab">

      {/* ── 5 KPIs ── */}
      <div className="section-title">
        <i className="fa-solid fa-sliders" /> Equalitzador
      </div>
      <div className="portfolio__cards">
        <div className="portfolio__card portfolio__card--blue">
          <span className="portfolio__card-label"><i className="fa-solid fa-database" /> Configuracions</span>
          <span className="portfolio__card-value portfolio__card-value--count">{configs.length}</span>
          <span className="portfolio__card-sub">simulacions disponibles</span>
        </div>
        <div className="portfolio__card portfolio__card--neutral">
          <span className="portfolio__card-label"><i className="fa-solid fa-list-ol" /> Iteracions</span>
          <span className="portfolio__card-value portfolio__card-value--count">{iterations}</span>
          <span className="portfolio__card-sub">iteracions configurades</span>
        </div>
        <div className={`portfolio__card portfolio__card--${running ? "blue" : results.length > 0 ? "green" : "neutral"}`}>
          <span className="portfolio__card-label"><i className="fa-solid fa-rotate" /> Progrés</span>
          <span className="portfolio__card-value">{running ? `${progress}%` : results.length > 0 ? "Complet" : "—"}</span>
          <span className="portfolio__card-sub">{results.length} resultats obtinguts</span>
        </div>
        <div className={`portfolio__card portfolio__card--${bestResult ? (bestResult.stats.totalPnlPct >= 0 ? "green" : "red") : "neutral"}`}>
          <span className="portfolio__card-label"><i className="fa-solid fa-trophy" /> Millor P&amp;L</span>
          <span className="portfolio__card-value mono">
            {bestResult ? `${bestResult.stats.totalPnlPct >= 0 ? "+" : ""}${bestResult.stats.totalPnlPct.toFixed(1)}%` : "—"}
          </span>
          <span className="portfolio__card-sub">{bestResult ? `WR ${bestResult.stats.winRate.toFixed(0)}%` : "sense resultats"}</span>
        </div>
        <div className={`portfolio__card portfolio__card--${valResult ? (valResult.stats.totalPnlPct >= 0 ? "green" : "red") : "neutral"}`}>
          <span className="portfolio__card-label"><i className="fa-solid fa-shield-check" /> Validació</span>
          <span className="portfolio__card-value mono">
            {valResult ? `${valResult.stats.totalPnlPct >= 0 ? "+" : ""}${valResult.stats.totalPnlPct.toFixed(1)}%` : "—"}
          </span>
          <span className="portfolio__card-sub">{valResult ? "període fora-de-mostra" : "no validat"}</span>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          FILA 1 — 3 columnes: selecció | paràmetres | rangs
      ══════════════════════════════════════════════════════════════ */}
      <div className="eq-row1">

        {/* Col 1 — Selecció de la simulació */}
        <div className="eq-col eq-col-sim">
          <div className="section-title">
            <i className="fa-solid fa-database" /> Simulació base
            <span className="section-title__right">
              {selected && (
                <span style={{ fontSize: "0.65rem", color: "var(--accent)", marginRight: "0.5rem" }}>
                  <i className="fa-solid fa-circle-check" /> {selected.name}
                </span>
              )}
              {running ? (
                <button className="btn-danger btn-sm" onClick={handleAbort}>
                  <i className="fa-solid fa-stop" /> Aturar
                </button>
              ) : (
                <>
                  <button
                    className="btn-secondary btn-sm"
                    onClick={handleWarmup}
                    disabled={!selected || warming}
                    title="Descarrega candles a SQLite per accelerar les simulacions"
                    style={{ marginRight: "0.35rem" }}
                  >
                    {warming
                      ? <><i className="fa-solid fa-spinner fa-spin" /> Escalfant…</>
                      : <><i className="fa-solid fa-fire-flame-curved" /> Cache</>}
                  </button>
                  <button
                    className="btn-primary btn-sm"
                    onClick={handleSearch}
                    disabled={!selected}
                    title={!selected ? "Selecciona una simulació base primer" : "Iniciar optimització"}
                  >
                    <i className="fa-solid fa-play" /> Executar
                  </button>
                </>
              )}
            </span>
          </div>
          {configs.length === 0
            ? <div className="eq-col-empty dim">Sense simulacions guardades</div>
            : (
              <div className="eq-sim-list">
                {configs.map(cfg => {
                  const active = selected?.id === cfg.id;
                  const syms   = (cfg.config.symbols ?? []).map((s: string) => s.replace(/USDT$/i, ""));
                  const shown  = syms.slice(0, 4);
                  const extra  = syms.length - shown.length;
                  return (
                    <div key={cfg.id}
                      className={`eq-sim-card${active ? " eq-sim-card--active" : ""}`}
                      onClick={() => selectConfig(cfg)}>

                      {/* Fila 1 — Nom */}
                      <div className="eq-sim-card__name">{cfg.name}</div>

                      {/* Fila 2 — Descripció */}
                      <div className="eq-sim-card__desc">
                        <span className="eq-sim-tag eq-sim-tag--exit">
                          {cfg.config.exitMode ?? "—"}
                        </span>
                        <span className="eq-sim-tag eq-sim-tag--entry">
                          {cfg.config.entryMode ?? "—"}
                        </span>
                        <span className="eq-sim-tag eq-sim-tag--tf">
                          {cfg.config.interval ?? "—"}
                        </span>
                        {shown.length > 0 && (
                          <span className="eq-sim-syms dim">
                            {shown.join(" · ")}{extra > 0 ? ` +${extra}` : ""}
                          </span>
                        )}
                      </div>

                      {/* Fila 3 — Dades tabulars */}
                      <div className="eq-sim-card__stats">
                        <div className="eq-sim-kv">
                          <span className="eq-sim-kv__l">P&amp;L</span>
                          <span className="eq-sim-kv__v mono"
                            style={{ color: (cfg.pnlPct ?? 0) >= 0 ? "var(--green)" : "var(--red)" }}>
                            {cfg.pnlPct !== undefined
                              ? `${(cfg.pnlPct ?? 0) >= 0 ? "+" : ""}${cfg.pnlPct?.toFixed(1)}%`
                              : "—"}
                          </span>
                        </div>
                        <div className="eq-sim-kv">
                          <span className="eq-sim-kv__l">Període</span>
                          <span className="eq-sim-kv__v mono dim">
                            {fmtDate(cfg.config.from) || "—"}&nbsp;→&nbsp;{fmtDate(cfg.config.to) || "—"}
                          </span>
                        </div>
                        <div className="eq-sim-kv">
                          <span className="eq-sim-kv__l">Capital</span>
                          <span className="eq-sim-kv__v mono dim">
                            {cfg.config.initialCapital ?? "—"} USDC
                          </span>
                        </div>
                        <div className="eq-sim-kv">
                          <span className="eq-sim-kv__l">Guardat</span>
                          <span className="eq-sim-kv__v dim">{fmtSavedAt(cfg.savedAt)}</span>
                        </div>
                      </div>

                      {/* Botó executar */}
                      <div className="eq-sim-card__actions">
                        <button
                          className="btn-primary btn-sm"
                          onClick={e => { e.stopPropagation(); handleRunConfig(cfg); }}
                          disabled={running}
                          title="Seleccionar i executar optimització"
                        >
                          <i className="fa-solid fa-play" /> Executar
                        </button>
                      </div>

                    </div>
                  );
                })}
              </div>
            )}
        </div>

        {/* Col 2 — Paràmetres + Rangs de cerca (bloc únic) */}
        <div className="eq-col eq-col-config">
          <div className="section-title">
            <i className="fa-solid fa-sliders" /> Paràmetres i rangs de cerca
            {selected && (
              <span className="section-title__right" style={{ fontSize: "0.65rem" }}>
                {exitMode} · {entryMode}
              </span>
            )}
          </div>

          {!selected
            ? <div className="eq-col-empty dim">Selecciona una simulació</div>
            : (
              <div className="eq-config-body">

                {/* Left: controls */}
                <div className="eq-config-controls">
                  <div className="eq-period-block">
                    <span className="eq-period-block__label">
                      <i className="fa-solid fa-flask" /> Anàlisi
                    </span>
                    <div className="eq-period-block__dates">
                      <label>Des de
                        <input type="date" value={aFrom} onChange={e => setAFrom(e.target.value)} className="eq-date" />
                      </label>
                      <label>Fins a
                        <input type="date" value={aTo} onChange={e => setATo(e.target.value)} className="eq-date" />
                      </label>
                    </div>
                  </div>

                  <div className="eq-period-block">
                    <span className="eq-period-block__label">
                      <i className="fa-solid fa-vial-circle-check" /> Backtest
                    </span>
                    <div className="eq-period-block__dates">
                      <label>Des de
                        <input type="date" value={bFrom} onChange={e => setBFrom(e.target.value)} className="eq-date" />
                      </label>
                      <label>Fins a
                        <input type="date" value={bTo} onChange={e => setBTo(e.target.value)} className="eq-date" />
                      </label>
                    </div>
                  </div>

                  <div className="eq-run-controls">
                    <label className="eq-iter-label">
                      Iteracions
                      <input type="number" min={5} max={500} step={5} value={iterations}
                        onChange={e => setIterations(parseInt(e.target.value) || 30)}
                        className="eq-iter-input" />
                    </label>
                    <label className="eq-iter-label">
                      Mètrica
                      <select value={metric} onChange={e => setMetric(e.target.value as OptMetric)}
                        className="eq-metric-select">
                        {METRIC_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                      </select>
                    </label>
                  </div>

                  {/* Sweep de probabilitat — només ANALYSIS */}
                  {entryMode === "ANALYSIS" && (
                    <div className="eq-prob-sweep">
                      <label className="eq-prob-sweep__toggle">
                        <input type="checkbox" checked={probSweep}
                          onChange={e => setProbSweep(e.target.checked)} />
                        <span>Sweep probabilitat mínima</span>
                        {probSweep && probValues.length > 1 && (
                          <span className="dim" style={{ fontSize: "0.65rem" }}>
                            · {probValues.length} blocs × {iterations} iter = {probValues.length * iterations} total
                          </span>
                        )}
                      </label>
                      {probSweep && (
                        <div className="eq-prob-sweep__values">
                          {[20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90].map(v => (
                            <label key={v} className="eq-prob-chip">
                              <input type="checkbox"
                                checked={probValues.includes(v)}
                                onChange={e => setProbValues(prev =>
                                  e.target.checked ? [...prev, v].sort((a, b) => a - b) : prev.filter(x => x !== v)
                                )} />
                              {v}%
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="eq-actions">
                    {!running ? (
                      <button className="btn-primary btn-sm" onClick={handleSearch}>
                        <i className="fa-solid fa-magnifying-glass-chart" /> Cercar
                      </button>
                    ) : (
                      <button className="btn-danger btn-sm" onClick={handleAbort}>
                        <i className="fa-solid fa-stop" /> Aturar
                      </button>
                    )}
                    {results.length > 0 && !running && (
                      <button className="btn-ghost btn-sm" onClick={narrowRanges}
                        title="Afina els rangs al voltant del millor resultat">
                        <i className="fa-solid fa-compress" /> Affinar
                      </button>
                    )}
                  </div>

                  {error && (
                    <div className="eq-error">
                      <i className="fa-solid fa-circle-exclamation" /> {error}
                    </div>
                  )}
                </div>

                {/* Divider */}
                <div className="eq-config-divider" />

                {/* Right: range bars */}
                <div className="eq-ranges-body">
                  {allDefs.map(def => {
                    const key = String(def.key);
                    const r   = ranges[key] ?? { lo: def.min, hi: def.max };
                    const pLo = (r.lo - def.min) / (def.max - def.min || 1);
                    const pHi = (r.hi - def.min) / (def.max - def.min || 1);
                    return (
                      <div key={key} className="eq-rbar-row">
                        <span className="eq-rbar-label">
                          {def.label}
                          <i className="fa-solid fa-circle-info eq-tip-icon" title={def.tip} />
                        </span>
                        <div className="eq-rbar-track">
                          <div className="eq-rbar-fill"
                            style={{ left: `${pLo * 100}%`, width: `${(pHi - pLo) * 100}%` }} />
                          <div className="eq-rbar-handle eq-rbar-handle--lo"
                            style={{ left: `${pLo * 100}%` }} />
                          <div className="eq-rbar-handle eq-rbar-handle--hi"
                            style={{ left: `${pHi * 100}%` }} />
                        </div>
                        <div className="eq-rbar-inputs">
                          <input type="number" className="eq-range-input"
                            min={def.min} max={r.hi} step={def.step} value={r.lo}
                            onChange={e => setRanges(prev => ({
                              ...prev, [key]: { ...r, lo: parseFloat(e.target.value) || def.min }
                            }))} />
                          <span className="dim" style={{ fontSize: "0.65rem" }}>–</span>
                          <input type="number" className="eq-range-input"
                            min={r.lo} max={def.max} step={def.step} value={r.hi}
                            onChange={e => setRanges(prev => ({
                              ...prev, [key]: { ...r, hi: parseFloat(e.target.value) || def.max }
                            }))} />
                        </div>
                        <span className="eq-rbar-hint dim">
                          {def.fmt(r.lo)}–{def.fmt(r.hi)}
                        </span>
                      </div>
                    );
                  })}
                </div>

              </div>
            )}
        </div>
      </div>

      {/* ── Bot save feedback ── */}
      {savedBotMsg && (
        <div className="eq-saved-msg">
          <i className="fa-solid fa-circle-check" /> {savedBotMsg}
          <button className="eq-saved-msg__close" onClick={() => setSavedBotMsg(null)}>×</button>
        </div>
      )}

      {/* ── Progress bar ── */}
      {(running || progress > 0) && (
        <div className="eq-progress-wrap">
          <div className="eq-progress-bar" style={{ width: `${progress}%` }} />
          <span className="eq-progress-label">
            {running
              ? `Executant… ${progress}%${probSweep && probValues.length > 1 ? ` · ${probValues.length} blocs de probabilitat` : ""}`
              : `Completat`}
            {errCount > 0 && (
              <span className="eq-progress-errors" title={lastErrMsg ?? undefined}>
                {" "}· <i className="fa-solid fa-triangle-exclamation" /> {errCount} error{errCount !== 1 ? "s" : ""}
              </span>
            )}
          </span>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════
          FILA 2 — 50/50: iteracions | corbes equity
      ══════════════════════════════════════════════════════════════ */}
      <div className="eq-row2">

        {/* Col esquerra — Iteracions completades */}
        <div className="eq-col2 eq-col2-results">
          <div className="section-title">
            <i className="fa-solid fa-trophy" /> Iteracions
            {results.length > 0 && (
              <span className="nav__badge" style={{ marginLeft: "0.3rem" }}>{results.length}</span>
            )}
            {results.length > 0 && (
              <span className="section-title__right" style={{ fontSize: "0.65rem" }}>
                {METRIC_OPTIONS.find(o => o.key === metric)?.label}
              </span>
            )}
          </div>

          {results.length === 0
            ? (
              <div className="eq-col-empty dim">
                {running
                  ? <><i className="fa-solid fa-spinner fa-spin" /> Executant iteracions…</>
                  : "Cap resultat encara"}
              </div>
            )
            : (
              <div className="eq-results-table-wrap">
                <table className="eq-results-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      {probSweep && entryMode === "ANALYSIS" && <th>Prob</th>}
                      {allDefs.map(d => <th key={String(d.key)}>{d.label}</th>)}
                      <th>P&amp;L%</th>
                      <th>WR%</th>
                      <th>DD%</th>
                      <th>PF</th>
                      <th>Trades</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r, i) => {
                      const isActive = picked?.id === r.id;
                      return (
                        <tr key={r.id} className={isActive ? "eq-row--active" : ""}
                          onClick={() => setPicked(r)}>
                          <td className="dim">{i + 1}</td>
                          {probSweep && entryMode === "ANALYSIS" && (
                            <td className="mono" style={{ color: "var(--accent)" }}>
                              {r.minProbability !== undefined ? `${r.minProbability}%` : "—"}
                            </td>
                          )}
                          {allDefs.map(def => (
                            <td key={String(def.key)} className="mono">
                              {def.fmt((r.params as Record<string, number>)[String(def.key)] ?? 0)}
                            </td>
                          ))}
                          <td className="mono" style={{ color: pnlColor(r.stats.totalPnlPct) }}>
                            {r.stats.totalPnlPct >= 0 ? "+" : ""}{r.stats.totalPnlPct.toFixed(1)}
                          </td>
                          <td className="mono">{r.stats.winRate.toFixed(0)}</td>
                          <td className="mono" style={{ color: "var(--red)" }}>
                            -{r.stats.maxDrawdown.toFixed(1)}
                          </td>
                          <td className="mono">{r.stats.profitFactor.toFixed(2)}</td>
                          <td className="mono dim">{r.stats.totalTrades}</td>
                          <td className="eq-row-actions">
                            <button
                              className={`btn btn-xs ${isActive ? "btn-primary" : "btn-ghost"}`}
                              onClick={e => { e.stopPropagation(); handleValidate(r); }}
                              disabled={validating}
                              title="Valida al periode de backtest">
                              {isActive && validating
                                ? <i className="fa-solid fa-spinner fa-spin" />
                                : <i className="fa-solid fa-vial-circle-check" />}
                            </button>
                            <button
                              className="btn btn-ghost btn-xs"
                              onClick={e => { e.stopPropagation(); handleSaveReport(r); }}
                              disabled={savingReport !== null}
                              title="Exporta informe per IA (JSON autoexplicatiu amb totes les operacions i estadístiques)">
                              {savingReport === r.id
                                ? <i className="fa-solid fa-spinner fa-spin" />
                                : <i className="fa-solid fa-file-export" />}
                            </button>
                            <button
                              className="btn btn-ghost btn-xs"
                              onClick={e => { e.stopPropagation(); handleSaveBot(r); }}
                              disabled={savingBot !== null}
                              title="Guarda la simulació per usar-la al Bot">
                              {savingBot === r.id
                                ? <i className="fa-solid fa-spinner fa-spin" />
                                : <i className="fa-solid fa-robot" />}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
        </div>

        {/* Col dreta — Corbes equity */}
        <div className="eq-col2 eq-col2-equity">
          <div className="section-title">
            <i className="fa-solid fa-chart-line" /> Corbes equity
            {results.length > 0 && (
              <span className="section-title__right" style={{ fontSize: "0.65rem" }}>
                {results.filter(r => r.equityCurve?.length > 1).length} sèries
              </span>
            )}
          </div>

          {results.length === 0
            ? (
              <div className="eq-col-empty dim">
                {running
                  ? <><i className="fa-solid fa-spinner fa-spin" /> Generant corbes…</>
                  : "Cap corba encara"}
              </div>
            )
            : (
              <div className="eq-overlay-body">
                <OverlayChart results={results} picked={picked} initialCapital={initialCapital} />

                {/* Validation result inline */}
                {picked && (
                  <div className="eq-val-inline">
                    <div className="eq-val-inline__head">
                      <span className="eq-val-inline__title">
                        <i className="fa-solid fa-vial-circle-check" /> Validació backtest
                        <span className="dim"> {bFrom} → {bTo}</span>
                      </span>
                      {valResult && (
                        <span className={`eq-val-inline__pnl ${valResult.stats.totalPnl >= 0 ? "up" : "dn"}`}>
                          {valResult.stats.totalPnlPct >= 0 ? "+" : ""}{valResult.stats.totalPnlPct.toFixed(1)}%
                        </span>
                      )}
                    </div>
                    {validating && (
                      <div className="eq-chart-empty">
                        <i className="fa-solid fa-spinner fa-spin" /> Executant…
                      </div>
                    )}
                    {valResult && !validating && (<>
                      <MiniChart curve={valResult.equityCurve} initial={initialCapital} />
                      <div className="eq-stat-grid">
                        <div className="eq-stat">
                          <span className="eq-stat__l">Win rate</span>
                          <span className="eq-stat__v mono">{valResult.stats.winRate.toFixed(0)}%</span>
                        </div>
                        <div className="eq-stat">
                          <span className="eq-stat__l">Drawdown</span>
                          <span className="eq-stat__v mono" style={{ color: "var(--red)" }}>
                            -{valResult.stats.maxDrawdown.toFixed(1)}%
                          </span>
                        </div>
                        <div className="eq-stat">
                          <span className="eq-stat__l">Profit F.</span>
                          <span className="eq-stat__v mono">{valResult.stats.profitFactor.toFixed(2)}</span>
                        </div>
                        <div className="eq-stat">
                          <span className="eq-stat__l">Trades</span>
                          <span className="eq-stat__v mono">{valResult.stats.totalTrades}</span>
                        </div>
                      </div>
                    </>)}
                    {!valResult && !validating && (
                      <div className="eq-chart-empty dim">
                        Clica <i className="fa-solid fa-vial-circle-check" /> per validar
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
        </div>
      </div>

    </div>
  );
}
