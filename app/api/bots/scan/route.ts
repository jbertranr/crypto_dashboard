import { NextRequest, NextResponse } from "next/server";
import { botGet } from "../../../lib/bot-store";
import { analyzeAll, type OHLCV } from "../../../lib/indicators";
import { db } from "../../../lib/cache-store";
import { getQuoteAsset } from "../../../lib/settings-store";
import path from "path";
import fs from "fs";

const SIM_DIR = path.join(process.cwd(), "simulation");

function loadSimConfig(id: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return null;
  if (!fs.existsSync(SIM_DIR)) return null;
  const fp = path.join(SIM_DIR, `${id}.json`);
  if (!path.resolve(fp).startsWith(path.resolve(SIM_DIR))) return null;
  if (!fs.existsSync(fp)) return null;
  try { return JSON.parse(fs.readFileSync(fp, "utf-8")) as Record<string, unknown>; }
  catch { return null; }
}

const INTERVAL_BONUS: Record<string, number> = { "1d": 10, "4h": 10, "1h": 5, "30m": 2, "15m": 0 };
const CONF_BONUS: Record<string, number>     = { alta: 10, moderada: 5, baixa: 0 };
function computeProbability(score: number, interval: string, confidence: string): number {
  return Math.min(95, Math.round(score * 0.7 + (INTERVAL_BONUS[interval] ?? 0) + (CONF_BONUS[confidence] ?? 0)));
}

function hasActiveTrailing(symbol: string, mode: string): boolean {
  const row = db.prepare(
    "SELECT id FROM trailing_active WHERE symbol = ? AND mode = ? AND status = 'active' LIMIT 1"
  ).get(symbol, mode);
  return !!row;
}

const BINANCE_URLS: Record<string, string> = {
  real:  "https://api.binance.com/api/v3",
  paper: "https://demo-api.binance.com/api/v3",
};

async function analyzeSymbol(symbol: string, interval: string, mode: "paper" | "real") {
  const base = BINANCE_URLS[mode];
  const res = await fetch(
    `${base}/klines?symbol=${symbol}&interval=${interval}&limit=251`,
    { cache: "no-store", signal: AbortSignal.timeout(12_000) },
  );
  if (!res.ok) throw new Error(`Binance klines ${res.status}`);
  const raw: unknown[][] = await res.json();
  const candles: OHLCV[] = raw.slice(0, -1).map(k => ({
    time:   k[0] as number,
    open:   parseFloat(k[1] as string),
    high:   parseFloat(k[2] as string),
    low:    parseFloat(k[3] as string),
    close:  parseFloat(k[4] as string),
    volume: parseFloat(k[5] as string),
  }));
  return analyzeAll(candles, symbol, interval);
}

export async function GET(req: NextRequest) {
  const botId = req.nextUrl.searchParams.get("botId");
  if (!botId) return NextResponse.json({ error: "Missing botId" }, { status: 400 });

  const bot = botGet(botId);
  if (!bot) return NextResponse.json({ error: "Bot not found" }, { status: 404 });

  const simCfg = loadSimConfig(bot.simId);
  if (!simCfg) return NextResponse.json({ error: "Sim config not found" }, { status: 404 });

  const config = (simCfg.config ?? simCfg) as Record<string, unknown>;
  const interval = String(config.interval ?? "1h");
  const tpAtr    = Number(config.tpAtr    ?? 2.5);
  const slAtr    = Number(config.slAtr    ?? 1.0);
  const trailAct = Number(config.trailActivateAtr ?? 1.5);
  const trailDst = Number(config.trailDistanceAtr ?? 1.0);
  const minScore = Number(bot.minProbability ?? (simCfg.effectiveConfig as Record<string,unknown> | undefined)?.minProbability ?? 70);

  // Capital per operació (NO és el pressupost total del bot)
  const capitalMode = String(config.capitalMode ?? "FIXED");
  const capitalPerOp = capitalMode === "FIXED"
    ? Number(config.capitalFixed ?? 100)
    : null; // PCT mode requires live balance, not computed here

  const qa = getQuoteAsset();
  const KNOWN_QUOTES = ["USDT","USDC","BUSD","FDUSD","TUSD","BTC","ETH","BNB"];
  const rawSymbols = (config.symbols as string[] | undefined) ?? [];
  const symbols = rawSymbols.map((s: string) => {
    const found = KNOWN_QUOTES.find(q => s.endsWith(q));
    return found ? s.slice(0, -found.length) + qa : s;
  });

  // Pressupost compromès: OCO oberts + trailing actius × capitalPerOp
  let committed = 0;
  if (capitalPerOp !== null) {
    try {
      const base = BINANCE_URLS[bot.mode as "paper" | "real"] ?? BINANCE_URLS.paper;
      const apiKey = bot.mode === "real"
        ? process.env.BINANCE_API_KEY_REAL ?? ""
        : process.env.BINANCE_API_KEY ?? "";
      const openOrdersRes = await fetch(`${base}/openOrders`, {
        headers: { "X-MBX-APIKEY": apiKey },
        cache: "no-store", signal: AbortSignal.timeout(8_000),
      });
      if (openOrdersRes.ok) {
        const orders = await openOrdersRes.json() as { orderListId: number; side: string }[];
        const ocoGroups = new Set(orders.filter(o => o.orderListId !== -1 && o.side === "SELL").map(o => o.orderListId)).size;
        const trailingCount = (db.prepare(
          "SELECT COUNT(*) as n FROM trailing_active WHERE mode = ? AND status = 'active'"
        ).get(bot.mode) as { n: number }).n;
        committed = (ocoGroups + trailingCount) * capitalPerOp;
      }
    } catch { /* no bloqueja el scan si falla */ }
  }

  const results = [];
  for (const symbol of symbols) {
    try {
      const analysis = await analyzeSymbol(symbol, interval, bot.mode as "paper" | "real");
      const bestStrategy = analysis.strategies.find((s: { active: boolean; type: string }) => s.active && s.type !== "bearish");
      const probability  = bestStrategy
        ? computeProbability(analysis.score, interval, (bestStrategy as { confidence: string }).confidence)
        : 0;

      const trailingActive = hasActiveTrailing(symbol, bot.mode);
      let decision: string;
      let reason: string | undefined;

      if (trailingActive) {
        decision = "TRAILING_ACTIVE";
        reason   = "trailing SL actiu";
      } else if (!bestStrategy) {
        decision = "NO_SIGNAL";
        reason   = `cap estratègia activa (veredicte: ${analysis.verdict})`;
      } else if (probability < minScore) {
        decision = "NO_SIGNAL";
        reason   = `probabilitat ${probability.toFixed(0)}% < mínim ${minScore}%`;
      } else {
        // Mode manual: estratègia activa + probabilitat suficient → oferta d'entrada
        // El veredicte és informatiu però no bloqueja (l'usuari decideix)
        decision = "BUY_SIGNAL";
      }

      // Pre-compute indicative TP/SL (estimats, s'ajustaran en el moment real de compra)
      const tpEst = analysis.price + tpAtr * analysis.atr;
      const slEst = analysis.price - slAtr * analysis.atr;

      results.push({
        symbol,
        price:      analysis.price,
        score:      analysis.score,
        atr:        analysis.atr,
        verdict:    analysis.verdict,
        probability,
        strategy:   bestStrategy ? (bestStrategy as { name: string }).name : null,
        confidence: bestStrategy ? (bestStrategy as { confidence: string }).confidence : null,
        decision,
        reason,
        tpEst:      parseFloat(tpEst.toFixed(4)),
        slEst:      parseFloat(slEst.toFixed(4)),
        trailActAt: parseFloat((analysis.price + trailAct * analysis.atr).toFixed(4)),
        trailDst:   parseFloat((trailDst * analysis.atr).toFixed(4)),
      });
    } catch (e) {
      results.push({ symbol, decision: "ERROR", reason: (e as Error).message });
    }
  }

  return NextResponse.json({
    botId,
    botName:  bot.name,
    mode:     bot.mode,
    interval,
    tpAtr, slAtr, trailAct, trailDst, minScore,
    capitalPerOp,
    capitalMode,
    budgetUsdt: bot.budgetUsdt,
    committed,
    results,
    scannedAt: Date.now(),
  });
}
