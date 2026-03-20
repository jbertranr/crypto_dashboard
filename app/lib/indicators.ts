// Technical indicator computations (pure functions, no side effects)

export interface OHLCV {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Signal = "bullish" | "neutral" | "bearish";

export interface IndicatorResult {
  name: string;
  value: string;
  signal: Signal;
  detail?: string;
}

export interface AnalysisGroup {
  name: string;
  indicators: IndicatorResult[];
  score: number; // -1 to +1 average
}

export interface TrailingStop {
  activateAt: number;    // Preu en el qual activar el trailing
  activateAtr: number;   // ATRs des d'entrada per activar
  distance: number;      // Distància de seguiment en preu
  distanceAtr: number;   // Distància en ATRs
  logic: string;         // Explicació experta
}

export interface StrategyProposal {
  name: string;
  type: "bullish" | "bearish" | "neutral";
  confidence: "alta" | "moderada" | "baixa";
  keySignal: string;       // Indicador dominant que defineix l'estratègia
  rationale: string[];     // Raonament expert (3-6 línies)
  blockers: string[];      // Factors de risc / advertències
  tp: number;
  sl: number;
  slLimit: number;
  trailing: TrailingStop;
  risk: "baix" | "mig" | "alt";
  active: boolean;         // Condicions base completes
  whyNot: string[];        // Per què no és recomanable (si !active)
}

export type VolatilityClass  = "LOW" | "NORMAL" | "HIGH";
export type TradeDecision    = "IGNORE" | "WATCH" | "PREPARE ENTRY" | "ENTRY SIGNAL";

export interface LayerScores {
  direction: number;   // 0–100  (EMA200 / ADX / DI)
  context:   number;   // 0–100  (RSI / Volume / Range)
  trigger:   number;   // 0–100  (MACD / RSI 5m / RelVol)
}

export interface AnalysisResult {
  symbol: string;
  interval: string;
  price: number;
  score: number;       // 0–100  (current single-TF flat score, kept for backward-compat)
  verdict: "BUY" | "WAIT" | "AVOID";
  groups: AnalysisGroup[];
  strategies: StrategyProposal[];
  candles: OHLCV[];    // últimes 80 veles per al gràfic
  atr: number;
  suggestedTP: number;
  suggestedSL: number;
  suggestedSLLimit: number;
  // ── v2 enriched fields ──
  relativeVolume:       number;          // currentVol / avg20Vol
  volatilityClass:      VolatilityClass;
  distanceToResistance: number;          // (resistance – price) / price  (0..N)
  pivotLow:             number | null;   // most-recent swing low for SL placement
  layerScores:          LayerScores;     // sub-scores per timeframe role
  tradeDecision:        TradeDecision;   // 4-state output
  // Raw numeric values for MTF dashboard
  raw: {
    rsi:      number;
    adx:      number;
    plusDI:   number;
    minusDI:  number;
    sma20:    number;
    sma50:    number;
    ema9:     number;
    ema21:    number;
    ema200:   number;
    macdBull: boolean;
    rangePct: number;
    volRatio: number;
    stochK:   number;
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Detect pivot lows (swing lows). Returns most recent pivot-low price, or null. */
export function calcPivotLow(candles: OHLCV[]): number | null {
  for (let i = candles.length - 2; i >= 1; i--) {
    if (candles[i].low < candles[i - 1].low && candles[i].low < candles[i + 1].low) {
      return candles[i].low;
    }
  }
  return null;
}

/** Returns the nearest swing-high resistance above current price. */
function calcResistance(candles: OHLCV[]): number {
  const price   = candles[candles.length - 1].close;
  const recent  = candles.slice(-50);
  const swingHi: number[] = [];
  for (let i = 1; i < recent.length - 1; i++) {
    if (recent[i].high > recent[i - 1].high && recent[i].high > recent[i + 1].high && recent[i].high > price) {
      swingHi.push(recent[i].high);
    }
  }
  return swingHi.length > 0 ? Math.min(...swingHi) : Math.max(...candles.slice(-20).map(c => c.high));
}

/** ATR-based volatility classification. */
function classifyVolatility(atr: number, price: number): VolatilityClass {
  const pct = price > 0 ? atr / price : 0;
  if (pct < 0.008) return "LOW";
  if (pct > 0.025) return "HIGH";
  return "NORMAL";
}

/** Direction score 0–100 (EMA200, ADX, DI). */
export function calcDirectionScore(raw: AnalysisResult["raw"], price: number): number {
  let s = 50;
  if (!isNaN(raw.ema200)) { s += price > raw.ema200 ? 20 : -20; }
  if   (raw.adx > 40)      s += 15;
  else if (raw.adx > 25)   s +=  8;
  else if (raw.adx < 15)   s -= 10;
  const diMargin = raw.plusDI - raw.minusDI;
  if   (diMargin > 10)  s += 15;
  else if (diMargin > 0) s +=  8;
  else if (diMargin < -10) s -= 15;
  else s -=  8;
  return Math.max(0, Math.min(100, s));
}

/** Context score 0–100 (RSI, Volume, Range position). */
export function calcContextScore(raw: AnalysisResult["raw"]): number {
  let s = 50;
  if      (raw.rsi >= 40 && raw.rsi <= 60) s += 15;
  else if (raw.rsi < 35)                   s +=  5;  // oversold bounce potential
  else if (raw.rsi > 70)                   s -= 15;
  else if (raw.rsi > 65)                   s -=  8;
  if      (raw.volRatio > 1.5)  s += 20;
  else if (raw.volRatio > 1.1)  s += 10;
  else if (raw.volRatio < 0.65) s -= 20;
  if      (raw.rangePct < 0.30) s += 10;  // near support
  else if (raw.rangePct > 0.80) s -= 15;  // near resistance
  return Math.max(0, Math.min(100, s));
}

/** Trigger score 0–100 (MACD, RSI momentum, Range breakout, RelVol). */
export function calcTriggerScore(raw: AnalysisResult["raw"], relVol: number): number {
  let s = 50;
  s += raw.macdBull ? 20 : -15;
  if      (raw.rsi > 55) s += 15;
  else if (raw.rsi < 45) s -= 15;
  if (raw.rangePct > 0.55) s += 10;
  if      (relVol > 1.5) s += 15;
  else if (relVol < 0.7) s -= 10;
  return Math.max(0, Math.min(100, s));
}

/** Map composite score → 4-state trade decision. */
export function tradeDecisionFromScore(score: number): TradeDecision {
  if (score >= 76) return "ENTRY SIGNAL";
  if (score >= 61) return "PREPARE ENTRY";
  if (score >= 41) return "WATCH";
  return "IGNORE";
}

function smaArr(data: number[], period: number): number[] {
  return data.map((_, i) => {
    if (i < period - 1) return NaN;
    return data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
  });
}

function emaArr(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = new Array(data.length).fill(NaN);
  // Find first non-NaN
  let start = data.findIndex(v => !isNaN(v));
  if (start === -1 || data.length - start < period) return result;
  const startIdx = start + period - 1;
  result[startIdx] = data.slice(start, startIdx + 1).reduce((a, b) => a + b, 0) / period;
  for (let i = startIdx + 1; i < data.length; i++) {
    result[i] = data[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

function last(arr: number[]): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (!isNaN(arr[i])) return arr[i];
  }
  return NaN;
}

function fmt(n: number, dp = 2): string {
  if (isNaN(n) || !isFinite(n)) return "—";
  return n.toFixed(dp);
}

function sigScore(s: Signal): number {
  return s === "bullish" ? 1 : s === "bearish" ? -1 : 0;
}

// ── RSI (Wilder smoothing) ────────────────────────────────────────────────────

function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgGain += d; else avgLoss -= d;
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

// ── ATR (Wilder smoothing) ────────────────────────────────────────────────────

export function calcATR(candles: OHLCV[], period = 14): number {
  if (candles.length < period + 1) return 0;
  let atr = 0;
  for (let i = 1; i <= period; i++) {
    const c = candles[i], p = candles[i - 1];
    atr += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
  }
  atr /= period;
  for (let i = period + 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    const tr = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    atr = (atr * (period - 1) + tr) / period;
  }
  return atr;
}

// ── ADX (Wilder smoothing) ────────────────────────────────────────────────────

function calcADX(candles: OHLCV[], period = 14): { adx: number; plusDI: number; minusDI: number } {
  const n = candles.length;
  if (n < period * 2 + 2) return { adx: 20, plusDI: 25, minusDI: 25 };

  const trs: number[] = [], pDMs: number[] = [], mDMs: number[] = [];
  for (let i = 1; i < n; i++) {
    const c = candles[i], p = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
    const up = c.high - p.high, dn = p.low - c.low;
    pDMs.push(up > dn && up > 0 ? up : 0);
    mDMs.push(dn > up && dn > 0 ? dn : 0);
  }

  // First Wilder average
  let sTR  = trs.slice(0, period).reduce((a, b) => a + b, 0);
  let sPDM = pDMs.slice(0, period).reduce((a, b) => a + b, 0);
  let sMDM = mDMs.slice(0, period).reduce((a, b) => a + b, 0);

  let pDI = sTR > 0 ? sPDM / sTR * 100 : 0;
  let mDI = sTR > 0 ? sMDM / sTR * 100 : 0;
  let dx  = (pDI + mDI) > 0 ? Math.abs(pDI - mDI) / (pDI + mDI) * 100 : 0;
  const dxArr = [dx];

  for (let i = period; i < trs.length; i++) {
    sTR  = sTR  - sTR  / period + trs[i];
    sPDM = sPDM - sPDM / period + pDMs[i];
    sMDM = sMDM - sMDM / period + mDMs[i];
    pDI  = sTR > 0 ? sPDM / sTR * 100 : 0;
    mDI  = sTR > 0 ? sMDM / sTR * 100 : 0;
    dx   = (pDI + mDI) > 0 ? Math.abs(pDI - mDI) / (pDI + mDI) * 100 : 0;
    dxArr.push(dx);
  }

  // ADX = Wilder EMA of DX
  if (dxArr.length < period) return { adx: 20, plusDI: pDI, minusDI: mDI };
  let adx = dxArr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dxArr.length; i++) {
    adx = (adx * (period - 1) + dxArr[i]) / period;
  }

  return { adx, plusDI: pDI, minusDI: mDI };
}

// ── Stochastic ────────────────────────────────────────────────────────────────

function calcStochastic(candles: OHLCV[], kPeriod = 14, smooth = 3): { k: number; d: number } {
  if (candles.length < kPeriod + smooth) return { k: 50, d: 50 };

  const kRaw: number[] = [];
  for (let i = kPeriod - 1; i < candles.length; i++) {
    const sl = candles.slice(i - kPeriod + 1, i + 1);
    const hi = Math.max(...sl.map(c => c.high));
    const lo = Math.min(...sl.map(c => c.low));
    kRaw.push(hi !== lo ? ((candles[i].close - lo) / (hi - lo)) * 100 : 50);
  }

  // Smooth %K → %D
  const smoothed: number[] = [];
  for (let i = smooth - 1; i < kRaw.length; i++) {
    smoothed.push(kRaw.slice(i - smooth + 1, i + 1).reduce((a, b) => a + b, 0) / smooth);
  }

  const k = smoothed[smoothed.length - 1] ?? 50;
  const dSlice = smoothed.slice(-smooth);
  const d = dSlice.reduce((a, b) => a + b, 0) / dSlice.length;
  return { k, d };
}

// ── Bollinger Bands ───────────────────────────────────────────────────────────

function calcBollinger(closes: number[], period = 20, devs = 2): { upper: number; middle: number; lower: number; pB: number } {
  if (closes.length < period) return { upper: NaN, middle: NaN, lower: NaN, pB: 0.5 };
  const sl   = closes.slice(-period);
  const mean = sl.reduce((a, b) => a + b, 0) / period;
  const std  = Math.sqrt(sl.reduce((s, v) => s + (v - mean) ** 2, 0) / period);
  const upper = mean + devs * std;
  const lower = mean - devs * std;
  const price = closes[closes.length - 1];
  const pB = std > 0 ? (price - lower) / (upper - lower) : 0.5;
  return { upper, middle: mean, lower, pB };
}

// ── Expert strategy builder ───────────────────────────────────────────────────

interface StratCtx {
  price: number; atr: number;
  rsi: number; rsiPrev: number;
  stochK: number; stochD: number; stochKPrev: number;
  macdVal: number; sigVal: number; histVal: number; prevHist: number;
  adx: number; plusDI: number; minusDI: number;
  bollPB: number; bollUpper: number; bollMiddle: number; bollLower: number;
  sma20: number; sma50: number; ema9: number; ema21: number;
  volRatio: number; priceUp: boolean;
  upCandles: number; dnCandles: number; rangePct: number;
}

function buildStrategies(c: StratCtx): StrategyProposal[] {
  const {
    price, atr, rsi, rsiPrev, stochK, stochD, stochKPrev,
    macdVal, sigVal, histVal, prevHist, adx, plusDI, minusDI,
    bollPB, bollMiddle, sma20, sma50, ema9, ema21,
    volRatio, priceUp, upCandles, dnCandles, rangePct,
  } = c;

  // ── Flags derivats ──
  const trending    = adx > 25;
  const strongTrend = adx > 40;
  const ranging     = adx < 20;
  const bullTrend   = trending && plusDI > minusDI;
  const bearTrend   = trending && minusDI > plusDI;
  const emaBull     = ema9 > ema21;
  const macdBull    = macdVal > sigVal;
  const histRising  = histVal > prevHist;
  const highVol     = volRatio > 1.5;
  const lowVol      = volRatio < 0.7;
  const rsiOS       = rsi < 35;
  const rsiOB       = rsi > 65;
  const rsiExtOS    = rsi < 25;
  const rsiExtOB    = rsi > 75;
  const rsiExitOS   = rsi > 30 && rsiPrev <= 30;   // acaba de sortir de sobrevencut → compra
  const rsiExitOB   = rsi < 70 && rsiPrev >= 70;   // acaba de sortir de sobrecompra → venda
  const stochOS     = stochK < 25;
  const stochOB     = stochK > 75;
  const stochBullX  = stochK > stochD && stochKPrev <= stochD;
  const stochBearX  = stochK < stochD && stochKPrev >= stochD;
  const bollLow     = bollPB < 0.2;
  const bollHigh    = bollPB > 0.8;

  const proposals: StrategyProposal[] = [];
  const C = (n: number, d = 2) => isNaN(n) || !isFinite(n) ? "—" : n.toFixed(d);

  // ── A: Trend Following Alcista ──────────────────────────────────────────────
  {
    const active = bullTrend || (emaBull && macdBull);
    const whyNot: string[] = [];
    if (!active) {
      if (adx < 25 && !emaBull)   whyNot.push(`ADX ${C(adx,0)} < 25 i EMA9 per sota EMA21: ni tendència directional ni momentum alcista a curt termini`);
      else if (adx < 25)          whyNot.push(`ADX ${C(adx,0)} < 25: mercat sense tendència definida, +DI/${C(plusDI,0)} i −DI/${C(minusDI,0)} massa propers`);
      else if (minusDI > plusDI)   whyNot.push(`−DI ${C(minusDI,0)} > +DI ${C(plusDI,0)}: els venedors dominen el flux directional malgrat ADX ${C(adx,0)}`);
      if (!emaBull)                whyNot.push(`EMA9 (${C(ema9)}) per sota EMA21 (${C(ema21)}): el momentum curt termini és bajista`);
      if (!macdBull)               whyNot.push(`MACD (${C(macdVal,4)}) per sota la senyal (${C(sigVal,4)}): sense confirmació d'impuls alcista`);
    }

    const r: string[] = [], b: string[] = [];
    let sc = 0;

    if (bullTrend && strongTrend) {
      r.push(`ADX ${C(adx, 0)} confirma tendència alcista molt forta (+DI ${C(plusDI, 0)} vs −DI ${C(minusDI, 0)}): impuls directional sostenible, el mercat té clara direcció`);
      sc += 3;
    } else if (bullTrend) {
      r.push(`ADX ${C(adx, 0)} amb +DI ${C(plusDI, 0)} > −DI ${C(minusDI, 0)}: tendència alcista activa, compradors dominant als venedors`);
      sc += 2;
    }
    if (emaBull) {
      r.push(`EMA9 (${C(ema9)}) per sobre EMA21 (${C(ema21)}): el momentum a curt termini és alcista, la mitjana ràpida lidera`);
      sc += 1;
    }
    if (macdBull && histRising) {
      r.push(`MACD (${C(macdVal, 4)}) per sobre la línia de senyal i histograma accelerant: triple confluència d'impuls alcista, les forces compres guanyen velocitat`);
      sc += 2;
    } else if (macdBull) {
      r.push(`MACD per sobre la senyal però histograma perdent força (${C(prevHist,4)}→${C(histVal,4)}): rally madurant, vigilar senyals de debilitament`);
      sc += 1;
    }
    if (price > sma50 && price > sma20) {
      r.push(`Preu (${C(price)}) per sobre SMA20 (${C(sma20)}) i SMA50 (${C(sma50)}): estructura alcista confirmada a tots els terminis, venedors sense suport`);
      sc += 1;
    }
    if (highVol && priceUp) {
      r.push(`Volum ${C(volRatio, 1)}× la mitjana de 20 acompanya la pujada: convicció institucional darrere del moviment, no és una pujada en buit`);
      sc += 2;
    }
    if (upCandles >= 4) {
      r.push(`${upCandles}/5 veles recents alcistes: price action confirma la pressió compradora continuada`);
      sc += 1;
    }

    if (rsiExtOB) {
      b.push(`⚠ RSI ${C(rsi, 1)} en sobrecompra extrema (>75): probable profit-taking agressiu a curt termini — l'entrada ara implica comprar en màxims tècnics`);
      sc -= 3;
    } else if (rsiOB) {
      b.push(`RSI ${C(rsi, 1)} en zona de sobrecompra (>65): potencial de continuació limitat, considerar esperar retrocés a la SMA o EMA21`);
      sc -= 1;
    }
    if (bollHigh) {
      b.push(`%B ${C(bollPB, 2)}: preu prop de la banda superior de Bollinger — resistència estadística de 2σ, zona habitual de distribució`);
      sc -= 1;
    }
    if (rangePct > 0.88) {
      b.push(`Preu al ${C(rangePct*100, 0)}% del rang de 20 períodes: escàs marge fins als màxims recents, risc asimètric desfavorable`);
      sc -= 1;
    }
    if (lowVol) {
      b.push(`Volum ${C(volRatio, 1)}× inferior a la mitjana: la tendència alcista no té suport volumètric, susceptible a reversió sobtada`);
      sc -= 1;
    }

    const conf = sc >= 5 ? "alta" : sc >= 3 ? "moderada" : "baixa";
    const risk: "baix"|"mig"|"alt" = b.some(x => x.startsWith("⚠")) ? "alt" : b.length >= 2 ? "mig" : "baix";
    const m = strongTrend ? 3.5 : 2.5, sm = strongTrend ? 2.0 : 1.5;
    proposals.push({
      name: "Trend Following Alcista", type: "bullish", confidence: active ? conf : "baixa",
      keySignal: bullTrend ? `ADX ${C(adx,0)} (+DI > −DI)` : `EMA9/21 alcista + MACD alcista`,
      rationale: r, blockers: b, active, whyNot,
      tp: price + atr * m, sl: price - atr * sm, slLimit: price - atr * (sm + 0.05),
      trailing: {
        activateAt: price,
        activateAtr: 0,
        distance: atr * 1.5,
        distanceAtr: 1.5,
        logic: "S'activa automàticament des del preu d'entrada. Segueix el màxim assolit amb una cua de 1.5×ATR per sota — protegeix beneficis sense tancar massa aviat.",
      },
      risk,
    });
  }

  // ── B: Trend Following Bajista ──────────────────────────────────────────────
  {
    const active = bearTrend || (!emaBull && !macdBull && adx > 20);
    const whyNot: string[] = [];
    if (!active) {
      if (adx < 20)               whyNot.push(`ADX ${C(adx,0)} < 20: mercat en rang, sense flux directional bajista`);
      else if (plusDI > minusDI)   whyNot.push(`+DI ${C(plusDI,0)} > −DI ${C(minusDI,0)}: els compradors dominen el directional`);
      if (emaBull)                 whyNot.push(`EMA9 (${C(ema9)}) per sobre EMA21 (${C(ema21)}): el momentum curt termini és alcista`);
      if (macdBull)                whyNot.push(`MACD (${C(macdVal,4)}) per sobre la senyal: confirmació d'impuls alcista, no bajista`);
    }

    const r: string[] = [], b: string[] = [];
    let sc = 0;

    if (bearTrend && strongTrend) {
      r.push(`ADX ${C(adx,0)} confirma tendència bajista molt forta (−DI ${C(minusDI,0)} vs +DI ${C(plusDI,0)}): pressió venedora dominant i persistent, fugir de posicions llargues`);
      sc += 3;
    } else if (bearTrend) {
      r.push(`ADX ${C(adx,0)} amb −DI ${C(minusDI,0)} > +DI ${C(plusDI,0)}: tendència bajista activa, venedors guanyen la batalla directional`);
      sc += 2;
    }
    if (!emaBull) {
      r.push(`EMA9 (${C(ema9)}) per sota EMA21 (${C(ema21)}): momentum curt termini bajista, la mitjana ràpida s'allunya a la baixa`);
      sc += 1;
    }
    if (!macdBull && !histRising) {
      r.push(`MACD (${C(macdVal,4)}) per sota la senyal i histograma baixant (${C(prevHist,4)}→${C(histVal,4)}): doble confirmació de pressió venedora creixent`);
      sc += 2;
    } else if (!macdBull) {
      r.push(`MACD per sota la línia de senyal: orientació bajista, però histograma podria estar estabilitzant-se`);
      sc += 1;
    }
    if (price < sma50 && price < sma20) {
      r.push(`Preu per sota SMA20 (${C(sma20)}) i SMA50 (${C(sma50)}): estructura tècnica bajista a tots els terminis, els compradors no aconsegueixen recuperar les mitjanes`);
      sc += 1;
    }
    if (highVol && !priceUp) {
      r.push(`Volum ${C(volRatio,1)}× la mitjana acompanya la caiguda: vendes amb convicció, no és liquidació tècnica menor`);
      sc += 2;
    }
    if (dnCandles >= 4) {
      r.push(`${dnCandles}/5 veles recents bajistes: price action confirma pressió venedora sostinguda`);
      sc += 1;
    }

    if (rsiExtOS) {
      b.push(`⚠ RSI ${C(rsi,1)} en sobrevencut extrem (<25): rebots tècnics violents són habituals en aquestes zones — evitar posicions bajistes noves, risc de short squeeze`);
      sc -= 3;
    } else if (rsiOS) {
      b.push(`RSI ${C(rsi,1)} en zona de sobrevencut (<35): la pressió bajista pot estar exhaurint-se, considerar protegir beneficis`);
      sc -= 1;
    }
    if (bollLow) {
      b.push(`%B ${C(bollPB,2)}: preu prop de la banda inferior de Bollinger — suport estadístic 2σ, zona on els compradors de reversió solen activar-se`);
      sc -= 1;
    }
    if (rangePct < 0.12) {
      b.push(`Preu al ${C(rangePct*100,0)}% del rang de 20 períodes: proper als mínims recents, suport tècnic significatiu`);
      sc -= 1;
    }
    if (lowVol) {
      b.push(`Volum ${C(volRatio,1)}× inferior a la mitjana: tendència bajista sense convicció volumètrica, possible distribució lenta en lloc de caiguda accelerada`);
      sc -= 1;
    }

    const conf = sc >= 5 ? "alta" : sc >= 3 ? "moderada" : "baixa";
    const risk: "baix"|"mig"|"alt" = b.some(x => x.startsWith("⚠")) ? "alt" : b.length >= 2 ? "mig" : "baix";
    const m = strongTrend ? 3.5 : 2.5, sm = strongTrend ? 2.0 : 1.5;
    proposals.push({
      name: "Trend Following Bajista", type: "bearish", confidence: active ? conf : "baixa",
      keySignal: bearTrend ? `ADX ${C(adx,0)} (−DI > +DI)` : `EMA9/21 bajista + MACD bajista`,
      rationale: r, blockers: b, active, whyNot,
      tp: price - atr * m, sl: price + atr * sm, slLimit: price + atr * (sm + 0.05),
      trailing: {
        activateAt: price,
        activateAtr: 0,
        distance: atr * 1.5,
        distanceAtr: 1.5,
        logic: "S'activa automàticament des del preu d'entrada. Segueix el mínim assolit amb una cua de 1.5×ATR per sobre — protegeix beneficis i deixa córrer la tendència baixista.",
      },
      risk,
    });
  }

  // ── C: Reversió Alcista (des de sobrevencut) ────────────────────────────────
  {
    const active = rsiOS || stochOS || bollLow;
    const whyNot: string[] = [];
    if (!active) {
      whyNot.push(`RSI ${C(rsi,1)} (necessita <35): no hi ha sobrevencut — el mercat no ha assolit l'excés vendedor necessari per a una reversió fiable`);
      whyNot.push(`Estocàstic K ${C(stochK,0)} (necessita <25) i %B ${C(bollPB,2)} (necessita <0.20): cap oscil·lador ni Bollinger en zona extrema inferior`);
    }

    const r: string[] = [], b: string[] = [];
    let sc = 0;

    if (rsiExitOS) {
      r.push(`🔑 RSI ${C(rsi,1)} acaba de sortir de la zona de sobrevencut (creuament per sobre 30): senyal clàssic d'entrada — els compradors estan absorbint la pressió venedora acumulada`);
      sc += 4;
    } else if (rsiExtOS) {
      r.push(`RSI ${C(rsi,1)} en sobrevencut extrem (<25): esgotament vendedor estadísticament significatiu — menys del 5% del temps el mercat opera aquí`);
      sc += 2;
    } else if (rsiOS) {
      r.push(`RSI ${C(rsi,1)} en zona de sobrevencut (<35): pressió venedora a curt termini en excés, els nivells de preu comencen a atreure compradors de valor`);
      sc += 1;
    }

    if (stochBullX && stochOS) {
      r.push(`Estocàstic K (${C(stochK,0)}) creuant per sobre D (${C(stochD,0)}) des de sobrevencut: creuament alcista des de zona extrema — doble confirmació de gir`);
      sc += 3;
    } else if (stochOS) {
      r.push(`Estocàstic K ${C(stochK,0)} per sota 25: lectura de sobrevencut confirma l'excés vendedor en perspectiva d'oscil·ladors`);
      sc += 1;
    }

    if (bollLow) {
      r.push(`Preu tocant la banda inferior de Bollinger (%B ${C(bollPB,2)}): ${C((1-bollPB)*2,1)}σ per sota la mitjana de 20 períodes — nivell de reversió estadística on sovint els algoritmes de market-making absorbeixen`);
      sc += 2;
    }

    if (histRising && histVal < 0) {
      r.push(`Histograma MACD negatiu però pujant (${C(prevHist,4)}→${C(histVal,4)}): la pressió venedora s'està reduint, primeres evidències d'esgotament bajista en el momentum`);
      sc += 2;
    }

    if (ranging) {
      r.push(`Mercat en rang (ADX ${C(adx,0)} < 20): sense tendència dominant, les reversions des d'extrems d'oscil·ladors tenen alta fiabilitat estadística en mercats en consolidació`);
      sc += 1;
    }

    if (!highVol && !priceUp) {
      r.push(`Volum decreixent a la caiguda (${C(volRatio,1)}×): el moviment bajista perd convicció — esgotament vendedor consistent amb el perfil de reversió`);
      sc += 1;
    }

    if (bearTrend && strongTrend) {
      b.push(`⚠ ADX ${C(adx,0)} en tendència bajista forta (−DI ${C(minusDI,0)} > +DI ${C(plusDI,0)}): la reversió va contra un trend poderós — alt risc de "bull trap", pot ser un rebote temporal dins d'una caiguda major`);
      sc -= 3;
    } else if (bearTrend) {
      b.push(`Tendència bajista activa (ADX ${C(adx,0)}): reversió contra tendència — esperar confirmació addicional com a mínim K/D Estocàstic o sortida de RSI per sobre 30`);
      sc -= 1;
    }
    if (!macdBull && !histRising) {
      b.push(`MACD bajista sense senyal de gir: el momentum bajista no ha cedit estructuralment, la reversió pot ser prematura — entrar massa aviat és un error freqüent`);
      sc -= 1;
    }
    if (price < sma50 * 0.96) {
      b.push(`Preu significativament per sota SMA50 (${C(sma50)}): estructura tècnica bajista establerta — el rebote té resistències importants per davant`);
      sc -= 1;
    }

    const conf = sc >= 5 ? "alta" : sc >= 3 ? "moderada" : "baixa";
    const risk: "baix"|"mig"|"alt" = b.some(x => x.startsWith("⚠")) ? "alt" : b.length >= 2 ? "mig" : "baix";
    const tpBase = isNaN(bollMiddle) || bollMiddle <= price ? price + atr * 1.5 : bollMiddle;
    proposals.push({
      name: "Reversió Alcista", type: "bullish", confidence: active ? conf : "baixa",
      keySignal: rsiExitOS ? `RSI sortint de sobrevencut (${C(rsi,1)})`
        : rsiExtOS ? `RSI sobrevencut extrem (${C(rsi,1)})`
        : stochBullX ? `Estocàstic creuament K↑D des de sobrevencut`
        : `Bollinger inferior (%B ${C(bollPB,2)})`,
      rationale: r, blockers: b, active, whyNot,
      tp: Math.min(tpBase, price + atr * 2.5),
      sl: price - atr * 1.0, slLimit: price - atr * 1.05,
      trailing: {
        activateAt: price,
        activateAtr: 0,
        distance: atr * 1.0,
        distanceAtr: 1.0,
        logic: "S'activa automàticament des del preu d'entrada. Trailing ajustat a 1.0×ATR per sota del màxim — protegeix els guanys tan aviat com el preu es mou a favor.",
      },
      risk,
    });
  }

  // ── D: Reversió Bajista (des de sobrecomprat) ───────────────────────────────
  {
    const active = rsiOB || stochOB || bollHigh;
    const whyNot: string[] = [];
    if (!active) {
      whyNot.push(`RSI ${C(rsi,1)} (necessita >65): no hi ha sobrecompra — el mercat no ha acumulat l'excés comprador necessari per a una reversió`);
      whyNot.push(`Estocàstic K ${C(stochK,0)} (necessita >75) i %B ${C(bollPB,2)} (necessita >0.80): cap oscil·lador ni Bollinger en zona extrema superior`);
    }

    const r: string[] = [], b: string[] = [];
    let sc = 0;

    if (rsiExitOB) {
      r.push(`🔑 RSI ${C(rsi,1)} acaba de sortir de la zona de sobrecompra (creuament per sota 70): senyal de debilitament alcista — els venedors estan prenent control del momentum a curt termini`);
      sc += 4;
    } else if (rsiExtOB) {
      r.push(`RSI ${C(rsi,1)} en sobrecompra extrema (>75): esgotament comprador estadísticament significant — les mans fortes sovint distribueixen en aquests nivells`);
      sc += 2;
    } else if (rsiOB) {
      r.push(`RSI ${C(rsi,1)} en zona de sobrecompra (>65): excés de pressió compradora acumulada, el mercat necessita corregir per recuperar equilibri`);
      sc += 1;
    }

    if (stochBearX && stochOB) {
      r.push(`Estocàstic K (${C(stochK,0)}) creuant per sota D (${C(stochD,0)}) des de sobrecompra: creuament bajista des de zona extrema — confirmació de gir per dos oscil·ladors`);
      sc += 3;
    } else if (stochOB) {
      r.push(`Estocàstic K ${C(stochK,0)} per sobre 75: sobrecompra confirmada, l'oscil·lador d'estocàstic reforça la lectura de RSI`);
      sc += 1;
    }

    if (bollHigh) {
      r.push(`Preu tocant la banda superior de Bollinger (%B ${C(bollPB,2)}): resistència estadística de 2σ — nivell on estadísticament el preu reverteix a la mitjana en el ${C(bollPB*100,0)}% dels casos`);
      sc += 2;
    }

    if (!histRising && histVal > 0) {
      r.push(`Histograma MACD positiu però baixant (${C(prevHist,4)}→${C(histVal,4)}): el momentum alcista s'està debilitant — el rally perd força sense haver girat encara, patró d'esgotament`);
      sc += 2;
    }

    if (ranging) {
      r.push(`Mercat en rang (ADX ${C(adx,0)} < 20): alta fiabilitat estadística de les reversions des de bandes extremes en mercats sense tendència`);
      sc += 1;
    }

    if (!highVol && priceUp) {
      r.push(`Volum decreixent a la pujada (${C(volRatio,1)}×): rally sense convicció volumètrica — possible maniobra de distribució o short squeeze esgotant-se`);
      sc += 1;
    }

    if (bullTrend && strongTrend) {
      b.push(`⚠ ADX ${C(adx,0)} en tendència alcista forta (+DI ${C(plusDI,0)} > −DI ${C(minusDI,0)}): "never short a strong uptrend" — la sobrecompra pot mantenir-se molt de temps en tendències poderoses`);
      sc -= 3;
    } else if (bullTrend) {
      b.push(`Tendència alcista activa (ADX ${C(adx,0)}): reversió contra tendència — el senyal és menys fiable, esperar confluència addicional`);
      sc -= 1;
    }
    if (macdBull && histRising) {
      b.push(`MACD alcista i histograma accelerant: el momentum alcista no ha cedit — la correcció pot ser superficial i efímera`);
      sc -= 1;
    }

    const conf = sc >= 5 ? "alta" : sc >= 3 ? "moderada" : "baixa";
    const risk: "baix"|"mig"|"alt" = b.some(x => x.startsWith("⚠")) ? "alt" : b.length >= 2 ? "mig" : "baix";
    const tpBase = isNaN(bollMiddle) || bollMiddle >= price ? price - atr * 1.5 : bollMiddle;
    proposals.push({
      name: "Reversió Bajista", type: "bearish", confidence: active ? conf : "baixa",
      keySignal: rsiExitOB ? `RSI sortint de sobrecompra (${C(rsi,1)})`
        : rsiExtOB ? `RSI sobrecompra extrema (${C(rsi,1)})`
        : stochBearX ? `Estocàstic creuament K↓D des de sobrecompra`
        : `Bollinger superior (%B ${C(bollPB,2)})`,
      rationale: r, blockers: b, active, whyNot,
      tp: Math.max(tpBase, price - atr * 2.5),
      sl: price + atr * 1.0, slLimit: price + atr * 1.05,
      trailing: {
        activateAt: price,
        activateAtr: 0,
        distance: atr * 1.0,
        distanceAtr: 1.0,
        logic: "S'activa automàticament des del preu d'entrada. Trailing a 1.0×ATR per sobre del mínim assolit — tanca la posició curta en qualsevol recuperació significativa.",
      },
      risk,
    });
  }

  // ── E: Breakout Alcista (ruptura de rang amb volum) ─────────────────────────
  {
    const active = rangePct > 0.82 && highVol && priceUp && !rsiExtOB;
    const whyNot: string[] = [];
    if (!active) {
      if (rangePct <= 0.82)  whyNot.push(`Preu al ${C(rangePct*100,0)}% del rang de 20 períodes (necessita >82%): massa lluny dels màxims recents per parlar de ruptura`);
      if (!highVol)          whyNot.push(`Volum ${C(volRatio,1)}× la mitjana (necessita >1.5×): sense confirmació volumètrica, una ruptura sense volum és un fals moviment`);
      if (!priceUp)          whyNot.push(`La vela actual és bajista: una ruptura alcista requereix tancament per sobre dels màxims`);
      if (rsiExtOB)          whyNot.push(`RSI ${C(rsi,1)} en sobrecompra extrema: el breakout arriba esgotat, alt risc de rebuig immediat`);
    }

    const r: string[] = [], b: string[] = [];
    let sc = 0;

    r.push(`Preu al ${C(rangePct*100,0)}% del rang de 20 períodes amb volum ${C(volRatio,1)}×: intento de ruptura dels màxims recents recolzat per volum significatiu`);
    sc += 3;

    if (macdBull && histRising) {
      r.push(`MACD i histograma alcistes i accelerant: el momentum acompanya la ruptura — senyal de força, no fals moviment`);
      sc += 2;
    }
    if (!ranging) {
      r.push(`ADX ${C(adx,0)} > 20: hi ha suficient momentum direccional per fer la ruptura sostenible en el temps`);
      sc += 1;
    }
    if (emaBull && price > sma50) {
      r.push(`EMA9 > EMA21 i preu per sobre SMA50: alineament multi-termini, context estructural favorable per a la ruptura`);
      sc += 1;
    }

    if (rsiOB) {
      b.push(`RSI ${C(rsi,1)} en sobrecompra: les ruptures amb RSI alt sovint es rebutgen en el primer intent — estratègia clàssica: esperar el retrocés i re-test del nivell trencat`);
      sc -= 1;
    }
    if (stochOB) {
      b.push(`Estocàstic en sobrecompra (K ${C(stochK,0)}): risc de "bull trap" si el volum no es manté en les pròximes veles`);
      sc -= 1;
    }

    const conf = sc >= 5 ? "alta" : sc >= 3 ? "moderada" : "baixa";
    proposals.push({
      name: "Breakout Alcista", type: "bullish",
      confidence: active ? conf : "baixa",
      keySignal: `Ruptura rang (${C(rangePct*100,0)}%) + volum ${C(volRatio,1)}×`,
      rationale: r, blockers: b, active, whyNot,
      tp: price + atr * 4.0, sl: price - atr * 1.5, slLimit: price - atr * 1.55,
      trailing: {
        activateAt: price,
        activateAtr: 0,
        distance: atr * 2.0,
        distanceAtr: 2.0,
        logic: "S'activa automàticament des del preu d'entrada. Trailing ample de 2.0×ATR per no tallar un moviment explosiu — breakouts forts sovint continuen sorprenent durant diverses veles.",
      },
      risk: b.length >= 2 ? "mig" : "baix",
    });
  }

  // ── Actives primer (per confiança), després inactives ───────────────────────
  const cs: Record<string,number> = { alta: 3, moderada: 2, baixa: 1 };
  const rs: Record<string,number> = { baix: 3, mig: 2, alt: 1 };
  const active   = proposals.filter(p => p.active).sort((a, b) => cs[b.confidence] - cs[a.confidence] || rs[a.risk] - rs[b.risk]);
  const inactive = proposals.filter(p => !p.active);
  return [...active, ...inactive];
}

// ── Main analysis ─────────────────────────────────────────────────────────────

export function analyzeAll(candles: OHLCV[], symbol: string, interval: string): AnalysisResult {
  const closes  = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);
  const price   = closes[closes.length - 1];

  // ── ATR ──
  const atrVal = calcATR(candles);

  // ── RSI ──
  const rsiVal  = calcRSI(closes);
  const rsiPrev = calcRSI(closes.slice(0, -1));
  const rsiSig: Signal = rsiVal < 30 ? "bullish" : rsiVal > 70 ? "bearish" : rsiVal < 45 ? "bullish" : rsiVal > 55 ? "bearish" : "neutral";
  const rsiDetail = rsiVal < 30 ? "Sobrevenut" : rsiVal > 70 ? "Sobrecomprat" : "Zona neutra";

  // ── Moving Averages ──
  const sma20  = last(smaArr(closes, 20));
  const sma50  = last(smaArr(closes, 50));
  const ema9   = last(emaArr(closes, 9));
  const ema21  = last(emaArr(closes, 21));
  const ema200 = last(emaArr(closes, 200));

  const priceVsSma20: Signal = !isNaN(sma20) ? (price > sma20 ? "bullish" : "bearish") : "neutral";
  const priceVsSma50: Signal = !isNaN(sma50) ? (price > sma50 ? "bullish" : "bearish") : "neutral";
  const emaCross: Signal     = !isNaN(ema9) && !isNaN(ema21) ? (ema9 > ema21 ? "bullish" : "bearish") : "neutral";

  // ── MACD (12, 26, 9) ──
  const ema12arr = emaArr(closes, 12);
  const ema26arr = emaArr(closes, 26);
  const macdLine: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (!isNaN(ema12arr[i]) && !isNaN(ema26arr[i])) macdLine.push(ema12arr[i] - ema26arr[i]);
  }
  const signalLine = emaArr(macdLine, 9);
  const macdVal    = macdLine[macdLine.length - 1] ?? 0;
  const sigVal     = last(signalLine);
  const histVal    = !isNaN(sigVal) ? macdVal - sigVal : 0;
  const prevHist   = (macdLine.length >= 2 && signalLine.length >= 2 && !isNaN(signalLine[signalLine.length - 2]))
    ? macdLine[macdLine.length - 2] - signalLine[signalLine.length - 2]
    : histVal;

  const macdSig: Signal = !isNaN(sigVal) ? (macdVal > sigVal ? "bullish" : "bearish") : "neutral";
  const histSig: Signal = histVal > prevHist ? "bullish" : histVal < prevHist ? "bearish" : "neutral";

  // ── ADX ──
  const { adx, plusDI, minusDI } = calcADX(candles);
  const adxStrSig: Signal = adx > 40 ? "bullish" : adx > 25 ? "neutral" : "neutral"; // strong trend = more reliable signal
  const adxDirSig: Signal = adx > 20 ? (plusDI > minusDI ? "bullish" : "bearish") : "neutral";

  // ── Bollinger ──
  const boll = calcBollinger(closes);
  const bollSig: Signal = !isNaN(boll.pB) ? (boll.pB < 0.2 ? "bullish" : boll.pB > 0.8 ? "bearish" : "neutral") : "neutral";
  const bollDetail = !isNaN(boll.pB) ? (boll.pB < 0.2 ? "Prop banda inferior" : boll.pB > 0.8 ? "Prop banda superior" : "Dins de les bandes") : "—";

  // ── Stochastic ──
  const { k: stochK, d: stochD } = calcStochastic(candles);
  const { k: stochKPrev }        = calcStochastic(candles.slice(0, -1));
  const stochSig: Signal  = stochK < 20 ? "bullish" : stochK > 80 ? "bearish" : "neutral";
  const stochKDSig: Signal = stochK > stochD ? "bullish" : stochK < stochD ? "bearish" : "neutral";

  // ── Volume ──
  const avgVol  = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const lastVol = volumes[volumes.length - 1];
  const volRatio = avgVol > 0 ? lastVol / avgVol : 1;
  const lastClose = closes[closes.length - 1];
  const prevClose = closes[closes.length - 2] ?? lastClose;
  const volSig: Signal = volRatio > 1.5
    ? (lastClose > prevClose ? "bullish" : "bearish")
    : volRatio > 1.1
    ? (lastClose > prevClose ? "bullish" : "neutral")
    : "neutral";

  // ── Price Action ──
  const last5      = candles.slice(-5);
  const upCandles  = last5.filter(c => c.close > c.open).length;
  const dnCandles  = last5.filter(c => c.close < c.open).length;
  const paSig: Signal = upCandles >= 4 ? "bullish" : dnCandles >= 4 ? "bearish" : "neutral";

  const recent20 = candles.slice(-20);
  const hi20     = Math.max(...recent20.map(c => c.high));
  const lo20     = Math.min(...recent20.map(c => c.low));
  const rangePct = hi20 > lo20 ? (price - lo20) / (hi20 - lo20) : 0.5;
  const rangeSig: Signal = rangePct < 0.2 ? "bullish" : rangePct > 0.8 ? "bearish" : "neutral";

  // ── Build groups ──────────────────────────────────────────────────────────

  const groups: AnalysisGroup[] = [
    {
      name: "Momentum",
      score: 0,
      indicators: [
        { name: "RSI (14)",      value: fmt(rsiVal),               signal: rsiSig,   detail: rsiDetail },
        { name: "Estoc. %K/%D",  value: `${fmt(stochK)} / ${fmt(stochD)}`, signal: stochSig, detail: stochK < 20 ? "Sobrevenut" : stochK > 80 ? "Sobrecomprat" : "Zona neutra" },
        { name: "Estoc. K vs D", value: stochK > stochD ? "K > D" : "K < D", signal: stochKDSig },
      ],
    },
    {
      name: "Tendència",
      score: 0,
      indicators: [
        { name: "Preu / SMA20",  value: fmt(sma20),                signal: priceVsSma20, detail: price > sma20 ? "Per sobre" : "Per sota" },
        { name: "Preu / SMA50",  value: fmt(sma50),                signal: priceVsSma50, detail: price > sma50 ? "Per sobre" : "Per sota" },
        { name: "Preu / EMA200", value: fmt(ema200),               signal: !isNaN(ema200) ? (price > ema200 ? "bullish" : "bearish") : "neutral", detail: !isNaN(ema200) ? (price > ema200 ? "Per sobre (bull mercat)" : "Per sota (bear mercat)") : "—" },
        { name: "EMA 9 / 21",    value: `${fmt(ema9)} / ${fmt(ema21)}`, signal: emaCross, detail: ema9 > ema21 ? "EMA9 > EMA21" : "EMA9 < EMA21" },
      ],
    },
    {
      name: "MACD (12,26,9)",
      score: 0,
      indicators: [
        { name: "MACD vs Senyal", value: `${fmt(macdVal, 4)} / ${fmt(sigVal, 4)}`, signal: macdSig, detail: macdVal > sigVal ? "MACD per sobre" : "MACD per sota" },
        { name: "Histograma",     value: fmt(histVal, 4), signal: histSig, detail: histVal > prevHist ? "Pujant" : histVal < prevHist ? "Baixant" : "Pla" },
      ],
    },
    {
      name: "ADX / Força",
      score: 0,
      indicators: [
        { name: "ADX (14)",       value: fmt(adx),                         signal: adxStrSig, detail: adx > 40 ? "Tendència molt forta" : adx > 25 ? "Tendència moderada" : "Sense tendència" },
        { name: "+DI / −DI",      value: `${fmt(plusDI)} / ${fmt(minusDI)}`, signal: adxDirSig, detail: plusDI > minusDI ? "+DI dominant (alcista)" : "−DI dominant (bajista)" },
      ],
    },
    {
      name: "Bollinger",
      score: 0,
      indicators: [
        { name: "%B",         value: fmt(boll.pB, 3), signal: bollSig, detail: bollDetail },
        { name: "Sup / Inf",  value: `${fmt(boll.upper)} / ${fmt(boll.lower)}`, signal: "neutral" },
      ],
    },
    {
      name: "Volum",
      score: 0,
      indicators: [
        { name: "Vol / Mitj. (20)", value: `${fmt(volRatio, 2)}×`, signal: volSig, detail: volRatio > 1.5 ? "Volum alt" : volRatio < 0.7 ? "Volum baix" : "Volum normal" },
      ],
    },
    {
      name: "Price Action",
      score: 0,
      indicators: [
        { name: "Veles (5 últ.)",  value: `${upCandles}↑ ${dnCandles}↓`, signal: paSig },
        { name: "Rang 20 per.",    value: `${fmt(rangePct * 100)}%`,      signal: rangeSig, detail: rangePct < 0.2 ? "Prop del mínim" : rangePct > 0.8 ? "Prop del màxim" : "Mig rang" },
      ],
    },
  ];

  // Compute group scores
  for (const g of groups) {
    const scores = g.indicators.map(ind => sigScore(ind.signal));
    g.score = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  }

  // Overall 0–100 score
  const allScores = groups.flatMap(g => g.indicators.map(ind => sigScore(ind.signal)));
  const totalSum  = allScores.reduce((a, b) => a + b, 0);
  const count     = allScores.length;
  const score     = count > 0 ? Math.round(((totalSum + count) / (2 * count)) * 100) : 50;

  const verdict: "BUY" | "WAIT" | "AVOID" = score >= 65 ? "BUY" : score <= 35 ? "AVOID" : "WAIT";

  // ATR-based TP/SL for a SELL OCO (TP above, SL below)
  const suggestedTP      = price + atrVal * 2.5;
  const suggestedSL      = price - atrVal * 1.5;
  const suggestedSLLimit = price - atrVal * 1.55;

  const strategies = buildStrategies({
    price, atr: atrVal,
    rsi: rsiVal, rsiPrev,
    stochK, stochD, stochKPrev,
    macdVal, sigVal, histVal, prevHist,
    adx, plusDI, minusDI,
    bollPB: boll.pB, bollUpper: boll.upper, bollMiddle: boll.middle, bollLower: boll.lower,
    sma20, sma50, ema9, ema21,
    volRatio, priceUp: lastClose > prevClose,
    upCandles, dnCandles, rangePct,
  });

  // ── v2 enriched fields ────────────────────────────────────────────────────
  const rawSnapshot = { rsi: rsiVal, adx, plusDI, minusDI, sma20, sma50, ema9, ema21, ema200, macdBull: macdVal > sigVal, rangePct, volRatio, stochK };

  const relativeVolume      = volRatio;
  const volatilityClass     = classifyVolatility(atrVal, price);
  const resistance          = calcResistance(candles);
  const distanceToResistance = price > 0 ? (resistance - price) / price : 0;
  const pivotLow            = calcPivotLow(candles);

  const dirScore  = calcDirectionScore(rawSnapshot, price);
  const ctxScore  = calcContextScore(rawSnapshot);
  const trgScore  = calcTriggerScore(rawSnapshot, relativeVolume);

  // Weighted composite — replaces flat average when used by MTF dashboard
  // Single-TF `score` is kept as-is for backward compatibility.
  const weightedScore = Math.round(0.4 * dirScore + 0.3 * ctxScore + 0.3 * trgScore);
  const tradeDecision = tradeDecisionFromScore(weightedScore);

  return {
    symbol, interval, price, score, verdict,
    groups, strategies, candles: candles.slice(-80),
    atr: atrVal, suggestedTP, suggestedSL, suggestedSLLimit,
    relativeVolume, volatilityClass, distanceToResistance, pivotLow,
    layerScores: { direction: dirScore, context: ctxScore, trigger: trgScore },
    tradeDecision,
    raw: rawSnapshot,
  };
}
