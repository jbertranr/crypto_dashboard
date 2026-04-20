import { NextRequest, NextResponse } from "next/server";
import { analyzeAll, OHLCV } from "../../../lib/indicators";
import { settingGetAll } from "../../../lib/settings-store";
import { apiError } from "../../../lib/api-error";
import { candleUpsertBatch, candleGetRange, candleCoveredRange } from "../../../lib/candle-store";
import { detectCandlePatterns } from "../../../lib/candle-patterns";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ExitMode     = "TRAILING" | "BREAK_EVEN" | "LET_RUN" | "MOON";
export type CapitalMode  = "FIXED" | "PCT" | "RISK_PCT" | "ANTI_MARTINGALE";
export type EntryMode    = "ANALYSIS" | "PUMP" | "CANDLES";

export interface SimConfig {
  symbols:          string[];
  interval:         string;
  from:             number;
  to:               number;
  initialCapital:   number;
  // Capital sizing
  capitalMode:      CapitalMode;
  capitalFixed:     number;   // USDT per trade (FIXED)
  capitalPct:       number;   // % del capital per trade (PCT)
  riskPct:          number;   // % del capital a arriscar si salta el SL (RISK_PCT)
  // Filtre de mercat (anti-bajista)
  useMarketFilter:  boolean;  // true → bloqueja entrades si preu < EMA200 diari del símbol
  // Anti-Martingala
  amBasePct:        number;   // % base del capital per trade (defecte 60)
  // Mode d'entrada
  entryMode:        EntryMode;
  pumpVolMin:       number;    // Mínim volRatio per a entrada PUMP (default 3.0)
  // Mode d'entrada CANDLES
  candlePatterns:     string[]; // patrons actius; [] = tots
  candlePatternScore: number;   // confiança mínima (default 70)
  // Estratègia de sortida
  exitMode:         ExitMode;
  tpAtr:            number;
  slAtr:            number;
  trailActivateAtr: number;
  trailDistanceAtr: number;
  breakEvenAtr:     number;
  // Timeout
  maxHoldingBars:   number;   // veles màxim abans del tancament forçós
  // Filtres d'entrada (ANALYSIS mode)
  minProbability?:  number;   // Probabilitat mínima d'entrada (0–100)
  maxOpen?:         number;   // Màx. posicions simultànies
  // Mode MOON
  moonSlPct:        number;   // SL inicial % sota entrada (default 20)
  moonPartialAt:    number;   // Multiplicador preu per parcial (default 2.0)
  moonPartialPct:   number;   // % de la posició a vendre al parcial (default 50)
  moonTrailPct:     number;   // Trailing % del màxim per al moon bag (default 15)
}

export interface SlMove {
  time:      number;
  peakPrice: number;
  sl:        number;
}

export interface LayerScores {
  direction: number;  // 0–100 (EMA200 / ADX / DI)
  context:   number;  // 0–100 (RSI / Volume / Range)
  trigger:   number;  // 0–100 (MACD / RSI / RelVol)
}

export interface SimTrade {
  symbol:             string;
  entryTime:          number;
  exitTime:           number;
  entryPrice:         number;
  exitPrice:          number;
  tp:                 number;
  initialSl:          number;
  peakPrice:          number;
  trailDist:          number;
  trailActive:        boolean;
  breakEvenActivated: boolean;
  slMoves:            SlMove[];
  result:             "TP" | "SL" | "BREAK_EVEN" | "TRAILING_SL" | "LET_RUN_SL" | "TIMEOUT"
                    | "MOON_SL" | "MOON_PARTIAL_SL" | "MOON_PARTIAL_TIMEOUT" | "MOON_TIMEOUT";
  tradeCapital:       number;
  commission:         number;
  pnlUsdt:            number;
  pnlPct:             number;
  capitalAfter:       number;
  score:              number;
  probability:        number;
  stratConfidence:    string;
  stratName:          string;
  layerScores:        LayerScores;
  // MOON optional fields
  partialExitPrice?:  number;
  partialExitPnl?:    number;
  moonBagCapital?:    number;
}

export interface SimStats {
  totalTrades:   number;
  wins:          number;
  losses:        number;
  winRate:       number;
  totalPnl:      number;
  totalPnlPct:   number;
  maxDrawdown:   number;
  avgWin:        number;
  avgLoss:       number;
  profitFactor:  number;
  finalCapital:     number;
  candlesUsed:      number;
  totalCommission:  number;
  amReductions:     number;   // vegades que la mida es va reduir per pèrdua consecutiva
  moonPartialHits?: number;   // trades que van arribar al parcial (MOON mode)
}

// Internal open-trade state (not serialised)
interface OpenTrade {
  symbol:             string;
  entryTi:            number;
  entryTime:          number;
  entryPrice:         number;
  tp:                 number;
  fixedSl:            number;
  currentSl:          number;
  activateAt:         number;   // TRAILING: nivell d'activació
  breakEvenAt:        number;   // BREAK_EVEN: nivell de break-even
  breakEvenActivated: boolean;
  trailDist:          number;
  peakPrice:          number;
  trailActive:        boolean;
  slMoves:            SlMove[];
  tradeCapital:       number;
  score:              number;
  probability:        number;
  stratConfidence:    string;
  stratName:          string;
  layerScores:        LayerScores;
  // MOON mode state
  moonPartialDone?:            boolean;
  moonBagCapital?:             number;
  moonPartialExitPnl?:         number;   // partialGrossPnl - partialExitComm
  moonPartialExitComm?:        number;   // commission on partial sale
  moonPartialExitPrice?:       number;
  moonPartialReturnedCapital?: number;   // capital already added to `capital` at partial exit
}

// ── Paràmetres ATR per defecte per TF ─────────────────────────────────────────

/** Mapeig interval → TF de la clau de settings */
const PRESET_TF: Record<string, string> = {
  "1d": "4h", "4h": "4h", "1h": "1h", "30m": "1h", "15m": "5m",
};

/** Valors per defecte (mirrors TF_PRESETS de SettingsTab.tsx) */
export const TF_ATR_DEFAULTS: Record<string, {
  tp: number; sl: number; trailAct: number; trailDist: number;
  breakEven: number; letRunTrailDist: number;
}> = {
  "5m": { tp: 1.5, sl: 1.5,  trailAct: 1.0, trailDist: 2.5,  breakEven: 1.0, letRunTrailDist: 2.5 },
  "1h": { tp: 2.5, sl: 1.0,  trailAct: 1.5, trailDist: 1.0,  breakEven: 2.0, letRunTrailDist: 3.0 },
  "4h": { tp: 3.0, sl: 1.5,  trailAct: 2.0, trailDist: 1.5,  breakEven: 2.0, letRunTrailDist: 4.0 },
};

function getSettingsAtr(settings: Record<string, string>, interval: string) {
  const tf  = PRESET_TF[interval] ?? "1h";
  const def = TF_ATR_DEFAULTS[tf] ?? TF_ATR_DEFAULTS["1h"];
  const key = (p: string) => `${p}__MARKET__${tf}`;
  return {
    tpAtr:            parseFloat(settings[key("oco_tp_atr")]            ?? "") || def.tp,
    slAtr:            parseFloat(settings[key("oco_sl_atr")]            ?? "") || def.sl,
    trailActivateAtr: parseFloat(settings[key("trailing_activate_atr")] ?? "") || def.trailAct,
    trailDistanceAtr: parseFloat(settings[key("trailing_distance_atr")] ?? "") || def.trailDist,
    breakEvenAtr:     def.breakEven,
  };
}

// ── Probabilitat d'entrada ────────────────────────────────────────────────────

const INTERVAL_BONUS: Record<string, number> = {
  "1d": 10, "4h": 10, "1h": 5, "30m": 2, "15m": 0,
};
const CONF_BONUS: Record<string, number> = {
  alta: 10, moderada: 5, baixa: 0,
};

function computeProbability(score: number, interval: string, confidence: string): number {
  return Math.min(95, Math.round(
    score * 0.7 + (INTERVAL_BONUS[interval] ?? 0) + (CONF_BONUS[confidence] ?? 0),
  ));
}

// ── EMA helper ───────────────────────────────────────────────────────────────
function calcEMASeries(closes: number[], period: number): number[] {
  if (closes.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [closes[0]];
  for (let i = 1; i < closes.length; i++) {
    out.push(closes[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

/** Retorna l'EMA(200) diari vigent en el moment `time` per al símbol, o null si no n'hi ha prou dades */
function getEma200AtTime(
  sorted: { time: number; ema: number }[],
  time: number,
): number | null {
  let result: number | null = null;
  for (const entry of sorted) {
    if (entry.time <= time) result = entry.ema;
    else break;
  }
  return result;
}

// ── Intervals ─────────────────────────────────────────────────────────────────

const INTERVAL_MS: Record<string, number> = {
  "15m":  15 * 60_000,
  "30m":  30 * 60_000,
  "1h":   60 * 60_000,
  "4h":  240 * 60_000,
  "1d": 1440 * 60_000,
};

// ── Fetch candles (raw Binance) ───────────────────────────────────────────────

async function fetchCandlesFromBinance(
  symbol: string, interval: string, startMs: number, endMs: number
): Promise<OHLCV[]> {
  const msPerBar = INTERVAL_MS[interval] ?? INTERVAL_MS["1h"];
  const all: OHLCV[] = [];
  let batchStart = startMs;
  let safety = 0;

  while (batchStart < endMs && safety < 30) {
    safety++;
    const url = [
      "https://api.binance.com/api/v3/klines",
      `?symbol=${symbol}&interval=${interval}`,
      `&startTime=${batchStart}&endTime=${endMs}&limit=1000`,
    ].join("");

    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`Binance error ${res.status} fetching ${symbol} ${interval}`);

    const raw: unknown[][] = await res.json();
    if (raw.length === 0) break;

    for (const k of raw) {
      all.push({
        time:   k[0] as number,
        open:   parseFloat(k[1] as string),
        high:   parseFloat(k[2] as string),
        low:    parseFloat(k[3] as string),
        close:  parseFloat(k[4] as string),
        volume: parseFloat(k[5] as string),
      });
    }

    batchStart = (raw[raw.length - 1][0] as number) + msPerBar;
    if (raw.length < 1000) break;
  }

  return all;
}

// ── Fetch candles with persistent SQLite cache ────────────────────────────────

async function fetchCandlesCached(
  symbol: string, interval: string, startMs: number, endMs: number
): Promise<OHLCV[]> {
  const msPerBar = INTERVAL_MS[interval] ?? INTERVAL_MS["1h"];

  // Candles before this timestamp are immutable (the current bar is still open)
  const currentBarStart = Math.floor(Date.now() / msPerBar) * msPerBar;
  const closedUntil = currentBarStart - 1;

  const cacheEnd = Math.min(endMs, closedUntil);

  if (cacheEnd >= startMs) {
    const covered = candleCoveredRange(symbol, interval);
    const rangesToFetch: Array<[number, number]> = [];

    if (!covered) {
      rangesToFetch.push([startMs, cacheEnd]);
    } else {
      if (startMs < covered.min) {
        rangesToFetch.push([startMs, Math.min(covered.min - 1, cacheEnd)]);
      }
      if (covered.max < cacheEnd) {
        rangesToFetch.push([covered.max + msPerBar, cacheEnd]);
      }
    }

    for (const [from, to] of rangesToFetch) {
      if (from > to) continue;
      const candles = await fetchCandlesFromBinance(symbol, interval, from, to);
      const closed = candles.filter(c => c.time <= closedUntil);
      if (closed.length > 0) candleUpsertBatch(symbol, interval, closed);
    }
  }

  // Read closed candles from SQLite
  const result: OHLCV[] = cacheEnd >= startMs
    ? candleGetRange(symbol, interval, startMs, cacheEnd)
    : [];

  // Append current (live) bar if the request includes it
  if (endMs > closedUntil) {
    const live = await fetchCandlesFromBinance(symbol, interval, currentBarStart, endMs);
    result.push(...live);
  }

  return result;
}

const COMMISSION_RATE = 0.001; // 0.1% per compra i per venda

// ── POST /api/simulation/run ──────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const config: SimConfig = await req.json();
    const {
      symbols, interval, from, to, initialCapital,
      capitalMode, capitalFixed, capitalPct, riskPct,
      useMarketFilter,
      amBasePct,
      exitMode, tpAtr, slAtr, trailActivateAtr, trailDistanceAtr, breakEvenAtr,
    } = config;
    const entryMode          = config.entryMode          ?? "ANALYSIS";
    const pumpVolMin         = config.pumpVolMin         ?? 3.0;
    const candlePatterns     = config.candlePatterns     ?? [];
    const candlePatternScore = config.candlePatternScore ?? 70;
    const moonSlPct      = config.moonSlPct      ?? 25;
    const moonPartialAt  = config.moonPartialAt  ?? 2.0;
    const moonPartialPct = config.moonPartialPct ?? 50;
    const moonTrailPct   = config.moonTrailPct   ?? 20;

    if (!symbols?.length || !interval || !from || !to || !initialCapital) {
      return NextResponse.json({ error: "Falten camps obligatoris" }, { status: 400 });
    }
    if (to <= from) {
      return NextResponse.json({ error: "'to' ha de ser posterior a 'from'" }, { status: 400 });
    }

    // ── maxOpen i minProbability: primer del body, fallback a settings ──────────
    const settings       = settingGetAll();
    const maxOpen        = config.maxOpen        ?? (parseInt(settings.capital_max_open       ?? "3")  || 3);
    const minProbability = config.minProbability ?? (parseFloat(settings.auto_trade_min_score ?? "70") || 70);

    // ── Descarrega veles ───────────────────────────────────────────────────
    const msPerBar   = INTERVAL_MS[interval] ?? INTERVAL_MS["1h"];
    const warmupBars = 400;
    const fetchFrom  = from - warmupBars * msPerBar;

    // Sempre inclou BTCUSDT com a referència de mercat (si no és ja als símbolss)
    const fetchSymbols = symbols.includes("BTCUSDT") ? symbols : [...symbols, "BTCUSDT"];

    const fetched = await Promise.all(
      fetchSymbols.map(sym =>
        fetchCandlesCached(sym, interval, fetchFrom, to).then(candles => ({ sym, candles }))
      )
    );

    for (const { sym, candles } of fetched) {
      if (symbols.includes(sym) && candles.length < 50) {
        return NextResponse.json(
          { error: `Dades insuficients per ${sym} (${candles.length} veles)` },
          { status: 422 }
        );
      }
    }

    // ── Mapa de veles i timeline ───────────────────────────────────────────
    const candleMap: Record<string, Map<number, OHLCV>> = {};
    const timeSet = new Set<number>();
    for (const { sym, candles } of fetched) {
      candleMap[sym] = new Map(candles.map(c => [c.time, c]));
      for (const c of candles) timeSet.add(c.time);
    }
    const timeline = [...timeSet].sort((a, b) => a - b);

    // ── Filtre de mercat alcista: EMA(200) diari per símbol ──────────────────
    // Si useMarketFilter=true, es bloquegen entrades quan preu < EMA200 diari
    type Ema200Entry = { time: number; ema: number };
    const dailyEma200: Record<string, Ema200Entry[]> = {};

    if (useMarketFilter) {
      const DAILY_MS     = 24 * 60 * 60_000;
      const dailyWarmup  = 250;                              // dies per escalfar EMA(200)
      const dailyFetchFrom = from - dailyWarmup * DAILY_MS;

      const dailyNeeded = interval === "1d"
        ? symbols    // si ja estem en 1d reutilitzem les veles existents
        : symbols;   // sempre cal fetch diari per la EMA(200)

      await Promise.all(dailyNeeded.map(async sym => {
        let candles: OHLCV[];
        if (interval === "1d" && candleMap[sym]) {
          // Reutilitza les veles diàries ja carregades
          candles = [...(candleMap[sym]?.values() ?? [])].sort((a, b) => a.time - b.time);
        } else {
          candles = await fetchCandlesCached(sym, "1d", dailyFetchFrom, to);
        }
        const closes  = candles.map(c => c.close);
        const emaSeries = calcEMASeries(closes, 200);
        // Guarda només les entrades amb EMA vàlida (a partir de la barra 199)
        dailyEma200[sym] = candles
          .map((c, i) => ({ time: c.time, ema: emaSeries[i] }))
          .filter((_, i) => i >= 199);
      }));
    }

    // ── Corba de preu BTC normalitzada al capital inicial ─────────────────
    const btcCandles = [...(candleMap["BTCUSDT"]?.values() ?? [])]
      .filter(c => c.time >= from && c.time <= to)
      .sort((a, b) => a.time - b.time);
    const firstBtcPrice = btcCandles[0]?.close ?? 1;
    const btcCurve = btcCandles.map(c => ({
      time:  c.time,
      value: initialCapital * (c.close / firstBtcPrice),
    }));

    // ── Estat del backtest ─────────────────────────────────────────────────
    const buffers: Record<string, OHLCV[]> = {};
    for (const sym of symbols) buffers[sym] = [];

    const trades:      SimTrade[]                        = [];
    const equityCurve: { time: number; value: number }[] = [];
    let capital    = initialCapital;
    let simStarted = false;
    const maxHoldingBars = config.maxHoldingBars ?? 8;
    const openTrades = new Map<string, OpenTrade>();

    // ── Anti-Martingala ────────────────────────────────────────────────────
    let consecutiveLosses = 0;
    let amReductions = 0;

    // ── Mostreig corba equity ─────────────────────────────────────────────
    // Target ~500 punts per qualsevol resolució temporal (15m, 1h, 1d…)
    const simCandles    = timeline.filter(t => t >= from).length;
    const equityStride  = Math.max(1, Math.floor(simCandles / 500));
    let lastEquityTi    = -equityStride;  // forcem primer punt al inici

    // ── Bucle principal ────────────────────────────────────────────────────
    for (let ti = 0; ti < timeline.length; ti++) {
      const t = timeline[ti];

      for (const sym of symbols) {
        const c = candleMap[sym]?.get(t);
        if (c) {
          buffers[sym].push(c);
          if (buffers[sym].length > warmupBars) buffers[sym].shift();
        }
      }

      if (t < from) continue;

      if (!simStarted) {
        equityCurve.push({ time: t, value: capital });
        simStarted = true;
        lastEquityTi = ti;
      }

      // ── Gestió de posicions obertes ─────────────────────────────────────
      let equityChanged = false;

      for (const [sym, trade] of openTrades) {
        const candle = candleMap[sym]?.get(t);
        if (!candle) continue;

        const held = ti - trade.entryTi;
        let exitPrice: number | null = null;
        let result: SimTrade["result"] | null = null;

        const holdingLimit = maxHoldingBars;

        if (held >= holdingLimit) {
          exitPrice = candle.close;
          result    = exitMode === "MOON"
            ? (trade.moonPartialDone ? "MOON_PARTIAL_TIMEOUT" : "MOON_TIMEOUT")
            : "TIMEOUT";

        } else if (exitMode === "MOON") {
          // ── Mode To the Moon ──────────────────────────────────────────────
          if (!trade.moonPartialDone) {
            // Fase 1: SL inicial fix
            if (candle.low <= trade.currentSl) {
              exitPrice = trade.currentSl;
              result    = "MOON_SL";
            } else if (candle.high >= trade.entryPrice * moonPartialAt) {
              // Parcial: venda de moonPartialPct% de la posició
              const partialExitPrice    = trade.entryPrice * moonPartialAt;
              const partialCapital      = trade.tradeCapital * moonPartialPct / 100;
              const partialGrossPnl     = partialCapital * (moonPartialAt - 1);
              const partialExitValue    = partialCapital * moonPartialAt;
              const partialExitComm     = partialExitValue * COMMISSION_RATE;
              trade.moonBagCapital      = trade.tradeCapital * (1 - moonPartialPct / 100);
              trade.moonPartialExitPnl  = partialGrossPnl - partialExitComm;
              trade.moonPartialExitComm = partialExitComm;
              trade.moonPartialExitPrice = partialExitPrice;
              trade.moonPartialDone     = true;
              // Reflectim immediatament el capital de la venda parcial a la corba equity
              const partialReturned = partialCapital + (partialGrossPnl - partialExitComm);
              capital += partialReturned;
              trade.moonPartialReturnedCapital = partialReturned;
              equityChanged = true;
              // Trailing del moon bag des del màxim actual
              trade.peakPrice  = candle.high;
              trade.currentSl  = trade.peakPrice * (1 - moonTrailPct / 100);
            }
          } else {
            // Fase 2: SL trailing del moon bag
            if (candle.low <= trade.currentSl) {
              exitPrice = trade.currentSl;
              result    = "MOON_PARTIAL_SL";
            } else if (candle.high > trade.peakPrice) {
              trade.peakPrice = candle.high;
              const newSl = trade.peakPrice * (1 - moonTrailPct / 100);
              if (newSl > trade.currentSl) {
                trade.currentSl = newSl;
                trade.slMoves.push({ time: candle.time, peakPrice: trade.peakPrice, sl: newSl });
              }
            }
          }

        } else if (exitMode === "LET_RUN") {
          // ── Mode Let the Winners Run ───────────────────────────────────
          // Fase 1: SL inicial (sense TP fix). Quan preu ≥ breakEvenAt:
          //   → mou SL a entrada (B/E) + arrenca trailing ampli
          // Fase 2: trailing ampli (sense TP), captura tendències llargues
          if (!trade.breakEvenActivated) {
            if (candle.high >= trade.breakEvenAt) {
              trade.breakEvenActivated = true;
              trade.trailActive        = true;
              trade.peakPrice          = candle.high;
              const newSl = Math.max(trade.entryPrice, trade.peakPrice - trade.trailDist);
              trade.currentSl = newSl;
              trade.slMoves.push({ time: candle.time, peakPrice: trade.peakPrice, sl: newSl });
              if (candle.low <= trade.currentSl) {
                exitPrice = trade.currentSl; result = "LET_RUN_SL";
              }
            } else if (candle.low <= trade.currentSl) {
              exitPrice = trade.currentSl; result = "SL";
            }
          } else {
            if (candle.low <= trade.currentSl) {
              exitPrice = trade.currentSl; result = "LET_RUN_SL";
            } else if (candle.high > trade.peakPrice) {
              trade.peakPrice = candle.high;
              const newSl = trade.peakPrice - trade.trailDist;
              if (newSl > trade.currentSl) {
                trade.currentSl = newSl;
                trade.slMoves.push({ time: candle.time, peakPrice: trade.peakPrice, sl: newSl });
              }
            }
          }

        } else if (exitMode === "BREAK_EVEN") {
          // ── Mode Break-Even ────────────────────────────────────────────
          if (!trade.breakEvenActivated && candle.high >= trade.breakEvenAt) {
            trade.breakEvenActivated = true;
            trade.currentSl = trade.entryPrice;
            trade.slMoves.push({ time: candle.time, peakPrice: candle.high, sl: trade.entryPrice });
          }
          if (candle.high >= trade.tp) {
            exitPrice = trade.tp; result = "TP";
          } else if (candle.low <= trade.currentSl) {
            exitPrice = trade.currentSl;
            result    = trade.breakEvenActivated ? "BREAK_EVEN" : "SL";
          }

        } else {
          // ── Mode Trailing ──────────────────────────────────────────────
          if (!trade.trailActive) {
            if (candle.low <= trade.fixedSl && candle.high >= trade.tp) {
              exitPrice = trade.fixedSl; result = "SL";
            } else if (candle.high >= trade.activateAt) {
              trade.trailActive = true;
              trade.peakPrice   = candle.high;
              const newSl = trade.peakPrice - trade.trailDist;
              if (newSl > trade.currentSl) {
                trade.currentSl = newSl;
                trade.slMoves.push({ time: candle.time, peakPrice: trade.peakPrice, sl: newSl });
              }
              if (candle.low <= trade.currentSl) {
                exitPrice = trade.currentSl; result = "TRAILING_SL";
              }
            } else if (candle.high >= trade.tp) {
              exitPrice = trade.tp; result = "TP";
            } else if (candle.low <= trade.fixedSl) {
              exitPrice = trade.fixedSl; result = "SL";
            }
          } else {
            if (candle.low <= trade.currentSl) {
              exitPrice = trade.currentSl; result = "TRAILING_SL";
            } else if (candle.high > trade.peakPrice) {
              trade.peakPrice = candle.high;
              const newSl = trade.peakPrice - trade.trailDist;
              if (newSl > trade.currentSl) {
                trade.currentSl = newSl;
                trade.slMoves.push({ time: candle.time, peakPrice: trade.peakPrice, sl: newSl });
              }
            }
          }
        }

        if (exitPrice !== null && result !== null) {
          let pnlUsdt: number;
          let commission: number;
          let finalPnlPct: number;
          let partialExitPrice: number | undefined;
          let partialExitPnl: number | undefined;
          let moonBagCapital: number | undefined;

          if (exitMode === "MOON" && trade.moonPartialDone) {
            // Tancament del moon bag
            const entryComm       = trade.tradeCapital * COMMISSION_RATE;
            const moonBag         = trade.moonBagCapital!;
            const moonBagGross    = moonBag * (exitPrice / trade.entryPrice - 1);
            const moonBagExitVal  = moonBag + moonBagGross;
            const moonBagExitComm = moonBagExitVal * COMMISSION_RATE;
            const moonBagPnl      = moonBagGross - moonBagExitComm;
            pnlUsdt     = trade.moonPartialExitPnl! + moonBagPnl - entryComm;
            commission  = entryComm + trade.moonPartialExitComm! + moonBagExitComm;
            finalPnlPct = pnlUsdt / trade.tradeCapital * 100;
            partialExitPrice = trade.moonPartialExitPrice;
            partialExitPnl   = trade.moonPartialExitPnl;
            moonBagCapital   = moonBag;
            // El parcial ja s'havia afegit a capital — revertim-lo i apliquem el pnlUsdt total
            capital -= trade.moonPartialReturnedCapital!;
          } else {
            const pnlPct     = (exitPrice - trade.entryPrice) / trade.entryPrice;
            const grossPnl   = trade.tradeCapital * pnlPct;
            const exitValue  = trade.tradeCapital + grossPnl;
            commission  = trade.tradeCapital * COMMISSION_RATE + exitValue * COMMISSION_RATE;
            pnlUsdt     = grossPnl - commission;
            finalPnlPct = pnlPct * 100;
          }

          capital += pnlUsdt;

          trades.push({
            symbol:             sym,
            entryTime:          trade.entryTime,
            exitTime:           candle.time,
            entryPrice:         trade.entryPrice,
            exitPrice,
            tp:                 trade.tp,
            initialSl:          trade.fixedSl,
            peakPrice:          trade.peakPrice,
            trailDist:          trade.trailDist,
            trailActive:        trade.trailActive,
            breakEvenActivated: trade.breakEvenActivated,
            slMoves:            trade.slMoves,
            result,
            tradeCapital:       trade.tradeCapital,
            commission,
            pnlUsdt,
            pnlPct:             finalPnlPct,
            capitalAfter:       capital,
            score:              trade.score,
            probability:        trade.probability,
            stratConfidence:    trade.stratConfidence,
            stratName:          trade.stratName,
            layerScores:        trade.layerScores,
            partialExitPrice,
            partialExitPnl,
            moonBagCapital,
          });

          openTrades.delete(sym);
          equityChanged = true;

          // ── Anti-Martingala: actualitza pèrdues consecutives ──────────
          if (pnlUsdt < 0) {
            consecutiveLosses++;
            if (consecutiveLosses >= 2) amReductions++;
          } else {
            consecutiveLosses = 0;
          }
        }
      }

      if (equityChanged) {
        equityCurve.push({ time: t, value: capital });
        lastEquityTi = ti;
      } else if (ti - lastEquityTi >= equityStride) {
        equityCurve.push({ time: t, value: capital });
        lastEquityTi = ti;
      }

      // ── Cerca noves entrades ────────────────────────────────────────────
      if (openTrades.size < maxOpen) {
        const nextT = timeline[ti + 1];
        if (nextT !== undefined && nextT <= to) {
          for (const sym of symbols) {
            if (openTrades.size >= maxOpen) break;
            if (openTrades.has(sym)) continue;

            const buf = buffers[sym];
            if (buf.length < 50) continue;

            const nextCandle = candleMap[sym]?.get(nextT);
            if (!nextCandle) continue;

            const analysis = analyzeAll(buf, sym, interval);

            // ── Qualificació de l'entrada segons el mode ─────────────────
            let entryScore:          number;
            let entryProbability:    number;
            let entryStratConfidence: string;
            let entryStratName:      string;
            let entryLayerScores:    LayerScores;

            if (entryMode === "PUMP") {
              // PUMP: entrada per volum anormal + vela verda + tancament fort.
              // Ignora EMA200, ADX i el verdict de l'anàlisi tècnica.

              // 1. Pic de volum anormal
              if ((analysis.relativeVolume ?? 0) < pumpVolMin) continue;

              // 2. Vela verda (close > open)
              const lastBar = buf[buf.length - 1];
              if (lastBar.close <= lastBar.open) continue;

              // 3. Tancament fort: close en el 60% superior del rang de la vela
              const range = lastBar.high - lastBar.low;
              if (range > 0 && lastBar.close < lastBar.low + range * 0.6) continue;

              const volRatio   = analysis.relativeVolume ?? pumpVolMin;
              entryScore           = Math.min(100, Math.round(volRatio * 15));
              entryProbability     = Math.min(95,  entryScore);
              entryStratConfidence = "baixa";
              entryStratName       = "Pump Entry";
              entryLayerScores     = {
                direction: 0,
                context:   Math.min(100, Math.round(volRatio * 20)),
                trigger:   entryScore,
              };

            } else if (entryMode === "CANDLES") {
              // CANDLES: entrada per patrons de candlestick japonesos.
              const detected = detectCandlePatterns(buf);
              const active   = detected.filter(pt =>
                candlePatterns.length === 0 || candlePatterns.includes(pt.name)
              );
              if (active.length === 0) continue;

              const best = active.reduce((a, b) => a.confidence > b.confidence ? a : b);
              if (best.confidence < candlePatternScore) continue;

              // Filtre de mercat alcista opcional (igual que ANALYSIS)
              if (useMarketFilter) {
                const ema200 = getEma200AtTime(dailyEma200[sym] ?? [], t);
                if (ema200 !== null && analysis.price < ema200) continue;
              }

              entryScore           = best.confidence;
              entryProbability     = Math.min(95, best.confidence);
              entryStratConfidence = "baixa";
              entryStratName       = `Candle: ${best.name}`;
              entryLayerScores     = {
                direction: analysis.raw.ema200 > 0 && analysis.price > analysis.raw.ema200 ? 60 : 30,
                context:   analysis.raw.rsi > 30 && analysis.raw.rsi < 70 ? 70 : 40,
                trigger:   best.confidence,
              };

            } else {
              // ANALYSIS: lògica de 3 capes (EMA200, ADX, RSI, MACD…)
              if (analysis.verdict !== "BUY") continue;
              const bestStrategy = analysis.strategies.find(s => s.active && s.type !== "bearish");
              if (!bestStrategy) continue;
              const probability = computeProbability(analysis.score, interval, bestStrategy.confidence);
              if (probability < minProbability) continue;

              // Filtre de mercat alcista: preu > EMA(200) diari
              if (useMarketFilter) {
                const ema200 = getEma200AtTime(dailyEma200[sym] ?? [], t);
                if (ema200 !== null && analysis.price < ema200) continue;
              }

              entryScore           = analysis.score;
              entryProbability     = probability;
              entryStratConfidence = bestStrategy.confidence;
              entryStratName       = bestStrategy.name;
              entryLayerScores     = analysis.layerScores;
            }

            // ── Càlcul de mides i creació del trade ──────────────────────
            const entryPrice   = nextCandle.open;
            const atr          = analysis.atr;
            const trailDist    = atr * trailDistanceAtr;
            const fixedSl      = entryPrice - atr * slAtr;
            const tp           = entryPrice + atr * tpAtr;
            const activateAt   = entryPrice + atr * trailActivateAtr;
            const breakEvenAt  = entryPrice + atr * breakEvenAtr;

            // MOON usa SL %, la resta usa ATR
            const moonInitialSl = entryPrice * (1 - moonSlPct / 100);
            const effectiveSl   = exitMode === "MOON" ? moonInitialSl : fixedSl;

            // RISK_PCT: slDistancePct diferent per MOON (% fix vs ATR)
            const slDistancePct = exitMode === "MOON"
              ? moonSlPct / 100
              : (slAtr * atr) / entryPrice;

            const amFactor = consecutiveLosses >= 3 ? 0.25
                           : consecutiveLosses === 2 ? 0.5
                           : 1.0;
            const rawCapital = capitalMode === "FIXED"
              ? Math.min(capitalFixed, capital)
              : capitalMode === "PCT"
              ? capital * (capitalPct / 100)
              : capitalMode === "ANTI_MARTINGALE"
              ? capital * ((amBasePct ?? 60) / 100) * amFactor
              : slDistancePct > 0   // RISK_PCT
              ? Math.min((capital * (riskPct / 100)) / slDistancePct, capital * 0.5)
              : Math.min(capitalFixed, capital);
            // Per FIXED/PCT/ANTI_MARTINGALE: l'usuari controla la mida directament.
            // Per RISK_PCT: la fórmula ja inclou el cap intern (capital * 0.5).
            const tradeCapital = rawCapital;

            if (tradeCapital <= 0) continue;

            openTrades.set(sym, {
              symbol:             sym,
              entryTi:            ti + 1,
              entryTime:          nextCandle.time,
              entryPrice,
              tp,
              fixedSl:            effectiveSl,
              currentSl:          effectiveSl,
              activateAt,
              breakEvenAt,
              breakEvenActivated: false,
              trailDist,
              peakPrice:          entryPrice,
              trailActive:        false,
              slMoves:            [{ time: nextCandle.time, peakPrice: entryPrice, sl: effectiveSl }],
              tradeCapital,
              score:              entryScore,
              probability:        entryProbability,
              stratConfidence:    entryStratConfidence,
              stratName:          entryStratName,
              layerScores:        entryLayerScores,
              moonPartialDone:    false,
            });
          }
        }
      }
    }

    // ── Force-close al final del període ──────────────────────────────────
    if (openTrades.size > 0) {
      const lastT = timeline[timeline.length - 1];
      for (const [sym, trade] of openTrades) {
        const entries    = [...(candleMap[sym]?.values() ?? [])];
        const lastCandle = candleMap[sym]?.get(lastT) ?? entries[entries.length - 1];
        const exitPrice  = lastCandle.close;

        let pnlUsdt: number;
        let commission: number;
        let finalPnlPct: number;
        let forceResult: SimTrade["result"];
        let partialExitPrice: number | undefined;
        let partialExitPnl: number | undefined;
        let moonBagCapital: number | undefined;

        if (exitMode === "MOON" && trade.moonPartialDone) {
          forceResult = "MOON_PARTIAL_TIMEOUT";
          const entryComm       = trade.tradeCapital * COMMISSION_RATE;
          const moonBag         = trade.moonBagCapital!;
          const moonBagGross    = moonBag * (exitPrice / trade.entryPrice - 1);
          const moonBagExitVal  = moonBag + moonBagGross;
          const moonBagExitComm = moonBagExitVal * COMMISSION_RATE;
          const moonBagPnl      = moonBagGross - moonBagExitComm;
          pnlUsdt     = trade.moonPartialExitPnl! + moonBagPnl - entryComm;
          commission  = entryComm + trade.moonPartialExitComm! + moonBagExitComm;
          finalPnlPct = pnlUsdt / trade.tradeCapital * 100;
          partialExitPrice = trade.moonPartialExitPrice;
          partialExitPnl   = trade.moonPartialExitPnl;
          moonBagCapital   = moonBag;
          // El parcial ja s'havia afegit a capital — revertim-lo i apliquem el pnlUsdt total
          capital -= trade.moonPartialReturnedCapital ?? 0;
        } else {
          forceResult      = exitMode === "MOON" ? "MOON_TIMEOUT" : "TIMEOUT";
          const pnlPct     = (exitPrice - trade.entryPrice) / trade.entryPrice;
          const grossPnl   = trade.tradeCapital * pnlPct;
          const exitValue  = trade.tradeCapital + grossPnl;
          commission  = trade.tradeCapital * COMMISSION_RATE + exitValue * COMMISSION_RATE;
          pnlUsdt     = grossPnl - commission;
          finalPnlPct = pnlPct * 100;
        }

        capital += pnlUsdt;

        trades.push({
          symbol:             sym,
          entryTime:          trade.entryTime,
          exitTime:           lastCandle.time,
          entryPrice:         trade.entryPrice,
          exitPrice,
          tp:                 trade.tp,
          initialSl:          trade.fixedSl,
          peakPrice:          trade.peakPrice,
          trailDist:          trade.trailDist,
          trailActive:        trade.trailActive,
          breakEvenActivated: trade.breakEvenActivated,
          slMoves:            trade.slMoves,
          result:             forceResult,
          tradeCapital:       trade.tradeCapital,
          commission,
          pnlUsdt,
          pnlPct:             finalPnlPct,
          capitalAfter:       capital,
          score:              trade.score,
          probability:        trade.probability,
          stratConfidence:    trade.stratConfidence,
          stratName:          trade.stratName,
          layerScores:        trade.layerScores,
          partialExitPrice,
          partialExitPnl,
          moonBagCapital,
        });
      }
      equityCurve.push({ time: lastT, value: capital });
    }

    trades.sort((a, b) => a.exitTime - b.exitTime);

    // ── Estadístiques ──────────────────────────────────────────────────────
    const wins    = trades.filter(t => t.pnlUsdt > 0);
    const losses  = trades.filter(t => t.pnlUsdt < 0);
    const winPnl  = wins.reduce((s, t) => s + t.pnlUsdt, 0);
    const lossPnl = Math.abs(losses.reduce((s, t) => s + t.pnlUsdt, 0));
    const totalPnl = capital - initialCapital;

    let peak = initialCapital, maxDrawdownPct = 0;
    for (const pt of equityCurve) {
      if (pt.value > peak) peak = pt.value;
      const dd = peak > 0 ? (peak - pt.value) / peak * 100 : 0;
      if (dd > maxDrawdownPct) maxDrawdownPct = dd;
    }

    const moonPartialHits = exitMode === "MOON"
      ? trades.filter(t => t.partialExitPrice !== undefined).length
      : undefined;

    const stats: SimStats = {
      totalTrades:   trades.length,
      wins:          wins.length,
      losses:        losses.length,
      winRate:       trades.length > 0 ? (wins.length / trades.length) * 100 : 0,
      totalPnl,
      totalPnlPct:   (totalPnl / initialCapital) * 100,
      maxDrawdown:   maxDrawdownPct,
      avgWin:        wins.length   > 0 ? winPnl  / wins.length   : 0,
      avgLoss:       losses.length > 0 ? lossPnl / losses.length : 0,
      profitFactor:  lossPnl > 0 ? winPnl / lossPnl : wins.length > 0 ? 99 : 0,
      finalCapital:     capital,
      candlesUsed:      timeline.filter(t => t >= from).length,
      totalCommission:  trades.reduce((s, t) => s + t.commission, 0),
      amReductions,
      moonPartialHits,
    };

    const effectiveConfig = {
      entryMode, pumpVolMin, candlePatterns, candlePatternScore,
      capitalMode, capitalFixed, capitalPct, riskPct, maxOpen, minProbability,
      useMarketFilter,
      amBasePct,
      exitMode, tpAtr, slAtr,
      trailActivateAtr, trailDistanceAtr, breakEvenAtr,
      moonSlPct, moonPartialAt, moonPartialPct, moonTrailPct,
      commissionPct:  COMMISSION_RATE * 100,
      maxHoldingBars,
      warmupBars:     400,
    };

    return NextResponse.json({ trades, equityCurve, btcCurve, stats, effectiveConfig });
  } catch (e) {
    return apiError(e, "simulation/run");
  }
}
