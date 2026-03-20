/**
 * candle-patterns.ts
 * Detecció de patrons de candlestick japonesos (bullish reversal / continuation).
 * Tots els patrons retornen una confiança de 0–100.
 */

export interface PatternResult {
  name:       string;
  confidence: number;   // 0–100
}

type Bar = { open: number; high: number; low: number; close: number };

/**
 * Detecta patrons bullish en les últimes barres del buffer.
 * Requereix almenys 2 barres; alguns patrons usen 3.
 */
export function detectCandlePatterns(buf: Bar[]): PatternResult[] {
  const patterns: PatternResult[] = [];
  if (buf.length < 2) return patterns;

  const c  = buf[buf.length - 1];
  const p  = buf[buf.length - 2];
  const p2 = buf.length >= 3 ? buf[buf.length - 3] : null;

  const cRange = c.high - c.low;
  if (cRange === 0) return patterns;

  const cBody  = Math.abs(c.close - c.open);
  const cLow   = Math.min(c.close, c.open);   // base del cos
  const cHigh  = Math.max(c.close, c.open);   // sostre del cos
  const cLower = cLow  - c.low;               // metxa inferior
  const cUpper = c.high - cHigh;              // metxa superior
  const cBull  = c.close > c.open;

  const pBody  = Math.abs(p.close - p.open);
  const pLow   = Math.min(p.close, p.open);
  const pHigh  = Math.max(p.close, p.open);
  const pBull  = p.close > p.open;

  // ── Hammer ─────────────────────────────────────────────────────────────────
  // Cos petit (≤40% rang), metxa inferior ≥ 2× cos, metxa superior < cos
  if (cBody / cRange < 0.40 && cLower >= cBody * 2 && cUpper < cBody) {
    patterns.push({ name: "Hammer", confidence: 80 });
  }

  // ── Inverted Hammer ────────────────────────────────────────────────────────
  // Cos petit (≤40% rang), metxa superior ≥ 2× cos, metxa inferior < cos
  if (cBody / cRange < 0.40 && cUpper >= cBody * 2 && cLower < cBody) {
    patterns.push({ name: "InvertedHammer", confidence: 70 });
  }

  // ── Bullish Engulfing ──────────────────────────────────────────────────────
  // Barra verda que cobreix completament la barra roja anterior
  if (cBull && !pBull && pBody > 0 && c.open <= p.close && c.close >= p.open) {
    const ratio = cBody / Math.max(pBody, 1);
    patterns.push({ name: "BullishEngulfing", confidence: Math.min(95, 70 + (ratio - 1) * 20) });
  }

  // ── Dragonfly Doji ─────────────────────────────────────────────────────────
  // Cos ≤10% rang, metxa inferior ≥60% rang, metxa superior ≤10% rang
  if (cBody / cRange < 0.10 && cLower / cRange > 0.60 && cUpper / cRange < 0.10) {
    patterns.push({ name: "DragonflyDoji", confidence: 78 });
  }

  // ── Bullish Pinbar ─────────────────────────────────────────────────────────
  // Metxa inferior dominant (≥65% rang), cos petit (≤25% rang)
  if (cLower / cRange >= 0.65 && cBody / cRange <= 0.25 && cLower > cUpper * 2) {
    patterns.push({ name: "BullishPinbar", confidence: 75 });
  }

  // ── Morning Star (3 barres) ────────────────────────────────────────────────
  // p2 roja grossa → p spinning top (cos petit) → c verda que tanca > mig p2
  if (p2) {
    const p2Body = Math.abs(p2.close - p2.open);
    const p2Bear = p2.close < p2.open;
    const pSmall = p2Body > 0 && pBody < p2Body * 0.4;
    const midP2  = (p2.open + p2.close) / 2;
    if (p2Bear && pSmall && cBull && c.close > midP2) {
      patterns.push({ name: "MorningStar", confidence: 88 });
    }
  }

  // ── Three Inside Up (3 barres) ─────────────────────────────────────────────
  // p2 roja grossa → p verda dins del rang de p2 → c verda que supera p2High
  if (p2) {
    const p2Bear    = p2.close < p2.open;
    const p2BodyLo  = Math.min(p2.open, p2.close);
    const p2BodyHi  = Math.max(p2.open, p2.close);
    const pInsideP2 = pLow >= p2BodyLo && pHigh <= p2BodyHi;
    if (p2Bear && pBull && pInsideP2 && cBull && c.close > p2BodyHi) {
      patterns.push({ name: "ThreeInsideUp", confidence: 85 });
    }
  }

  return patterns;
}

/** Tots els noms de patrons disponibles (per a la UI de selecció). */
export const ALL_CANDLE_PATTERNS = [
  "Hammer",
  "InvertedHammer",
  "BullishEngulfing",
  "DragonflyDoji",
  "BullishPinbar",
  "MorningStar",
  "ThreeInsideUp",
] as const;

export type CandlePatternName = typeof ALL_CANDLE_PATTERNS[number];
