"use client";
import { useState, useCallback, useRef, useEffect } from "react";
import type { SimTrade, SimStats, SlMove, LayerScores, ExitMode, EntryMode, CapitalMode } from "../api/simulation/run/route";
import { ALL_CANDLE_PATTERNS } from "../lib/candle-patterns";
import CoinIcon from "./CoinIcon";

// ── Types ──────────────────────────────────────────────────────────────────────
interface EquityPoint { time: number; value: number }

interface SimResult {
  trades:          SimTrade[];
  equityCurve:     EquityPoint[];
  btcCurve:        EquityPoint[];
  stats:           SimStats;
  effectiveConfig: EffectiveConfig;
}

interface SimConfig {
  symbols:          string[];
  interval:         string;
  from:             string;
  to:               string;
  initialCapital:   number;
  useMarketFilter:  boolean;  // IF preu > EMA(200) diari THEN permet entrada
  amBasePct:        number;   // % base del capital (Anti-Martingala)
  capitalMode:      CapitalMode;
  capitalFixed:     number;   // USDT per trade (FIXED)
  capitalPct:       number;   // % del capital per trade (PCT)
  riskPct:          number;   // % del capital a arriscar per trade (RISK_PCT)
  entryMode:        EntryMode;
  pumpVolMin:       number;
  exitMode:         ExitMode;
  tpAtr:            number;
  slAtr:            number;
  trailActivateAtr: number;
  trailDistanceAtr: number;
  breakEvenAtr:     number;
  maxHoldingBars:   number;
  // MOON mode
  moonSlPct:        number;
  moonPartialAt:    number;
  moonPartialPct:   number;
  moonTrailPct:     number;
}

interface EffectiveConfig {
  entryMode:        EntryMode;
  pumpVolMin:       number;
  useMarketFilter:  boolean;
  amBasePct:        number;
  capitalMode:      CapitalMode;
  capitalFixed:     number;
  capitalPct:       number;
  riskPct:          number;
  maxOpen:          number;
  minProbability:   number;
  exitMode:         ExitMode;
  tpAtr:            number;
  slAtr:            number;
  trailActivateAtr: number;
  trailDistanceAtr: number;
  breakEvenAtr:     number;
  moonSlPct?:       number;
  moonPartialAt?:   number;
  moonPartialPct?:  number;
  moonTrailPct?:    number;
  commissionPct:    number;
  maxHoldingBars:   number;
  warmupBars:       number;
}

interface SavedConfig {
  id:              string;
  name:            string;
  savedAt:         string;
  pnlPct?:         number;
  config:          SimConfig;
  effectiveConfig?: EffectiveConfig;
}

// ── Constants ──────────────────────────────────────────────────────────────────
const CONFIG_DEFAULTS = { maxHoldingBars: 8, pumpVolMin: 3.0 } as const;

const MOON_DEFAULTS = {
  moonSlPct:      25,
  moonPartialAt:  2.0,
  moonPartialPct: 50,
  moonTrailPct:   20,
} as const;

type SymbolCategory = "blue" | "alt" | "meme";

const SYMBOL_CATEGORY: Record<string, SymbolCategory> = {
  BTCUSDT:    "blue",
  ETHUSDT:    "blue",
  BNBUSDT:    "blue",
  SOLUSDT:    "alt",
  XRPUSDT:    "alt",
  ADAUSDT:    "alt",
  DOGEUSDT:   "meme",
  DOTUSDT:    "alt",
  AVAXUSDT:   "alt",
  LINKUSDT:   "alt",
  SHIBUSDT:   "meme",
  PEPEUSDT:   "meme",
  FLOKIUSDT:  "meme",
  WIFUSDT:    "meme",
  BONKUSDT:   "meme",
  SUIUSDT:    "alt",
  APTUSDT:    "alt",
  INJUSDT:    "alt",
  TIAUSDT:    "alt",
  FETUSDT:    "alt",
  BOMEUSDT:   "meme",
};

const CATEGORY_ICON: Record<SymbolCategory, string> = {
  blue: "fa-gem",
  alt:  "fa-bolt",
  meme: "fa-fire",
};

const CATEGORY_LABEL: Record<SymbolCategory, string> = {
  blue: "Blue chip",
  alt:  "Alt volàtil",
  meme: "Meme / Pump",
};

const SYMBOLS = [
  // Blue chips
  "BTCUSDT", "ETHUSDT", "BNBUSDT",
  // Alts volàtils
  "SOLUSDT", "XRPUSDT", "ADAUSDT", "DOTUSDT", "AVAXUSDT", "LINKUSDT",
  "SUIUSDT", "APTUSDT", "INJUSDT", "TIAUSDT", "FETUSDT",
  // Meme / Pump
  "DOGEUSDT", "SHIBUSDT", "PEPEUSDT", "FLOKIUSDT", "WIFUSDT", "BONKUSDT", "BOMEUSDT",
];
const INTERVALS = [
  { value: "1d",  label: "1 dia"   },
  { value: "4h",  label: "4 hores" },
  { value: "1h",  label: "1 hora"  },
  { value: "30m", label: "30 min"  },
  { value: "15m", label: "15 min"  },
];

// ATR defaults per interval i mode de sortida
const ATR_DEFAULTS: Record<string, {
  tp: number; sl: number; trailAct: number; trailDist: number;
  breakEven: number; letRunTrailDist: number;
}> = {
  "1d":  { tp: 3.0, sl: 1.5, trailAct: 2.0, trailDist: 1.5, breakEven: 2.0, letRunTrailDist: 4.0 },
  "4h":  { tp: 3.0, sl: 1.5, trailAct: 2.0, trailDist: 1.5, breakEven: 2.0, letRunTrailDist: 4.0 },
  "1h":  { tp: 2.5, sl: 1.0, trailAct: 1.5, trailDist: 1.0, breakEven: 2.0, letRunTrailDist: 3.0 },
  "30m": { tp: 2.5, sl: 1.0, trailAct: 1.5, trailDist: 1.0, breakEven: 2.0, letRunTrailDist: 3.0 },
  "15m": { tp: 1.5, sl: 1.5,  trailAct: 1.0, trailDist: 2.5, breakEven: 1.0, letRunTrailDist: 2.5 },
};

const RESULT_COLOR: Record<string, string> = {
  TP:                   "var(--green)",
  SL:                   "var(--red)",
  BREAK_EVEN:           "var(--accent)",
  TRAILING_SL:          "var(--text-2)",
  LET_RUN_SL:           "#10b981",   // emerald — sortida amb guany gran
  TIMEOUT:              "var(--text-3)",
  MOON_SL:              "var(--red)",
  MOON_PARTIAL_SL:      "#10b981",   // emerald — sortida parcial + trailing
  MOON_PARTIAL_TIMEOUT: "#d97706",   // amber
  MOON_TIMEOUT:         "var(--text-3)",
};
const RESULT_LABEL: Record<string, string> = {
  TP:                   "TP",
  SL:                   "SL",
  BREAK_EVEN:           "B/E",
  TRAILING_SL:          "TRAIL",
  LET_RUN_SL:           "RUN↑",
  TIMEOUT:              "TIMEOUT",
  MOON_SL:              "🌙SL",
  MOON_PARTIAL_SL:      "🌙TRAIL",
  MOON_PARTIAL_TIMEOUT: "🌙TIME",
  MOON_TIMEOUT:         "🌙OUT",
};

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString("ca-ES", { day: "2-digit", month: "2-digit", year: "2-digit" });
}
function fmtDateTime(ms: number): string {
  return new Date(ms).toLocaleString("ca-ES", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function fmtNum(v: number, d = 2): string {
  return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function pnlColor(v: number): string {
  return v > 0 ? "var(--green)" : v < 0 ? "var(--red)" : "var(--text-3)";
}
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}
function monthsAgoStr(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}
function tickerLabel(sym: string): string {
  return sym.replace("USDT", "");
}

// ── Layer bar ─────────────────────────────────────────────────────────────────
function LayerBar({ label, value }: { label: string; value: number }) {
  const color = value >= 65 ? "var(--green)" : value >= 45 ? "#d97706" : "var(--red)";
  return (
    <div className="sim-layer-bar">
      <span className="sim-layer-bar__label">{label}</span>
      <div className="sim-layer-bar__track">
        <div className="sim-layer-bar__fill" style={{ width: `${value}%`, background: color }} />
      </div>
      <span className="sim-layer-bar__value mono" style={{ color }}>{value}</span>
    </div>
  );
}

// ── Equity Chart SVG ───────────────────────────────────────────────────────────
const BTC_COLOR = "#F7931A";

function EquityChart({
  curve, btcCurve, initialCapital,
}: {
  curve: EquityPoint[]; btcCurve: EquityPoint[]; initialCapital: number;
}) {
  if (curve.length < 2) return <div className="sim-chart-empty">Sense dades</div>;

  const W = 700, H = 220;
  const pad = { t: 14, r: 100, b: 28, l: 70 };
  const pw = W - pad.l - pad.r;
  const ph = H - pad.t - pad.b;

  // Rang temporal unificat
  const allTimes = [...curve.map(p => p.time), ...btcCurve.map(p => p.time)];
  const minT = Math.min(...allTimes);
  const maxT = Math.max(...allTimes);
  const tRange = maxT - minT || 1;

  // Rang de valors unificat (equity + BTC normalitzat)
  const allValues = [
    ...curve.map(p => p.value),
    ...btcCurve.map(p => p.value),
    initialCapital,
  ];
  const minV   = Math.min(...allValues) * 0.99;
  const maxV   = Math.max(...allValues) * 1.01;
  const vRange = maxV - minV || 1;

  const xs = (t: number) => pad.l + ((t - minT) / tRange) * pw;
  const ys = (v: number) => pad.t + ph - ((v - minV) / vRange) * ph;

  const breakY  = ys(initialCapital);
  const lastV   = curve[curve.length - 1].value;
  const isUp    = lastV >= initialCapital;
  const lineClr = isUp ? "var(--green)" : "var(--red)";
  const fillId  = isUp ? "simGradUp"   : "simGradDn";

  const eqPts = curve.map(p => `${xs(p.time).toFixed(1)},${ys(p.value).toFixed(1)}`).join(" ");
  const areaD = [
    `M ${xs(curve[0].time).toFixed(1)},${(pad.t + ph).toFixed(1)}`,
    ...curve.map(p => `L ${xs(p.time).toFixed(1)},${ys(p.value).toFixed(1)}`),
    `L ${xs(curve[curve.length - 1].time).toFixed(1)},${(pad.t + ph).toFixed(1)}`,
    "Z",
  ].join(" ");

  const btcPts = btcCurve.map(p => `${xs(p.time).toFixed(1)},${ys(p.value).toFixed(1)}`).join(" ");

  // BTC % canvi final
  const btcLast  = btcCurve[btcCurve.length - 1]?.value ?? initialCapital;
  const btcPct   = ((btcLast - initialCapital) / initialCapital * 100).toFixed(1);
  const eqPct    = ((lastV   - initialCapital) / initialCapital * 100).toFixed(1);

  const yTicks = [minV, initialCapital, maxV].filter((v, i, a) => a.indexOf(v) === i);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="sim-chart" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="simGradUp" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="var(--green)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--green)" stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id="simGradDn" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="var(--red)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--red)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Línia de break-even */}
        <line x1={pad.l} y1={breakY.toFixed(1)} x2={W - pad.r} y2={breakY.toFixed(1)}
          stroke="var(--text-3)" strokeWidth="1" strokeDasharray="5,4" opacity="0.4" />

        {/* Àrea i línia equity */}
        <path d={areaD} fill={`url(#${fillId})`} />
        <polyline points={eqPts} fill="none" stroke={lineClr} strokeWidth="2" strokeLinejoin="round" />

        {/* Línia BTC (darrere, puntejada) */}
        {btcCurve.length > 1 && (
          <polyline points={btcPts} fill="none"
            stroke={BTC_COLOR} strokeWidth="1.5"
            strokeDasharray="6,3" strokeLinejoin="round" opacity="0.85" />
        )}

        {/* Llegenda */}
        <g transform={`translate(${W - pad.r + 8}, ${pad.t})`}>
          <line x1="0" y1="5" x2="14" y2="5" stroke={lineClr} strokeWidth="2" />
          <text x="17" y="9" fontSize="8" fill={lineClr}>Equity</text>
          {btcCurve.length > 1 && <>
            <line x1="0" y1="18" x2="14" y2="18"
              stroke={BTC_COLOR} strokeWidth="1.5" strokeDasharray="6,3" opacity="0.85" />
            <text x="17" y="22" fontSize="8" fill={BTC_COLOR} opacity="0.85">BTC ref.</text>
          </>}
        </g>

        {/* Punts finals */}
        <circle cx={xs(curve[curve.length - 1].time)} cy={ys(lastV)} r="3.5" fill={lineClr} />
        {btcCurve.length > 0 && (
          <circle cx={xs(btcLast === btcCurve[btcCurve.length-1]?.value
            ? btcCurve[btcCurve.length-1].time : btcCurve[btcCurve.length-1]?.time ?? maxT)}
            cy={ys(btcLast)} r="3" fill={BTC_COLOR} opacity="0.9" />
        )}

        {/* Etiquetes finals (dreta) */}
        <text x={W - pad.r + 6} y={ys(lastV) + 4} fontSize="9" fill={lineClr} fontWeight="700">
          {Number(eqPct) >= 0 ? "+" : ""}{eqPct}%
        </text>
        {btcCurve.length > 0 && (
          <text x={W - pad.r + 6} y={ys(btcLast) + 4} fontSize="9" fill={BTC_COLOR} fontWeight="700">
            BTC {Number(btcPct) >= 0 ? "+" : ""}{btcPct}%
          </text>
        )}

        {/* Eix Y */}
        {yTicks.map((v, i) => (
          <text key={i} x={pad.l - 5} y={ys(v) + 4} textAnchor="end"
            fontSize="9.5" fill={v === initialCapital ? "var(--text-3)" : "var(--text-2)"}>
            ${fmtNum(v, 0)}
          </text>
        ))}

        {/* Eix X */}
        {[curve[0], curve[curve.length - 1]].map((p, i) => (
          <text key={i} x={xs(p.time)} y={H - 6}
            textAnchor={i === 0 ? "start" : "end"} fontSize="9" fill="var(--text-3)">
            {fmtDate(p.time)}
          </text>
        ))}

        <line x1={pad.l} y1={pad.t} x2={pad.l} y2={pad.t + ph} stroke="var(--border)" strokeWidth="1" />
        <line x1={pad.l} y1={pad.t + ph} x2={W - pad.r} y2={pad.t + ph} stroke="var(--border)" strokeWidth="1" />
      </svg>

      {/* Llegenda */}
      <div className="sim-chart-legend">
        <span className="sim-chart-legend__item">
          <span className="sim-chart-legend__line" style={{ background: lineClr }} />
          Estratègia ({Number(eqPct) >= 0 ? "+" : ""}{eqPct}%)
        </span>
        {btcCurve.length > 1 && (
          <span className="sim-chart-legend__item">
            <span className="sim-chart-legend__line sim-chart-legend__line--dashed"
              style={{ borderColor: BTC_COLOR }} />
            Bitcoin buy &amp; hold ({Number(btcPct) >= 0 ? "+" : ""}{btcPct}%)
          </span>
        )}
        <span className="sim-chart-legend__item" style={{ color: "var(--text-3)" }}>
          <span className="sim-chart-legend__line sim-chart-legend__line--dotted" />
          Break-even
        </span>
      </div>
    </div>
  );
}

// ── Effective config info panel ────────────────────────────────────────────────
type CfgSrc = "sim" | "cfg" | "fix";

const SRC_META: Record<CfgSrc, { label: string; bg: string; color: string }> = {
  sim: { label: "Tab Simulació",    bg: "var(--accent-dim)",          color: "var(--accent)" },
  cfg: { label: "Tab Configuració", bg: "rgba(16,185,129,0.12)",      color: "var(--green)"  },
  fix: { label: "Hardcodejat",      bg: "rgba(217,119,6,0.12)",       color: "#d97706"       },
};

function SrcBadge({ src }: { src: CfgSrc }) {
  const s = SRC_META[src];
  return <span className="sim-cfg-src" style={{ background: s.bg, color: s.color }}>{s.label}</span>;
}

function CfgCard({ label, value, src }: { label: string; value: React.ReactNode; src: CfgSrc }) {
  return (
    <div className="sim-cfg-card">
      <span className="sim-cfg-card__label">{label}</span>
      <span className="sim-cfg-card__val mono">{value}</span>
      <SrcBadge src={src} />
    </div>
  );
}

function CfgGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="sim-cfg-group">
      <div className="sim-cfg-group__title">{title}</div>
      <div className="sim-cfg-group__cards">{children}</div>
    </div>
  );
}

function EffectiveConfigPanel({ cfg, simConfig }: { cfg: EffectiveConfig; simConfig: SimConfig }) {
  const exitLabel: Record<string, string> = {
    LET_RUN: "Let the Winners Run", BREAK_EVEN: "Break-Even", TRAILING: "Trailing SL", MOON: "🌙 To the Moon",
  };
  return (
    <div className="sim-effective-cfg">
      <div className="sim-effective-cfg__title">
        <i className="fa-solid fa-microscope" /> Paràmetres efectius de la simulació
      </div>
      <div className="sim-cfg-body">

        <CfgGroup title="Univers">
          <CfgCard label="Parells"         value={simConfig.symbols.map(tickerLabel).join(", ")}  src="sim" />
          <CfgCard label="Interval"        value={simConfig.interval}                              src="sim" />
          <CfgCard label="Període"         value={`${simConfig.from} → ${simConfig.to}`}           src="sim" />
          <CfgCard label="Capital inicial" value={`$${fmtNum(simConfig.initialCapital, 0)}`}       src="sim" />
        </CfgGroup>

        <CfgGroup title="Gestió del capital">
          {cfg.capitalMode === "FIXED"    && <CfgCard label="Mode" value={`Mida fixa — ${fmtNum(cfg.capitalFixed, 0)} USDT/trade`} src="sim" />}
          {cfg.capitalMode === "PCT"      && <CfgCard label="Mode" value={`% capital — ${cfg.capitalPct}% per trade`}              src="sim" />}
          {cfg.capitalMode === "RISK_PCT" && <CfgCard label="Mode" value={`Risc fix — ${cfg.riskPct}% de risc per trade`}          src="sim" />}
          {cfg.capitalMode === "ANTI_MARTINGALE" && <>
            <CfgCard label="Mode"   value="Anti-Martingala"                                  src="sim" />
            <CfgCard label="Base"   value={`${cfg.amBasePct}% del capital`}                  src="sim" />
            <CfgCard label="0–1 SL" value={`×1.0 → ${cfg.amBasePct}%`}                      src="fix" />
            <CfgCard label="2 SL"   value={`×0.5 → ${(cfg.amBasePct / 2).toFixed(0)}%`}     src="fix" />
            <CfgCard label="3+ SL"  value={`×0.25 → ${(cfg.amBasePct / 4).toFixed(0)}%`}    src="fix" />
          </>}
          <CfgCard label="Màx. posicions" value={`${cfg.maxOpen} simultànies`}                src="cfg" />
        </CfgGroup>

        <CfgGroup title="Filtre de mercat">
          <CfgCard label="EMA200 diari"  value={cfg.useMarketFilter ? "Activat ✓" : "Desactivat"} src="sim" />
          {cfg.useMarketFilter && <>
            <CfgCard label="Període EMA" value="200 barres diàries"         src="fix" />
            <CfgCard label="Warm-up"     value={`${cfg.warmupBars} veles`}  src="fix" />
          </>}
        </CfgGroup>

        <CfgGroup title="Mode d'entrada">
          <CfgCard label="Tipus" value={cfg.entryMode === "PUMP" ? "🚀 Pump/Volum" : cfg.entryMode === "CANDLES" ? "🕯️ Candlesticks" : "📊 Anàlisi tècnica"} src="sim" />
          {cfg.entryMode === "PUMP" && <CfgCard label="Volum mínim" value={`≥ ${cfg.pumpVolMin ?? 3}× vol. mitjà`} src="sim" />}
          {cfg.entryMode === "ANALYSIS" && <CfgCard label="EMA200 diari" value={cfg.useMarketFilter ? "Activat ✓" : "Desactivat"} src="sim" />}
          {cfg.entryMode === "CANDLES" && <CfgCard label="Confiança mín." value={`≥ ${(cfg as unknown as Record<string, number>).candlePatternScore ?? 70}%`} src="sim" />}
          {cfg.entryMode === "CANDLES" && <CfgCard label="Patrons" value={((cfg as unknown as Record<string, string[]>).candlePatterns ?? []).length === 0 ? "Tots" : ((cfg as unknown as Record<string, string[]>).candlePatterns ?? []).join(", ")} src="sim" />}
        </CfgGroup>

        <CfgGroup title="Filtre d'entrada">
          {cfg.entryMode === "ANALYSIS" && <CfgCard label="Prob. mínima" value={`${cfg.minProbability}%`} src="cfg" />}
          <CfgCard label="Warm-up indicadors" value={`${cfg.warmupBars} veles`}      src="fix" />
        </CfgGroup>

        <CfgGroup title="Estratègia de sortida">
          <CfgCard label="Mode"    value={exitLabel[cfg.exitMode] ?? cfg.exitMode}   src="sim" />
          {cfg.exitMode !== "MOON" && <CfgCard label="SL ini." value={`${cfg.slAtr}× ATR`} src="sim" />}
          {cfg.exitMode !== "LET_RUN" && cfg.exitMode !== "MOON" && <CfgCard label="TP" value={`${cfg.tpAtr}× ATR`} src="sim" />}
          {cfg.exitMode !== "TRAILING" && cfg.exitMode !== "MOON" && <CfgCard label="Activació B/E" value={`${cfg.breakEvenAtr}× ATR`} src="sim" />}
          {cfg.exitMode === "TRAILING" && <CfgCard label="Activació trail." value={`${cfg.trailActivateAtr}× ATR`} src="sim" />}
          {cfg.exitMode !== "BREAK_EVEN" && cfg.exitMode !== "MOON" && <CfgCard label="Distància trail." value={`${cfg.trailDistanceAtr}× ATR`} src="sim" />}
          <CfgCard label="Timeout màx."  value={`${cfg.maxHoldingBars} veles`}       src="sim" />
        </CfgGroup>

        {cfg.exitMode === "MOON" && (
          <CfgGroup title="🌙 Paràmetres Moon">
            <CfgCard label="SL inicial"    value={`${cfg.moonSlPct ?? 25}% sota entrada`}             src="sim" />
            <CfgCard label="Parcial a"     value={`${cfg.moonPartialAt ?? 2.0}× preu entrada`}        src="sim" />
            <CfgCard label="Venda parcial" value={`${cfg.moonPartialPct ?? 50}% de la posició`}       src="sim" />
            <CfgCard label="Trailing bag"  value={`${cfg.moonTrailPct ?? 20}% del màxim`}             src="sim" />
          </CfgGroup>
        )}

        <CfgGroup title="Comissions">
          <CfgCard label="Taxa compra"  value={`${cfg.commissionPct}% del capital invertit`}  src="fix" />
          <CfgCard label="Taxa venda"   value={`${cfg.commissionPct}% del valor de sortida`}  src="fix" />
          <CfgCard label="Cancel·lació" value="0% (sense comissió)"                            src="fix" />
        </CfgGroup>

      </div>
    </div>
  );
}

// ── Trades Table ───────────────────────────────────────────────────────────────
function TradesTable({ trades }: { trades: SimTrade[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (trades.length === 0) {
    return <div className="state-empty" style={{ padding: "1.5rem 0" }}>Cap operació simulada en aquest període</div>;
  }

  return (
    <div className="sim-trades-wrap">
      <div className="sim-trades-header">
        <span>Parell</span>
        <span className="ta-center">Dates</span>
        <span className="ta-right">Entrada</span>
        <span className="ta-right">Sortida</span>
        <span className="ta-right">P&amp;L</span>
        <span className="ta-right">Capital</span>
      </div>
      {trades.map((t, i) => {
        const open = expanded === i;
        return (
          <div key={i} className={`sim-trade-row-wrap${open ? " sim-trade-row-wrap--open" : ""}`}>
            <div className="sim-trade-row" onClick={() => setExpanded(open ? null : i)}>

              {/* Parell: icona + nom + badge resultat */}
              <div className="sim-trade__identity">
                <CoinIcon symbol={tickerLabel(t.symbol)} size={24} />
                <div className="sim-trade__identity-text">
                  <span className="sim-trade__symbol">{tickerLabel(t.symbol)}</span>
                  <span className="sim-trade__result-badge" style={{ background: RESULT_COLOR[t.result] }}>
                    {RESULT_LABEL[t.result] ?? t.result}
                  </span>
                </div>
              </div>

              {/* Dates apilades */}
              <div className="sim-trade__dates">
                <span className="sim-trade__date">{fmtDateTime(t.entryTime)}</span>
                <span className="sim-trade__date">{fmtDateTime(t.exitTime)}</span>
              </div>

              {/* Preu entrada: $ invertits (gran) + preu crypto (petit) */}
              <div className="sim-trade__price-block">
                <span className="sim-trade__price-main mono">${fmtNum(t.tradeCapital, 0)}</span>
                <span className="sim-trade__price-sub mono">@ ${fmtNum(t.entryPrice)}</span>
              </div>

              {/* Preu sortida: $ rebuts (gran) + preu crypto (petit) */}
              <div className="sim-trade__price-block">
                <span className="sim-trade__price-main mono" style={{ color: pnlColor(t.pnlUsdt) }}>
                  ${fmtNum(t.tradeCapital + t.pnlUsdt, 0)}
                </span>
                <span className="sim-trade__price-sub mono">@ ${fmtNum(t.exitPrice)}</span>
              </div>

              {/* P&L $ + % apilats */}
              <div className="pf-row__pnl-block sim-trade__pnl" style={{ color: pnlColor(t.pnlUsdt) }}>
                <span className="pf-row__pnl-val mono">
                  {t.pnlUsdt >= 0 ? "+" : ""}{fmtNum(t.pnlUsdt)} $
                </span>
                <span className="pf-row__pnl-pct mono">
                  {t.pnlPct >= 0 ? "+" : ""}{fmtNum(t.pnlPct)}%
                </span>
              </div>

              {/* Capital final */}
              <div className="pf-row__value">
                <span className="pf-row__usd mono">${fmtNum(t.capitalAfter, 0)}</span>
              </div>

            </div>

            {open && (
              <div className="sim-trade-detail">

                {/* 3 capes de l'anàlisi que van activar l'entrada */}
                <div className="sim-layers-block">
                  <div className="sim-layers-block__title">
                    <i className="fa-solid fa-layer-group" /> Senyal d&apos;entrada · 3 capes
                  </div>
                  <div className="sim-layers-block__bars">
                    <LayerBar label="Direcció"  value={t.layerScores?.direction ?? 0} />
                    <LayerBar label="Context"   value={t.layerScores?.context   ?? 0} />
                    <LayerBar label="Trigger"   value={t.layerScores?.trigger   ?? 0} />
                  </div>
                  <div className="sim-layers-block__summary">
                    <span>
                      <span className="sim-sl-meta__label">Puntuació global</span>
                      <span className="mono">{t.score}/100</span>
                    </span>
                    <span>
                      <span className="sim-sl-meta__label">Probabilitat</span>
                      <span className="mono" style={{ color: "var(--accent)" }}>{t.probability}%</span>
                    </span>
                    <span>
                      <span className="sim-sl-meta__label">Estratègia</span>
                      <span className="mono" style={{ fontSize: "0.7rem" }}>{t.stratName || "—"}</span>
                    </span>
                  </div>
                </div>

                {/* MOON: parcial info */}
                {t.partialExitPrice !== undefined && (
                  <div className="sim-sl-meta" style={{ background: "rgba(16,185,129,0.07)", borderRadius: "6px", padding: "0.5rem 0.75rem", marginBottom: "0.5rem" }}>
                    <span>
                      <span className="sim-sl-meta__label">🌙 Parcial a</span>
                      <span className="mono" style={{ color: "var(--green)" }}>${fmtNum(t.partialExitPrice)}</span>
                    </span>
                    <span>
                      <span className="sim-sl-meta__label">PnL parcial</span>
                      <span className="mono" style={{ color: "var(--green)" }}>+{fmtNum(t.partialExitPnl ?? 0)} $</span>
                    </span>
                    <span>
                      <span className="sim-sl-meta__label">Moon bag</span>
                      <span className="mono">${fmtNum(t.moonBagCapital ?? 0, 0)}</span>
                    </span>
                  </div>
                )}

                {/* Meta de la operació */}
                <div className="sim-sl-meta">
                  {!t.result.startsWith("MOON") && (
                    <span>
                      <span className="sim-sl-meta__label">TP</span>
                      <span className="mono">{fmtNum(t.tp)}</span>
                    </span>
                  )}
                  {!t.result.startsWith("MOON") && (
                    <span>
                      <span className="sim-sl-meta__label">Trail dist.</span>
                      <span className="mono">{fmtNum(t.trailDist)}</span>
                    </span>
                  )}
                  {!t.result.startsWith("MOON") && (
                    <span>
                      <span className="sim-sl-meta__label">
                        {t.breakEvenActivated ? "Break-Even" : "Trailing"} activat
                      </span>
                      <span className="mono" style={{
                        color: (t.trailActive || t.breakEvenActivated) ? "var(--green)" : "var(--text-3)"
                      }}>
                        {(t.trailActive || t.breakEvenActivated) ? "Sí" : "No"}
                      </span>
                    </span>
                  )}
                  {t.result.startsWith("MOON") && (
                    <span>
                      <span className="sim-sl-meta__label">SL inicial</span>
                      <span className="mono">{fmtNum(t.initialSl)}</span>
                    </span>
                  )}
                  <span>
                    <span className="sim-sl-meta__label">Màxim</span>
                    <span className="mono">{fmtNum(t.peakPrice)}</span>
                  </span>
                  <span>
                    <span className="sim-sl-meta__label">Moviments SL</span>
                    <span className="mono">{t.slMoves.length}</span>
                  </span>
                </div>

                {/* Historial SL */}
                <div className="sim-sl-table-wrap">
                  <div className="sim-sl-table-header">
                    <span>#</span>
                    <span>Moment</span>
                    <span className="ta-right">Màxim</span>
                    <span className="ta-right">Stop Loss</span>
                    <span className="ta-right">Δ SL</span>
                  </div>
                  {t.slMoves.map((m: SlMove, idx: number) => {
                    const prev  = t.slMoves[idx - 1];
                    const delta = prev ? m.sl - prev.sl : 0;
                    const isInitial = idx === 0;
                    return (
                      <div key={idx} className={`sim-sl-row${isInitial ? " sim-sl-row--initial" : ""}`}>
                        <span className="sim-sl-row__idx mono">{isInitial ? "⚑" : idx}</span>
                        <span className="sim-trade__date">{fmtDateTime(m.time)}</span>
                        <span className="mono ta-right">{fmtNum(m.peakPrice)}</span>
                        <span className="mono ta-right" style={{ color: "var(--red)" }}>{fmtNum(m.sl)}</span>
                        <span className="mono ta-right" style={{ color: delta > 0 ? "var(--green)" : "var(--text-3)" }}>
                          {isInitial ? "—" : `+${fmtNum(delta)}`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Symbol P&L bar chart ───────────────────────────────────────────────────────
function SymbolPnlChart({ trades }: { trades: SimTrade[] }) {
  const symbols = [...new Set(trades.map(t => t.symbol))];
  const data = symbols.map(sym => {
    const st     = trades.filter(t => t.symbol === sym);
    const pnl    = st.reduce((s, t) => s + t.pnlUsdt, 0);
    const wins   = st.filter(t => t.pnlUsdt > 0).length;
    return { sym: tickerLabel(sym), pnl, count: st.length, wins };
  }).sort((a, b) => b.pnl - a.pnl);

  if (data.length === 0) return null;
  const maxAbs = Math.max(...data.map(d => Math.abs(d.pnl)), 1);

  return (
    <div className="sim-symbol-chart">
      <div className="sim-symbol-chart__title">
        <i className="fa-solid fa-ranking-star" /> P&amp;L per parell
      </div>
      <div className="sim-symbol-chart__bars">
        {data.map(d => {
          const pct   = (Math.abs(d.pnl) / maxAbs) * 100;
          const color = d.pnl >= 0 ? "var(--green)" : "var(--red)";
          return (
            <div key={d.sym} className="sim-symbol-bar">
              <div className="sim-symbol-bar__identity">
                <CoinIcon symbol={d.sym} size={16} />
                <span className="sim-symbol-bar__name">{d.sym}</span>
                <span className="sim-symbol-bar__count">{d.count}op</span>
              </div>
              <div className="sim-symbol-bar__track">
                <div className="sim-symbol-bar__fill" style={{ width: `${pct}%`, background: color }} />
              </div>
              <span className="sim-symbol-bar__val mono" style={{ color }}>
                {d.pnl >= 0 ? "+" : ""}{fmtNum(d.pnl, 0)}$
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function SimulationTab() {
  const [config, setConfig] = useState<SimConfig>(() => {
    const def = ATR_DEFAULTS["1d"];
    return {
      symbols:          ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT"],
      interval:         "1d",
      from:             monthsAgoStr(6),
      to:               todayStr(),
      initialCapital:   1000,
      useMarketFilter:  true,
      amBasePct:        60,
      capitalMode:      "RISK_PCT",
      capitalFixed:     100,
      capitalPct:       10,
      riskPct:          1.5,
      maxHoldingBars:   300,
      entryMode:        "ANALYSIS" as EntryMode,
      pumpVolMin:       3.0,
      exitMode:         "LET_RUN",
      tpAtr:            def.tp,
      slAtr:            def.sl,
      trailActivateAtr: def.trailAct,
      trailDistanceAtr: def.letRunTrailDist,
      breakEvenAtr:     def.breakEven,
      ...MOON_DEFAULTS,
    };
  });

  const [result,       setResult      ] = useState<SimResult | null>(null);
  const [loading,      setLoading     ] = useState(false);
  const [error,        setError       ] = useState<string | null>(null);
  const [exportMsg,    setExportMsg   ] = useState<string | null>(null);
  const [savedConfigs,    setSavedConfigs   ] = useState<SavedConfig[]>([]);
  const [selectedConfig,  setSelectedConfig ] = useState<SavedConfig | null>(null);
  const [detailOpen,      setDetailOpen     ] = useState(false);
  const [saveModalOpen,   setSaveModalOpen  ] = useState(false);
  const [saveConfigName,  setSaveConfigName ] = useState("");
  const [savingConfig,    setSavingConfig   ] = useState(false);
  const [saveMsg,         setSaveMsg        ] = useState<string | null>(null);
  const [applyConfirmSc,  setApplyConfirmSc ] = useState<SavedConfig | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  // Carrega les configuracions desades en muntar i aplica la de més guany
  useEffect(() => {
    fetch("/api/simulation/configs")
      .then(r => r.json())
      .then((d: { configs?: SavedConfig[] }) => {
        if (!d.configs?.length) return;
        setSavedConfigs(d.configs);
        const best = d.configs
          .filter(c => c.pnlPct !== undefined)
          .sort((a, b) => (b.pnlPct ?? -Infinity) - (a.pnlPct ?? -Infinity))[0];
        if (best) { setConfig({ ...CONFIG_DEFAULTS, ...MOON_DEFAULTS, ...best.config }); }
      })
      .catch(() => {});
  }, []);

  const set = useCallback(<K extends keyof SimConfig>(k: K, v: SimConfig[K]) => {
    setConfig(prev => ({ ...prev, [k]: v }));
  }, []);

  // Quan canvia l'interval, actualitza els defaults ATR
  useEffect(() => {
    const def = ATR_DEFAULTS[config.interval] ?? ATR_DEFAULTS["1h"];
    setConfig(prev => ({
      ...prev,
      tpAtr:            def.tp,
      slAtr:            def.sl,
      trailActivateAtr: def.trailAct,
      trailDistanceAtr: prev.exitMode === "LET_RUN" ? def.letRunTrailDist : def.trailDist,
      breakEvenAtr:     def.breakEven,
    }));
  }, [config.interval]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSymbol = useCallback((sym: string) => {
    setConfig(prev => ({
      ...prev,
      symbols: prev.symbols.includes(sym)
        ? prev.symbols.filter(s => s !== sym)
        : [...prev.symbols, sym],
    }));
  }, []);

  const openSaveModal = useCallback(() => {
    const syms = config.symbols.slice(0, 3).map(tickerLabel).map(s => s.toLowerCase()).join("_");
    const pct  = result?.stats.totalPnlPct;
    const pctStr = pct !== undefined ? `_${pct >= 0 ? "+" : ""}${pct.toFixed(1)}pct` : "";
    setSaveConfigName(`conf_${syms}${pctStr}`);
    setSaveModalOpen(true);
  }, [config.symbols, result]);

  const saveConfig = useCallback(async () => {
    if (!saveConfigName.trim()) return;
    setSavingConfig(true);
    try {
      const pnlPct         = result?.stats.totalPnlPct;
      const effectiveCfg   = result?.effectiveConfig;
      const r = await fetch("/api/simulation/configs", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ name: saveConfigName.trim(), config, pnlPct, effectiveConfig: effectiveCfg }),
      });
      const d = await r.json() as { ok?: boolean; id?: string; name?: string; savedAt?: string };
      if (d.ok && d.id) {
        const newEntry: SavedConfig = { id: d.id, name: d.name!, savedAt: d.savedAt!, pnlPct, config, effectiveConfig: effectiveCfg };
        setSavedConfigs(prev => [newEntry, ...prev]);
        setSaveConfigName("");
        setSaveModalOpen(false);
        setSaveMsg("Configuració desada ✓");
        setTimeout(() => setSaveMsg(null), 3000);
      }
    } catch { /* ignore */ } finally {
      setSavingConfig(false);
    }
  }, [saveConfigName, config, result]);

  const loadConfig = useCallback((sc: SavedConfig) => {
    setConfig({ ...CONFIG_DEFAULTS, ...MOON_DEFAULTS, ...sc.config });
    setSelectedConfig(prev => {
      if (prev?.id === sc.id) { setDetailOpen(o => !o); return prev; }
      setDetailOpen(true);
      return sc;
    });
    setSaveMsg(`Carregat: ${sc.name}`);
    setTimeout(() => setSaveMsg(null), 3000);
  }, []);

  const applyToAutoTrade = useCallback(async (sc: SavedConfig) => {
    const cfg = sc.config;
    const eff = sc.effectiveConfig;
    const PRESET_TF: Record<string, string> = {
      "1d": "4h", "4h": "4h", "1h": "1h", "30m": "1h", "15m": "5m",
    };
    const tf = PRESET_TF[cfg.interval] ?? "1h";

    const updates: [string, string][] = [
      [`oco_tp_atr__MARKET__${tf}`,            String(cfg.tpAtr)],
      [`oco_sl_atr__MARKET__${tf}`,            String(cfg.slAtr)],
      [`trailing_activate_atr__MARKET__${tf}`, String(cfg.trailActivateAtr)],
      [`trailing_distance_atr__MARKET__${tf}`, String(cfg.trailDistanceAtr)],
      ["auto_trade_intervals",                  cfg.interval],
      ["auto_trade_min_score",                  String(eff?.minProbability ?? 80)],
      ["capital_max_open",                      String(eff?.maxOpen ?? 3)],
      ["priority_pairs",                        cfg.symbols.join(",")],
    ];

    if (cfg.capitalMode === "FIXED") {
      updates.push(["capital_mode", "FIXED"],
                   ["capital_fixed_usdt", String(cfg.capitalFixed)],
                   ["auto_trade_usdt",    String(cfg.capitalFixed)]);
    } else if (cfg.capitalMode === "PCT") {
      updates.push(["capital_mode", "PCT_PORTFOLIO"],
                   ["capital_pct_portfolio", String(cfg.capitalPct)]);
    } else if (cfg.capitalMode === "ANTI_MARTINGALE") {
      updates.push(["capital_mode", "PCT_PORTFOLIO"],
                   ["capital_pct_portfolio", String(cfg.amBasePct ?? 60)]);
    } else if (cfg.capitalMode === "RISK_PCT") {
      updates.push(["capital_mode", "FIXED"],
                   ["capital_fixed_usdt", String(cfg.capitalFixed)]);
    }

    try {
      await Promise.all(updates.map(([key, value]) =>
        fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, value }),
        })
      ));
      setSaveMsg(`Aplicat: ${sc.name}`);
      setTimeout(() => setSaveMsg(null), 4000);
    } catch {
      setSaveMsg("Error en aplicar la configuració");
      setTimeout(() => setSaveMsg(null), 4000);
    } finally {
      setApplyConfirmSc(null);
    }
  }, []);

  const deleteConfig = useCallback((id: string) => {
    fetch("/api/simulation/configs", {
      method:  "DELETE",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ id }),
    }).catch(() => {});
    setSavedConfigs(prev => prev.filter(c => c.id !== id));
  }, []);

  const runSimulation = useCallback(async () => {
    if (config.symbols.length === 0) {
      setError("Selecciona almenys un parell");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const body = {
        ...config,
        from: new Date(config.from + "T00:00:00Z").getTime(),
        to:   new Date(config.to   + "T23:59:59Z").getTime(),
      };
      const r = await fetch("/api/simulation/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json() as SimResult & { error?: string };
      if (data.error) throw new Error(data.error);
      setResult(data);
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [config]);

  const exportSimulation = useCallback(async () => {
    if (!result) return;
    const { stats, effectiveConfig, trades, equityCurve } = result;

    const doc = {
      _meta: {
        generated:   new Date().toISOString(),
        system:      "CryptDesk Backtester",
        description: "Backtest d'una estratègia algorítmica de trading de criptomonedes basada en anàlisi tècnica de 3 capes.",
      },

      strategy_description: {
        overview: "Sistema de trading que combina anàlisi tècnica en 3 capes per generar senyals d'entrada BUY, seguides d'una gestió de sortida en dues fases (OCO → Trailing SL).",
        entry_logic: {
          step1_direction: "Capa Direcció (pes 40%): EMA200, ADX, +DI/-DI. Confirma que el mercat té tendència alcista definida.",
          step2_context:   "Capa Context (pes 30%): RSI, Volum relatiu, posició en rang. Confirma que el context és favorable per entrar.",
          step3_trigger:   "Capa Trigger (pes 30%): MACD, RSI momentum, ruptura de rang, volum relatiu. Senyal d'entrada immediata.",
          probability:     "Probabilitat = score×0.7 + bonus_interval + bonus_confiança. Només entra si probabilitat ≥ llindar mínim.",
          entry_candle:    "L'entrada es fa al preu OPEN de la vela SEGUENT al senyal (evita look-ahead bias).",
        },
        exit_logic: {
          phase1_oco:      "Fase OCO: TP fix (entrada + N×ATR) i SL fix (entrada − N×ATR). Si el preu arriba al TP, sortida amb guany.",
          phase2_trailing: "Fase Trailing: s'activa quan preu ≥ entrada + N×ATR. El SL segueix el màxim − distància ATR. Protegeix guanys.",
          timeout:         "Si l'operació no es tanca en el nombre de veles configurat, es tanca forçosament al preu de tancament.",
        },
      },

      simulation_parameters: {
        // ── Univers ──
        symbols:          config.symbols,
        interval:         config.interval,
        period_from:      config.from,
        period_to:        config.to,
        initial_capital_usdt: config.initialCapital,
        warmup_bars:      effectiveConfig.warmupBars,
        // ── Filtre de mercat ──
        market_filter_ema200_daily: effectiveConfig.useMarketFilter,
        // ── Gestió del capital ──
        capital_mode:     effectiveConfig.capitalMode,
        capital_fixed_usdt:  effectiveConfig.capitalFixed,
        capital_pct:         effectiveConfig.capitalPct,
        risk_pct:            effectiveConfig.riskPct,
        anti_martingale_base_pct: effectiveConfig.amBasePct,
        max_simultaneous_positions: effectiveConfig.maxOpen,
        // ── Filtre d'entrada ──
        min_entry_probability_pct: effectiveConfig.minProbability,
        // ── Estratègia de sortida ──
        exit_mode:              effectiveConfig.exitMode,
        tp_atr_multiplier:      effectiveConfig.tpAtr,
        sl_atr_multiplier:      effectiveConfig.slAtr,
        trailing_activate_atr:  effectiveConfig.trailActivateAtr,
        trailing_distance_atr:  effectiveConfig.trailDistanceAtr,
        break_even_atr:         effectiveConfig.breakEvenAtr,
        max_holding_bars:       effectiveConfig.maxHoldingBars,
        // ── Comissions ──
        commission_pct_per_side: effectiveConfig.commissionPct,
        commission_total_round_trip_pct: +(effectiveConfig.commissionPct * 2).toFixed(4),
      },

      performance_summary: {
        total_trades:       stats.totalTrades,
        winning_trades:     stats.wins,
        losing_trades:      stats.losses,
        win_rate_pct:       +stats.winRate.toFixed(2),
        total_pnl_usdt:     +stats.totalPnl.toFixed(2),
        total_pnl_pct:      +stats.totalPnlPct.toFixed(2),
        final_capital_usdt: +stats.finalCapital.toFixed(2),
        profit_factor:      +stats.profitFactor.toFixed(3),
        max_drawdown_pct:   +stats.maxDrawdown.toFixed(2),
        avg_win_usdt:       +stats.avgWin.toFixed(2),
        avg_loss_usdt:      +stats.avgLoss.toFixed(2),
        candles_backtested: stats.candlesUsed,
        expectancy_usdt:    stats.totalTrades > 0
          ? +((stats.totalPnl / stats.totalTrades)).toFixed(2)
          : 0,
        risk_reward_ratio:  stats.avgLoss > 0
          ? +(stats.avgWin / stats.avgLoss).toFixed(2)
          : null,
      },

      results_by_symbol: config.symbols.map(sym => {
        const symTrades = trades.filter(t => t.symbol === sym);
        const symWins   = symTrades.filter(t => t.pnlUsdt > 0);
        const symLosses = symTrades.filter(t => t.pnlUsdt < 0);
        return {
          symbol:      sym,
          trades:      symTrades.length,
          wins:        symWins.length,
          losses:      symLosses.length,
          win_rate:    symTrades.length > 0 ? +((symWins.length / symTrades.length) * 100).toFixed(1) : 0,
          total_pnl:   +symTrades.reduce((s, t) => s + t.pnlUsdt, 0).toFixed(2),
        };
      }),

      results_by_outcome: {
        TP:          trades.filter(t => t.result === "TP").length,
        SL:          trades.filter(t => t.result === "SL").length,
        TRAILING_SL: trades.filter(t => t.result === "TRAILING_SL").length,
        TIMEOUT:     trades.filter(t => t.result === "TIMEOUT").length,
      },

      equity_curve: equityCurve.map(p => ({
        date:    new Date(p.time).toISOString().slice(0, 10),
        capital: +p.value.toFixed(2),
      })),

      trades: trades.map((t, i) => ({
        id:             i + 1,
        symbol:         t.symbol,
        entry_date:     new Date(t.entryTime).toISOString().slice(0, 10),
        exit_date:      new Date(t.exitTime).toISOString().slice(0, 10),
        entry_price:    t.entryPrice,
        exit_price:     t.exitPrice,
        tp_price:       t.tp,
        initial_sl:     t.initialSl,
        peak_price:     t.peakPrice,
        trail_distance: t.trailDist,
        trailing_activated: t.trailActive,
        sl_moves_count: t.slMoves.length,
        result:         t.result,
        pnl_usdt:       +t.pnlUsdt.toFixed(2),
        pnl_pct:        +t.pnlPct.toFixed(2),
        capital_after:  +t.capitalAfter.toFixed(2),
        entry_signal: {
          global_score:       t.score,
          probability_pct:    t.probability,
          strategy_name:      t.stratName,
          direction_score:    t.layerScores?.direction ?? null,
          context_score:      t.layerScores?.context   ?? null,
          trigger_score:      t.layerScores?.trigger   ?? null,
        },
      })),
    };

    const filename = `sim_${config.interval}_${config.from}_${config.to}_${Date.now()}.json`;

    // Guarda al servidor (carpeta reports/)
    const res = await fetch("/api/simulation/export", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ filename, content: doc }),
    });
    const saved = await res.json() as { ok?: boolean; filename?: string; path?: string; error?: string };

    if (!saved.ok) {
      console.error("Error guardant l'informe:", saved.error);
    }

    // Descàrrega local també
    const json = JSON.stringify(doc, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = saved.filename ?? filename;
    a.click();
    URL.revokeObjectURL(url);

    setExportMsg(saved.path ? `Guardat a ${saved.path}` : "Descarregat");
    setTimeout(() => setExportMsg(null), 4000);
  }, [result, config]);

  const stats = result?.stats;
  const pnlUp = (stats?.totalPnl ?? 0) >= 0;

  return (
    <>
    {saveModalOpen && (
      <div className="sim-modal-overlay" onClick={() => setSaveModalOpen(false)}>
        <div className="sim-modal" onClick={e => e.stopPropagation()}>
          <div className="sim-modal__title">
            <i className="fa-solid fa-floppy-disk" /> Desar configuració
          </div>
          <div className="sim-modal__body">
            <label className="sim-field">
              <span className="sim-field__label">Nom de la configuració</span>
              <input
                className="sim-field__input"
                type="text"
                value={saveConfigName}
                onChange={e => setSaveConfigName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") saveConfig(); if (e.key === "Escape") setSaveModalOpen(false); }}
                maxLength={80}
                autoFocus
              />
            </label>
          </div>
          <div className="sim-modal__footer">
            <button className="btn-secondary" onClick={() => setSaveModalOpen(false)}>Cancel·lar</button>
            <button className="btn-primary" onClick={saveConfig} disabled={savingConfig || !saveConfigName.trim()}>
              {savingConfig ? <><i className="fa-solid fa-spinner fa-spin" /> Desant…</> : <><i className="fa-solid fa-floppy-disk" /> Desa</>}
            </button>
          </div>
        </div>
      </div>
    )}
    <div className="sim-root">
      <div className="sim-col sim-col--config">

      {/* ── Config panel ──────────────────────────────────────────────── */}
      <div className="sim-config-panel">

        {/* Capçalera */}
        <div className="sim-box-header">
          <div className="sim-box-header__top">
            <i className="fa-solid fa-flask-vial" /> Configuració de la simulació
          </div>
          <span className="sim-box-header__sub">
            Reprodueix el comportament real: parells simultanis, capital compartit, lògica OCO → Trailing SL idèntica a producció.
          </span>
          <div className="sim-box-header__actions">
            <button className="btn-primary sim-run-btn" onClick={runSimulation} disabled={loading}>
              {loading
                ? <><i className="fa-solid fa-spinner fa-spin" /> Simulant&hellip;</>
                : <><i className="fa-solid fa-play" /> Executar simulació</>}
            </button>
            <button className="btn-secondary sim-save-btn" onClick={openSaveModal} disabled={savingConfig}>
              <i className="fa-solid fa-floppy-disk" /> Desar configuració
            </button>
            {loading && (
              <span className="sim-config-loading-hint">
                {config.symbols.map(tickerLabel).join(", ")} · {config.interval}&hellip;
              </span>
            )}
          </div>
        </div>

        {/* Configuracions desades */}
        <div className="sim-box-section">
          <div className="sim-section-label">
            <i className="fa-solid fa-bookmark" /> Configuracions desades
            {saveMsg && <span className="sim-save-msg sim-save-msg--inline"><i className="fa-solid fa-circle-check" /> {saveMsg}</span>}
          </div>
          {savedConfigs.length > 0 ? (
            <div className="sim-saved-list">
              {savedConfigs.map(sc => (
                <div
                  key={sc.id}
                  className={`sim-saved-item${selectedConfig?.id === sc.id ? " sim-saved-item--active" : ""}`}
                  onClick={() => loadConfig(sc)}
                >
                  <span className="sim-saved-item__name">{sc.name}</span>
                  <span className="sim-saved-item__range">{sc.config.from} → {sc.config.to}</span>
                  <span className="sim-saved-item__meta">
                    {(sc.config.symbols ?? []).map(tickerLabel).join(", ")} · {sc.config.interval}
                  </span>
                  {sc.pnlPct !== undefined ? (
                    <span className="sim-saved-item__pnl mono" style={{ color: sc.pnlPct >= 0 ? "var(--green)" : "var(--red)" }}>
                      {sc.pnlPct >= 0 ? "+" : ""}{sc.pnlPct.toFixed(1)}%
                    </span>
                  ) : (
                    <span className="sim-saved-item__pnl" style={{ color: "var(--text-3)" }}>—</span>
                  )}
                  <button
                    className="sim-saved-item__apply"
                    title="Aplicar com a mètode automàtic"
                    onClick={e => { e.stopPropagation(); setApplyConfirmSc(sc); }}
                  >
                    <i className="fa-solid fa-robot" />
                  </button>
                  <button className="sim-saved-item__del" onClick={e => { e.stopPropagation(); deleteConfig(sc.id); }}>
                    <i className="fa-solid fa-trash" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="sim-saved-empty">Encara no hi ha configuracions desades</div>
          )}

          {applyConfirmSc && (
            <div className="sim-apply-confirm">
              <i className="fa-solid fa-triangle-exclamation" />
              <span>Aplicar <strong>{applyConfirmSc.name}</strong> com a mètode automàtic? Sobreescriurà els paràmetres ATR, capital i parells actius.</span>
              <button className="btn-primary sim-apply-confirm__ok"
                onClick={() => applyToAutoTrade(applyConfirmSc)}>
                Aplicar
              </button>
              <button className="btn-secondary sim-apply-confirm__cancel"
                onClick={() => setApplyConfirmSc(null)}>
                Cancel·lar
              </button>
            </div>
          )}

          {/* Accordion de detall */}
          {selectedConfig && (
            <div className="sim-saved-accordion">
              <button className="sim-saved-accordion__toggle" onClick={() => setDetailOpen(o => !o)}>
                <i className="fa-solid fa-circle-info" />
                <span>{selectedConfig.name}</span>
                {selectedConfig.pnlPct !== undefined && (
                  <span className="mono sim-saved-accordion__pnl" style={{ color: selectedConfig.pnlPct >= 0 ? "var(--green)" : "var(--red)" }}>
                    {selectedConfig.pnlPct >= 0 ? "+" : ""}{selectedConfig.pnlPct.toFixed(1)}%
                  </span>
                )}
                <i className={`fa-solid fa-chevron-${detailOpen ? "up" : "down"} sim-saved-accordion__chevron`} />
              </button>
              {detailOpen && (
                <div className="sim-saved-detail__table">
                  {[
                    ["Parells",      (selectedConfig.config.symbols ?? []).map(tickerLabel).join(", ")],
                    ["Interval",     selectedConfig.config.interval],
                    ["Període",      `${selectedConfig.config.from} → ${selectedConfig.config.to}`],
                    ["Capital",      `$${fmtNum(selectedConfig.config.initialCapital ?? 0, 0)}`],
                    ["Mode capital", selectedConfig.config.capitalMode],
                    ["Sortida",      selectedConfig.config.exitMode],
                    ["TP",           `${selectedConfig.config.tpAtr}× ATR`],
                    ["SL",           `${selectedConfig.config.slAtr}× ATR`],
                    ["Filtre EMA",   selectedConfig.config.useMarketFilter ? "Activat" : "Desactivat"],
                  ].map(([label, val]) => (
                    <div key={label} className="sim-saved-detail__row">
                      <span className="sim-saved-detail__lbl">{label}</span>
                      <span className="sim-saved-detail__val">{val}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Univers */}
        <div className="sim-box-section">
          <div className="sim-section-label"><i className="fa-solid fa-globe" /> Univers</div>
          <div className="sim-section-body">
            <div className="sim-field" style={{ marginBottom: "0.75rem" }}>
              <span className="sim-field__label">
                Parells actius <span style={{ color: "var(--text-3)", fontWeight: 400 }}>({config.symbols.length} seleccionats · ordre = prioritat)</span>
              </span>
              <div className="sim-symbol-row">
                {SYMBOLS.map(sym => {
                  const cat = SYMBOL_CATEGORY[sym] ?? "alt";
                  return (
                    <button
                      key={sym}
                      className={`sim-symbol-badge sim-symbol-badge--${cat}${config.symbols.includes(sym) ? " sim-symbol-badge--on" : ""}`}
                      onClick={() => toggleSymbol(sym)}
                      title={CATEGORY_LABEL[cat]}
                    >
                      <i className={`fa-solid ${CATEGORY_ICON[cat]} sim-symbol-badge__icon`} />
                      {tickerLabel(sym)}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="sim-config-grid">
              <label className="sim-field">
                <span className="sim-field__label">Interval</span>
                <select className="sim-field__input" value={config.interval} onChange={e => set("interval", e.target.value)}>
                  {INTERVALS.map(iv => <option key={iv.value} value={iv.value}>{iv.label}</option>)}
                </select>
                <span className="sim-field__hint">determina els paràmetres ATR a usar</span>
              </label>
              <label className="sim-field">
                <span className="sim-field__label">Data inici</span>
                <input type="date" className="sim-field__input"
                  value={config.from} max={config.to}
                  onChange={e => set("from", e.target.value)} />
              </label>
              <label className="sim-field">
                <span className="sim-field__label">Data fi</span>
                <input type="date" className="sim-field__input"
                  value={config.to} min={config.from} max={todayStr()}
                  onChange={e => set("to", e.target.value)} />
              </label>
            </div>
          </div>
        </div>

        {/* Filtre de mercat alcista */}
        <div className="sim-box-section">
          <div className="sim-section-label"><i className="fa-solid fa-filter" /> Filtre de mercat</div>
          <div className="sim-section-body">
            <div
              className={`sim-market-filter${config.useMarketFilter ? " sim-market-filter--on" : ""}`}
              onClick={() => set("useMarketFilter", !config.useMarketFilter)}
              role="button"
            >
              <div className="sim-market-filter__toggle">
                <span className={`sim-market-filter__dot${config.useMarketFilter ? " sim-market-filter__dot--on" : ""}`} />
              </div>
              <div className="sim-market-filter__body">
                <span className="sim-market-filter__title">
                  {config.useMarketFilter
                    ? <><i className="fa-solid fa-shield-check" /> Filtre alcista ACTIVAT</>
                    : <><i className="fa-solid fa-shield-slash" /> Filtre alcista DESACTIVAT</>}
                </span>
                <span className="sim-market-filter__rule">
                  IF preu &gt; EMA(200) diari &nbsp;→&nbsp; Permet entrada &nbsp;
                  ELSE &nbsp;→&nbsp; Bloqueja bot
                </span>
                <span className="sim-market-filter__desc">
                  {config.useMarketFilter
                    ? "Protecció activada. Només entra en tendència alcista a llarg termini (per sobre de la EMA 200 diària del símbol)."
                    : "Sense filtre. El bot opera en qualsevol condició de mercat, incloent mercats bajistes."}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Capital sizing */}
        <div className="sim-box-section">
          <div className="sim-section-label"><i className="fa-solid fa-wallet" /> Gestió del capital per trade</div>
          <div className="sim-section-body">
            <div className="sim-exit-mode-row" style={{ marginBottom: "0.5rem" }}>
              <button
                className={`sim-exit-mode-btn${config.capitalMode === "RISK_PCT" ? " sim-exit-mode-btn--on" : ""}`}
                onClick={() => set("capitalMode", "RISK_PCT")}
              >
                <i className="fa-solid fa-percent" /> Risc fix %
              </button>
              <button
                className={`sim-exit-mode-btn${config.capitalMode === "FIXED" ? " sim-exit-mode-btn--on" : ""}`}
                onClick={() => set("capitalMode", "FIXED")}
              >
                <i className="fa-solid fa-dollar-sign" /> USDT fix
              </button>
              <button
                className={`sim-exit-mode-btn${config.capitalMode === "PCT" ? " sim-exit-mode-btn--on" : ""}`}
                onClick={() => set("capitalMode", "PCT")}
              >
                <i className="fa-solid fa-chart-pie" /> % capital
              </button>
              <button
                className={`sim-exit-mode-btn${config.capitalMode === "ANTI_MARTINGALE" ? " sim-exit-mode-btn--on" : ""}`}
                onClick={() => set("capitalMode", "ANTI_MARTINGALE")}
              >
                <i className="fa-solid fa-chart-pyramid" /> Anti-Martingala
              </button>
            </div>
            <div className="sim-config-grid">
              <label className="sim-field">
                <span className="sim-field__label">Capital inicial (USDT)</span>
                <input type="number" className="sim-field__input" min="10" max="1000000" step="100"
                  value={config.initialCapital}
                  onChange={e => set("initialCapital", parseFloat(e.target.value) || 1000)} />
              </label>
              {config.capitalMode === "RISK_PCT" && (
                <label className="sim-field">
                  <span className="sim-field__label">Risc per trade (%)</span>
                  <input type="number" className="sim-field__input" min="0.1" max="10" step="0.1"
                    value={config.riskPct}
                    onChange={e => set("riskPct", parseFloat(e.target.value) || 1)} />
                  <span className="sim-field__hint">
                    si salta el SL → pèrdua = {config.riskPct}% · posició = risc$ ÷ SL%
                  </span>
                </label>
              )}
              {config.capitalMode === "FIXED" && (
                <label className="sim-field">
                  <span className="sim-field__label">USDT per trade</span>
                  <input type="number" className="sim-field__input" min="1" max="100000" step="10"
                    value={config.capitalFixed}
                    onChange={e => set("capitalFixed", parseFloat(e.target.value) || 100)} />
                  <span className="sim-field__hint">mida de posició constant</span>
                </label>
              )}
              {config.capitalMode === "PCT" && (
                <label className="sim-field">
                  <span className="sim-field__label">% capital per trade</span>
                  <input type="number" className="sim-field__input" min="1" max="50" step="1"
                    value={config.capitalPct}
                    onChange={e => set("capitalPct", parseFloat(e.target.value) || 10)} />
                  <span className="sim-field__hint">% del capital disponible</span>
                </label>
              )}
              {config.capitalMode === "ANTI_MARTINGALE" && (
                <label className="sim-field">
                  <span className="sim-field__label">Capital base per trade (%)</span>
                  <input type="number" min="10" max="100" step="5"
                    value={config.amBasePct}
                    onChange={e => set("amBasePct", parseFloat(e.target.value) || 60)} />
                  <span className="sim-field__hint">% del capital quan no hi ha pèrdues consecutives</span>
                </label>
              )}
            </div>
            {config.capitalMode === "ANTI_MARTINGALE" && (
              <div className="sim-am-ladder">
                <div>0–1 SL: {config.amBasePct}%</div>
                <div>2 SL: {(config.amBasePct / 2).toFixed(0)}%</div>
                <div>3+ SL: {(config.amBasePct / 4).toFixed(0)}%</div>
              </div>
            )}
          </div>
        </div>

        {/* Mode d'entrada */}
        <div className="sim-box-section">
          <div className="sim-section-label">
            <i className="fa-solid fa-sign-in-alt" /> Mode d&apos;entrada
          </div>
          <div className="sim-exit-mode-row">
            <button onClick={() => set("entryMode", "ANALYSIS")}
              className={`sim-exit-mode-btn${config.entryMode === "ANALYSIS" ? " sim-exit-mode-btn--on" : ""}`}>
              <i className="fa-solid fa-chart-line" /> Anàlisi tècnica
            </button>
            <button onClick={() => set("entryMode", "PUMP")}
              className={`sim-exit-mode-btn${config.entryMode === "PUMP" ? " sim-exit-mode-btn--on" : ""}`}>
              🚀 Pump / Volum
            </button>
            <button onClick={() => set("entryMode", "CANDLES")}
              className={`sim-exit-mode-btn${config.entryMode === "CANDLES" ? " sim-exit-mode-btn--on" : ""}`}>
              🕯️ Candlesticks
            </button>
          </div>
          <div className="sim-exit-mode-desc">
            {config.entryMode === "ANALYSIS" && "EMA200 + ADX + RSI + MACD. Confirma tendència alcista establerta."}
            {config.entryMode === "PUMP" && "Volum anormal + vela verda + tancament fort. No usa indicadors de tendència."}
            {config.entryMode === "CANDLES" && "Patrons de candlestick japonesos clàssics. Entra quan es detecta un patró bullish amb prou confiança."}
          </div>
          {config.entryMode === "PUMP" && (
            <label className="sim-field">
              <span className="sim-field__label">Filtre volum mínim (× vol. mitjà)</span>
              <input type="number" className="sim-field__input" min="1" max="10" step="0.5"
                value={config.pumpVolMin}
                onChange={e => set("pumpVolMin", parseFloat(e.target.value) || 3)} />
            </label>
          )}
          {config.entryMode === "CANDLES" && (
            <div className="sim-candles-block">
              <label className="sim-field">
                <span className="sim-field__label">Confiança mínima del patró (%)</span>
                <input type="number" className="sim-field__input" min="50" max="95" step="5"
                  value={(config as unknown as Record<string, number>).candlePatternScore ?? 70}
                  onChange={e => set("candlePatternScore" as keyof typeof config, parseFloat(e.target.value) || 70)} />
              </label>
              <div className="sim-field__label" style={{ marginBottom: "0.4rem" }}>Patrons actius (buit = tots):</div>
              <div className="sim-candles-patterns">
                {ALL_CANDLE_PATTERNS.map(name => {
                  const active = ((config as unknown as Record<string, string[]>).candlePatterns ?? []).includes(name);
                  return (
                    <button key={name}
                      className={`sim-candle-pat-btn${active ? " sim-candle-pat-btn--on" : ""}`}
                      onClick={() => {
                        const cur: string[] = (config as unknown as Record<string, string[]>).candlePatterns ?? [];
                        const next = active ? cur.filter(n => n !== name) : [...cur, name];
                        set("candlePatterns" as keyof typeof config, next as unknown as typeof config[keyof typeof config]);
                      }}>
                      {name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Estratègia de sortida */}
        <div className="sim-box-section">
          <div className="sim-section-label"><i className="fa-solid fa-door-open" /> Estratègia de sortida</div>
          <div className="sim-section-body">
            <div className="sim-exit-mode-row" style={{ marginBottom: "0.5rem" }}>
              <button
                className={`sim-exit-mode-btn${config.exitMode === "LET_RUN" ? " sim-exit-mode-btn--on" : ""}`}
                onClick={() => {
                  const def = ATR_DEFAULTS[config.interval] ?? ATR_DEFAULTS["1h"];
                  setConfig(prev => ({ ...prev, exitMode: "LET_RUN", trailDistanceAtr: def.letRunTrailDist, breakEvenAtr: def.breakEven, maxHoldingBars: 300 }));
                }}
              >
                <i className="fa-solid fa-rocket" /> Let it Run ★
              </button>
              <button
                className={`sim-exit-mode-btn${config.exitMode === "BREAK_EVEN" ? " sim-exit-mode-btn--on" : ""}`}
                onClick={() => {
                  const def = ATR_DEFAULTS[config.interval] ?? ATR_DEFAULTS["1h"];
                  setConfig(prev => ({ ...prev, exitMode: "BREAK_EVEN", trailDistanceAtr: def.trailDist, breakEvenAtr: def.breakEven, maxHoldingBars: 20 }));
                }}
              >
                <i className="fa-solid fa-shield-halved" /> Break-Even
              </button>
              <button
                className={`sim-exit-mode-btn${config.exitMode === "TRAILING" ? " sim-exit-mode-btn--on" : ""}`}
                onClick={() => {
                  const def = ATR_DEFAULTS[config.interval] ?? ATR_DEFAULTS["1h"];
                  setConfig(prev => ({ ...prev, exitMode: "TRAILING", trailDistanceAtr: def.trailDist, maxHoldingBars: 20 }));
                }}
              >
                <i className="fa-solid fa-route" /> Trailing SL
              </button>
              <button
                className={`sim-exit-mode-btn${config.exitMode === "MOON" ? " sim-exit-mode-btn--on" : ""}`}
                onClick={() => setConfig(prev => ({ ...prev, exitMode: "MOON", maxHoldingBars: 500 }))}
              >
                🌙 Moon
              </button>
            </div>
            <div className="sim-exit-mode-desc">
              {config.exitMode === "LET_RUN" &&
                "SL inicial fix → quan preu ≥ +B/E ATR mou SL a entrada i arrenca trailing AMPLI (sense TP fix). Captura tendències del 30-50%."}
              {config.exitMode === "BREAK_EVEN" &&
                "Quan preu arriba a +N×ATR mou SL exactament al preu d'entrada. TP fix actiu."}
              {config.exitMode === "TRAILING" &&
                "OCO clàssic: TP fix + SL fix. Quan preu ≥ activació, canvia a trailing SL."}
              {config.exitMode === "MOON" &&
                "Meme/pump coins: entra amb volum anormal, ven 50% al 2×, trailing del moon bag fins que el mercat giri."}
            </div>
          </div>
        </div>

        {/* Paràmetres de sortida (ATR o Moon segons mode) */}
        <div className="sim-box-section">
          <div className="sim-section-label">
            {config.exitMode === "MOON"
              ? <><span>🌙</span> Paràmetres Moon</>
              : <><i className="fa-solid fa-sliders" /> Paràmetres ATR
                  <span style={{ color: "var(--text-3)", fontWeight: 400, fontSize: "0.72rem" }}>
                    &nbsp;· canvien automàticament amb l&apos;interval
                  </span>
                </>
            }
          </div>
          <div className="sim-section-body">
            <div className="sim-config-grid">
              <label className="sim-field">
                <span className="sim-field__label">Timeout (veles)</span>
                <input type="number" className="sim-field__input" min="1" max="2000" step="1"
                  value={config.maxHoldingBars}
                  onChange={e => set("maxHoldingBars", parseInt(e.target.value) || 8)} />
                <span className="sim-field__hint">tanca forçosament si no hi ha sortida</span>
              </label>
              {config.exitMode === "MOON" ? (<>
                <label className="sim-field">
                  <span className="sim-field__label">SL inicial (% sota entrada)</span>
                  <input type="number" className="sim-field__input" min="5" max="50" step="1"
                    value={config.moonSlPct}
                    onChange={e => set("moonSlPct", parseFloat(e.target.value) || 25)} />
                  <span className="sim-field__hint">entrada × (1 − SL%)</span>
                </label>
                <label className="sim-field">
                  <span className="sim-field__label">Parcial a (× preu entrada)</span>
                  <input type="number" className="sim-field__input" min="1.1" max="10" step="0.1"
                    value={config.moonPartialAt}
                    onChange={e => set("moonPartialAt", parseFloat(e.target.value) || 2)} />
                  <span className="sim-field__hint">ven parcial quan preu = entrada × N</span>
                </label>
                <label className="sim-field">
                  <span className="sim-field__label">Vendre parcial (% posició)</span>
                  <input type="number" className="sim-field__input" min="10" max="90" step="5"
                    value={config.moonPartialPct}
                    onChange={e => set("moonPartialPct", parseFloat(e.target.value) || 50)} />
                  <span className="sim-field__hint">% a vendre al parcial · la resta = moon bag</span>
                </label>
                <label className="sim-field">
                  <span className="sim-field__label">Trailing bag (% del màxim)</span>
                  <input type="number" className="sim-field__input" min="3" max="50" step="1"
                    value={config.moonTrailPct}
                    onChange={e => set("moonTrailPct", parseFloat(e.target.value) || 20)} />
                  <span className="sim-field__hint">SL = peak × (1 − trail%)</span>
                </label>
              </>) : (<>
                <label className="sim-field">
                  <span className="sim-field__label">TP (× ATR)</span>
                  <input type="number" className="sim-field__input" min="0.5" max="10" step="0.5"
                    value={config.tpAtr}
                    onChange={e => set("tpAtr", parseFloat(e.target.value) || 2)} />
                  <span className="sim-field__hint">entrada + N×ATR</span>
                </label>
                <label className="sim-field">
                  <span className="sim-field__label">SL inicial (× ATR)</span>
                  <input type="number" className="sim-field__input" min="0.25" max="10" step="0.25"
                    value={config.slAtr}
                    onChange={e => set("slAtr", parseFloat(e.target.value) || 1)} />
                  <span className="sim-field__hint">entrada − N×ATR</span>
                </label>
                {config.exitMode === "LET_RUN" && (<>
                  <label className="sim-field">
                    <span className="sim-field__label">Activació B/E + Trail (× ATR)</span>
                    <input type="number" className="sim-field__input" min="0.5" max="10" step="0.5"
                      value={config.breakEvenAtr}
                      onChange={e => set("breakEvenAtr", parseFloat(e.target.value) || 2)} />
                    <span className="sim-field__hint">quan preu ≥ entrada + N×ATR → B/E + trailing</span>
                  </label>
                  <label className="sim-field">
                    <span className="sim-field__label">Distància trailing ampla (× ATR)</span>
                    <input type="number" className="sim-field__input" min="1" max="15" step="0.5"
                      value={config.trailDistanceAtr}
                      onChange={e => set("trailDistanceAtr", parseFloat(e.target.value) || 4)} />
                    <span className="sim-field__hint">SL = peak − N×ATR · ampli per capturar tendències</span>
                  </label>
                </>)}
                {config.exitMode === "TRAILING" && (<>
                  <label className="sim-field">
                    <span className="sim-field__label">Activació trailing (× ATR)</span>
                    <input type="number" className="sim-field__input" min="0" max="10" step="0.5"
                      value={config.trailActivateAtr}
                      onChange={e => set("trailActivateAtr", parseFloat(e.target.value) || 1.5)} />
                    <span className="sim-field__hint">entrada + N×ATR activa el trailing</span>
                  </label>
                  <label className="sim-field">
                    <span className="sim-field__label">Distància trailing (× ATR)</span>
                    <input type="number" className="sim-field__input" min="0.25" max="10" step="0.25"
                      value={config.trailDistanceAtr}
                      onChange={e => set("trailDistanceAtr", parseFloat(e.target.value) || 1)} />
                    <span className="sim-field__hint">SL = peak − N×ATR</span>
                  </label>
                </>)}
                {config.exitMode === "BREAK_EVEN" && (
                  <label className="sim-field">
                    <span className="sim-field__label">Break-Even a (× ATR)</span>
                    <input type="number" className="sim-field__input" min="0.25" max="10" step="0.25"
                      value={config.breakEvenAtr}
                      onChange={e => set("breakEvenAtr", parseFloat(e.target.value) || 1.5)} />
                    <span className="sim-field__hint">mou SL a entrada quan preu ≥ entrada + N×ATR</span>
                  </label>
                )}
              </>)}
            </div>
          </div>
        </div>

      </div>

      </div>{/* /sim-col--config */}

      <div className="sim-col sim-col--results">

      {/* ── Error ─────────────────────────────────────────────────────── */}
      {error && (
        <div className="sim-error">
          <i className="fa-solid fa-circle-exclamation" /> {error}
        </div>
      )}

      {/* ── Results ───────────────────────────────────────────────────── */}
      {result && stats && (
        <div className="sim-results" ref={resultRef}>

          {/* Capçalera resultats + botó exportació */}
          <div className="sim-results-header">
            <div className="portfolio__section-title" style={{ margin: 0 }}>
              <i className="fa-solid fa-chart-mixed" /> Resultats de la simulació
            </div>
            <button className="sim-export-btn" onClick={exportSimulation}>
              <i className="fa-solid fa-file-export" /> Exportar per a IA
            </button>
            {exportMsg && (
              <span className="sim-export-msg">
                <i className="fa-solid fa-circle-check" /> {exportMsg}
              </span>
            )}
          </div>

          {/* 3 stat cards */}
          <div className="portfolio__cards">
            <div className="portfolio__card portfolio__card--blue">
              <span className="portfolio__card-label">
                <i className="fa-solid fa-coins" /> Capital final
              </span>
              <span className="portfolio__card-value mono">${fmtNum(stats.finalCapital, 0)}</span>
              <span className="portfolio__card-sub">
                inici ${fmtNum(config.initialCapital, 0)} · {config.from} → {config.to}
              </span>
            </div>

            <div className={`portfolio__card portfolio__card--${pnlUp ? "green" : "red"}`}>
              <span className="portfolio__card-label">
                <i className={`fa-solid fa-arrow-trend-${pnlUp ? "up" : "down"}`} /> P&amp;L Total
              </span>
              <span className="portfolio__card-value mono">
                {pnlUp ? "+" : ""}{fmtNum(stats.totalPnl)} $
              </span>
              <span className={`portfolio__card-sub portfolio__card-sub--${pnlUp ? "up" : "down"}`}>
                {stats.totalPnlPct >= 0 ? "+" : ""}{fmtNum(stats.totalPnlPct)}%
              </span>
            </div>

            <div className="portfolio__card portfolio__card--neutral">
              <span className="portfolio__card-label">
                <i className="fa-solid fa-list-check" /> Operacions
              </span>
              <span className="portfolio__card-value">{stats.totalTrades}</span>
              <span className="portfolio__card-sub">
                {stats.wins}✓ guany&nbsp; {stats.losses}✗ pèrdua
                &nbsp;·&nbsp;{config.symbols.length} parell{config.symbols.length > 1 ? "s" : ""}
              </span>
            </div>
          </div>

          {/* Detail metrics */}
          <div className="analysis-section">
            <div className="portfolio__section-title">
              <i className="fa-solid fa-gauge-high" /> Indicadors de rendiment
            </div>
            <div className="sim-metrics-row">
              <div className="metric-col">
                <span className="metric-col__label"><i className="fa-solid fa-bullseye" /> Win Rate</span>
                <span className="metric-col__value" style={{ color: stats.winRate >= 50 ? "var(--green)" : "var(--red)" }}>
                  {fmtNum(stats.winRate, 1)}%
                </span>
              </div>
              <div className="metric-col">
                <span className="metric-col__label"><i className="fa-solid fa-scale-balanced" /> Profit Factor</span>
                <span className="metric-col__value" style={{ color: stats.profitFactor >= 1 ? "var(--green)" : "var(--red)" }}>
                  {fmtNum(stats.profitFactor, 2)}
                </span>
              </div>
              <div className="metric-col">
                <span className="metric-col__label"><i className="fa-solid fa-arrow-trend-down" /> Max Drawdown</span>
                <span className="metric-col__value" style={{ color: stats.maxDrawdown > 20 ? "var(--red)" : stats.maxDrawdown > 10 ? "#d97706" : "var(--green)" }}>
                  {fmtNum(stats.maxDrawdown, 1)}%
                </span>
              </div>
              <div className="metric-col">
                <span className="metric-col__label"><i className="fa-solid fa-circle-plus" /> Guany mig</span>
                <span className="metric-col__value" style={{ color: "var(--green)" }}>+${fmtNum(stats.avgWin)}</span>
              </div>
              <div className="metric-col">
                <span className="metric-col__label"><i className="fa-solid fa-circle-minus" /> Pèrdua mitja</span>
                <span className="metric-col__value" style={{ color: "var(--red)" }}>-${fmtNum(stats.avgLoss)}</span>
              </div>
              <div className="metric-col">
                <span className="metric-col__label"><i className="fa-solid fa-receipt" /> Comissions</span>
                <span className="metric-col__value" style={{ color: "var(--red)" }}>
                  -{fmtNum(stats.totalCommission)} $
                </span>
              </div>
              <div className="metric-col">
                <span className="metric-col__label"><i className="fa-solid fa-chart-bar" /> Veles simulades</span>
                <span className="metric-col__value">{stats.candlesUsed}</span>
              </div>
              {config.capitalMode === "ANTI_MARTINGALE" && (
                <div className="metric-col">
                  <span className="metric-col__label"><i className="fa-solid fa-stairs" /> AM reduccions</span>
                  <span className="metric-col__value" style={{ color: stats.amReductions > 0 ? "#d97706" : "var(--text-3)" }}>
                    {stats.amReductions}×
                  </span>
                </div>
              )}
              {config.exitMode === "MOON" && stats.moonPartialHits !== undefined && (
                <div className="metric-col">
                  <span className="metric-col__label">🌙 Parcials (2×)</span>
                  <span className="metric-col__value" style={{ color: stats.moonPartialHits > 0 ? "var(--green)" : "var(--text-3)" }}>
                    {stats.moonPartialHits}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Trades + sidebar dret (corba + P&L per parell) */}
          <div className="analysis-section analysis-section--flush">
            <div className="sim-trades-layout">
              <div className="sim-trades-layout__table">
                <div className="portfolio__section-title">
                  <i className="fa-solid fa-list" /> Historial d&apos;operacions simulades
                  <span className="sim-title-badge">{stats.totalTrades}</span>
                </div>
                <TradesTable trades={result.trades} />
              </div>
              <div className="sim-trades-sidebar">
                {result.equityCurve.length > 1 && (
                  <div className="sim-trades-sidebar__equity">
                    <div className="sim-symbol-chart__title">
                      <i className="fa-solid fa-chart-line" /> Corba de capital
                    </div>
                    <div className="sim-chart-inner" style={{ padding: "0.5rem 0 0.25rem" }}>
                      <EquityChart
                        curve={result.equityCurve}
                        btcCurve={result.btcCurve ?? []}
                        initialCapital={config.initialCapital}
                      />
                    </div>
                  </div>
                )}
                <SymbolPnlChart trades={result.trades} />
              </div>
            </div>
          </div>

          {/* Paràmetres efectius — al final */}
          <div className="analysis-section analysis-section--flush">
            <EffectiveConfigPanel cfg={result.effectiveConfig} simConfig={config} />
          </div>

        </div>
      )}

      {/* Empty state */}
      {!result && !loading && !error && (
        <div className="sim-empty">
          <i className="fa-solid fa-flask-vial sim-empty__icon" />
          <div className="sim-empty__title">Configura i executa la simulació</div>
          <div className="sim-empty__sub">
            Selecciona els parells, interval i rang de dates. El motor llegirà automàticament
            la configuració real (ATR, capital, probabilitat mínima) i simularà les entrades
            amb la mateixa lògica d&apos;anàlisi: direcció, context i trigger.
          </div>
        </div>
      )}

      </div>{/* /sim-col--results */}

    </div>
    </>
  );
}
