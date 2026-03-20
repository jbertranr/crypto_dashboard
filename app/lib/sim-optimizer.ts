/**
 * sim-optimizer.ts
 * Shared types, parameter definitions, and adaptive sampler used by
 * EqualizerTab and AutoLabTab.
 */

import type { SimConfig, SimStats } from "../api/simulation/run/route";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ParamDef {
  key:   keyof SimConfig;
  label: string;
  min:   number; max: number; step: number;
  fmt:   (v: number) => string;
  tip:   string;
}

export interface ParamRange { lo: number; hi: number; }
export type ParamRanges = Partial<Record<string, ParamRange>>;
export type OptMetric   = "pnlPct" | "profitFactor" | "winRate" | "score";

// ── Parameter definitions per exit mode ───────────────────────────────────────

export const P_TRAILING: ParamDef[] = [
  { key: "slAtr",            label: "SL",      min: 0.3, max: 3.0,  step: 0.1, fmt: v => `${v.toFixed(1)}×`,
    tip: "Stop Loss en múltiples d'ATR." },
  { key: "tpAtr",            label: "TP",       min: 0.5, max: 6.0,  step: 0.1, fmt: v => `${v.toFixed(1)}×`,
    tip: "Take Profit en múltiples d'ATR." },
  { key: "trailActivateAtr", label: "Trail↑",  min: 0.3, max: 4.0,  step: 0.1, fmt: v => `${v.toFixed(1)}×`,
    tip: "ATR per activar el trailing stop." },
  { key: "trailDistanceAtr", label: "Trail↔",  min: 0.3, max: 4.0,  step: 0.1, fmt: v => `${v.toFixed(1)}×`,
    tip: "Distància del trailing al màxim." },
  { key: "maxHoldingBars",   label: "Timeout", min: 4,   max: 100,  step: 2,   fmt: v => `${v}b`,
    tip: "Barres màximes obertes." },
];

export const P_BREAK_EVEN: ParamDef[] = [
  { key: "slAtr",          label: "SL",      min: 0.3, max: 3.0, step: 0.1, fmt: v => `${v.toFixed(1)}×`,
    tip: "Stop Loss inicial en múltiples d'ATR." },
  { key: "tpAtr",          label: "TP",      min: 0.5, max: 6.0, step: 0.1, fmt: v => `${v.toFixed(1)}×`,
    tip: "Take Profit en múltiples d'ATR." },
  { key: "breakEvenAtr",   label: "B/E",     min: 0.3, max: 3.0, step: 0.1, fmt: v => `${v.toFixed(1)}×`,
    tip: "ATR per activar el Break Even." },
  { key: "maxHoldingBars", label: "Timeout", min: 4,   max: 100, step: 2,   fmt: v => `${v}b`,
    tip: "Barres màximes obertes." },
];

export const P_LET_RUN: ParamDef[] = [
  { key: "slAtr",            label: "SL",      min: 0.3, max: 3.0, step: 0.1, fmt: v => `${v.toFixed(1)}×`,
    tip: "Stop Loss inicial en múltiples d'ATR." },
  { key: "breakEvenAtr",     label: "B/E",     min: 0.3, max: 3.0, step: 0.1, fmt: v => `${v.toFixed(1)}×`,
    tip: "ATR per activar el Break Even." },
  { key: "trailDistanceAtr", label: "Trail↔",  min: 0.3, max: 5.0, step: 0.1, fmt: v => `${v.toFixed(1)}×`,
    tip: "Distància del trailing al màxim." },
  { key: "maxHoldingBars",   label: "Timeout", min: 4,   max: 300, step: 5,   fmt: v => `${v}b`,
    tip: "Barres màximes obertes." },
];

export const P_MOON: ParamDef[] = [
  { key: "moonSlPct",      label: "SL%",     min: 3,   max: 40,   step: 1,    fmt: v => `${v}%`,
    tip: "Stop Loss en % del preu d'entrada." },
  { key: "moonPartialAt",  label: "Parcial", min: 1.1, max: 3.0,  step: 0.05, fmt: v => `${v.toFixed(2)}×`,
    tip: "Multiplicador per vendre la posició parcial." },
  { key: "moonPartialPct", label: "Venda%",  min: 25,  max: 75,   step: 5,    fmt: v => `${v}%`,
    tip: "% de la posició a vendre en el parcial." },
  { key: "moonTrailPct",   label: "Trail%",  min: 3,   max: 30,   step: 1,    fmt: v => `${v}%`,
    tip: "% de retrocés per tancar el moon bag." },
  { key: "maxHoldingBars", label: "Timeout", min: 50,  max: 1000, step: 25,   fmt: v => `${v}b`,
    tip: "Barres màximes per al moon bag." },
];

export const P_PUMP_VOL: ParamDef =
  { key: "pumpVolMin", label: "Vol×", min: 1.5, max: 10, step: 0.5, fmt: v => `${v.toFixed(1)}×`,
    tip: "Volum mínim en múltiples del volum mitjà." };

export const P_CANDLES: ParamDef =
  { key: "candlePatternScore", label: "Confiança", min: 50, max: 95, step: 5, fmt: v => `${v}%`,
    tip: "Confiança mínima del patró candlestick per activar l'entrada. Valor alt → menys senyals però de més qualitat." };

export const PARAM_DEFS: Record<string, ParamDef[]> = {
  TRAILING: P_TRAILING, BREAK_EVEN: P_BREAK_EVEN, LET_RUN: P_LET_RUN, MOON: P_MOON,
};

// ── Metric helper ──────────────────────────────────────────────────────────────

export function metricValue(stats: SimStats, metric: OptMetric): number {
  if (metric === "pnlPct")       return stats.totalPnlPct;
  if (metric === "profitFactor") return stats.profitFactor;
  if (metric === "winRate")      return stats.winRate;
  return (stats.totalPnlPct * stats.profitFactor) / (stats.maxDrawdown + 1);
}

// ── Adaptive sampler ───────────────────────────────────────────────────────────

export interface AdaptiveSampler {
  history:   { params: Partial<SimConfig>; score: number }[];
  iteration: number;
  total:     number;
}

export function createAdaptiveSampler(total: number): AdaptiveSampler {
  return { history: [], iteration: 0, total };
}

/**
 * Biased Gaussian Sampling:
 *   Phase 1 (first 30% or <3 results): uniform random (exploration)
 *   Phase 2 (rest): Gaussian centred on weighted mean of top-5 results,
 *                   with sigma decaying from 35% to ~8% of range width.
 */
export function adaptiveSample(
  defs:    ParamDef[],
  ranges:  ParamRanges,
  sampler: AdaptiveSampler,
  _metric: OptMetric,
): Partial<SimConfig> {
  const { history, iteration, total } = sampler;
  const isExploring = iteration < Math.ceil(total * 0.30) || history.length < 3;
  const result: Record<string, number> = {};

  for (const def of defs) {
    const key = String(def.key);
    const r   = ranges[key];
    const lo  = r ? Math.max(def.min, r.lo) : def.min;
    const hi  = r ? Math.min(def.max, r.hi) : def.max;
    let raw: number;

    if (isExploring) {
      const steps = Math.max(1, Math.round((hi - lo) / def.step));
      raw = lo + Math.floor(Math.random() * (steps + 1)) * def.step;
    } else {
      const K = Math.min(5, history.length);
      let wSum = 0, wMean = 0;
      history.slice(0, K).forEach((entry, idx) => {
        const w = K - idx;
        const v = (entry.params as Record<string, number>)[key] ?? (lo + hi) / 2;
        wMean += w * v; wSum += w;
      });
      wMean /= wSum;

      const sigma = (hi - lo) * 0.35 * Math.exp(-2.5 * (iteration / total));
      const u1 = Math.random(), u2 = Math.random();
      const z  = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-10))) * Math.cos(2 * Math.PI * u2);
      raw = wMean + sigma * z;
    }

    const clamped = Math.min(hi, Math.max(lo, raw));
    const snapped = lo + Math.round((clamped - lo) / def.step) * def.step;
    result[key]   = parseFloat(Math.min(hi, Math.max(lo, snapped)).toFixed(8));
  }
  return result as Partial<SimConfig>;
}

// ── Categorical sampler ────────────────────────────────────────────────────────

export interface CatDim {
  key:    string;
  values: string[];
}

/**
 * Sample a categorical dimension:
 *   Exploring: uniform random
 *   Refining:  weighted by cumulative score of top results (Laplace smoothing)
 */
export function sampleCategorical(
  dim:         CatDim,
  history:     { cats: Record<string, string>; score: number }[],
  isExploring: boolean,
): string {
  if (isExploring || history.length === 0) {
    return dim.values[Math.floor(Math.random() * dim.values.length)];
  }
  const counts: Record<string, number> =
    Object.fromEntries(dim.values.map(v => [v, 0.1])); // Laplace smoothing
  for (const h of history) {
    const v = h.cats[dim.key];
    if (v !== undefined && counts[v] !== undefined)
      counts[v] += Math.max(0, h.score);
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (const [v, w] of Object.entries(counts)) {
    r -= w;
    if (r <= 0) return v;
  }
  return dim.values[dim.values.length - 1];
}

// ── Default range builder ──────────────────────────────────────────────────────

export function buildDefaultRanges(defs: ParamDef[], baseConfig: Partial<SimConfig>): ParamRanges {
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
}
