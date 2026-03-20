import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { LOG_DIR } from "../../../lib/logger";
import { getRecentErrors } from "../../../lib/error-store";
import { getMyTrades, getOrderHistory, BinanceTrade, BinanceOrder } from "../../../lib/binance-auth";
import {
  orderMetaGetAll, strategyGetAll,
  trailingGetAll, trailingActiveGetAllIncludingDone,
} from "../../../lib/cache-store";

/* ── Constants ──────────────────────────────────────────────────────────── */

const PAIRS = [
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT",
  "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "DOTUSDT", "LINKUSDT",
  "LTCUSDT", "UNIUSDT", "ATOMUSDT", "APTUSDT", "NEARUSDT",
];

const LEVEL_NUM: Record<string, number> = {
  trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60,
};
const LEVEL_LABEL: Record<number, string> = {
  10: "TRACE", 20: "DEBUG", 30: "INFO ", 40: "WARN ", 50: "ERROR", 60: "FATAL",
};

/* ── Formatting helpers ─────────────────────────────────────────────────── */

function fmtDatetime(ts: number): string {
  const d = new Date(ts);
  const date = d.toISOString().slice(0, 10);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${date} ${hh}:${mm}:${ss}`;
}

function fmtTime(ts: number): string {
  return fmtDatetime(ts).slice(11);
}

function n(v: number, dp = 2): string {
  return v.toFixed(dp);
}

function col(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);
}

/* ── PnL calculation (FIFO per symbol) ──────────────────────────────────── */

interface TradeWithPnl extends BinanceTrade {
  pnl: number | null; // null = buy (no PnL yet)
}

function calcPnl(trades: BinanceTrade[]): TradeWithPnl[] {
  const sorted = [...trades].sort((a, b) => a.time - b.time);
  const queue: { qty: number; unitCost: number }[] = [];
  return sorted.map(t => {
    const qty   = parseFloat(t.qty);
    const price = parseFloat(t.price);
    const commUSDT = t.commissionAsset === "USDT" ? parseFloat(t.commission) : 0;

    if (t.isBuyer) {
      queue.push({ qty, unitCost: price + commUSDT / qty });
      return { ...t, pnl: null };
    }

    let remaining = qty;
    let totalCost = 0;
    while (remaining > 1e-12 && queue.length > 0) {
      const lot  = queue[0];
      const used = Math.min(remaining, lot.qty);
      totalCost += used * lot.unitCost;
      lot.qty   -= used;
      remaining -= used;
      if (lot.qty < 1e-12) queue.shift();
    }
    const revenue = qty * price - commUSDT;
    return { ...t, pnl: revenue - totalCost };
  });
}

/* ── Log file reader ────────────────────────────────────────────────────── */

function logFilePath(date: Date): string {
  return path.join(LOG_DIR, `app-${date.toISOString().slice(0, 10)}.log`);
}

function readLines(filePath: string): string[] {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
}

function formatLogLine(obj: Record<string, unknown>): string {
  const ts    = (obj.time ?? obj.ts) as number;
  const level = obj.level as number;
  const mod   = obj.module as string | undefined;
  const msg   = (obj.msg ?? obj.message ?? "") as string;
  const skip  = new Set(["level", "time", "ts", "pid", "hostname", "module", "msg", "message", "v"]);
  const extra = Object.entries(obj)
    .filter(([k]) => !skip.has(k))
    .map(([k, v]) => typeof v === "object" ? `${k}=${JSON.stringify(v)}` : `${k}=${v}`)
    .join(" ");
  const lbl  = LEVEL_LABEL[level] ?? String(level).padEnd(5);
  const modP = mod ? ` [${mod}]` : "";
  return `[${fmtTime(ts)}] ${lbl}${modP}  ${msg}${extra ? " | " + extra : ""}`;
}

/* ── Main handler ───────────────────────────────────────────────────────── */

export async function GET(req: NextRequest) {
  const sp    = req.nextUrl.searchParams;
  const days  = Math.min(parseInt(sp.get("days") ?? "7", 10), 30);
  const since = Date.now() - days * 86_400_000;
  const today = new Date().toISOString().slice(0, 10);
  const fromDay = new Date(since).toISOString().slice(0, 10);

  const out: string[] = [];
  const section = (title: string) => {
    out.push(""); out.push(`${"=".repeat(60)}`);
    out.push(`  ${title}`);
    out.push(`${"=".repeat(60)}`); out.push("");
  };

  /* ── Capçalera ── */
  out.push(`CRYPTO DASHBOARD — INFORME D'ESTRATÈGIA`);
  out.push(`Període: ${fromDay} → ${today} (darrers ${days} dies)`);
  out.push(`Generat: ${fmtDatetime(Date.now())}`);

  /* ── Dades de Binance ── */
  const [tradeResults, orderResults] = await Promise.all([
    Promise.allSettled(PAIRS.map(p => getMyTrades(p, 500))),
    Promise.allSettled(PAIRS.map(p => getOrderHistory(p, 500))),
  ]);

  // Trades filtrats al període
  const allTrades: (BinanceTrade & { symbol: string })[] = [];
  for (let i = 0; i < PAIRS.length; i++) {
    const r = tradeResults[i];
    if (r.status === "fulfilled") {
      for (const t of r.value) {
        if (t.time >= since) allTrades.push({ ...t, symbol: PAIRS[i] });
      }
    }
  }
  allTrades.sort((a, b) => a.time - b.time);

  // Ordres filtrades al període
  const allOrders: (BinanceOrder & { symbol: string })[] = [];
  for (let i = 0; i < PAIRS.length; i++) {
    const r = orderResults[i];
    if (r.status === "fulfilled") {
      for (const o of r.value) {
        if ((o.time >= since || o.updateTime >= since) && o.status !== "NEW") {
          allOrders.push({ ...o, symbol: PAIRS[i] });
        }
      }
    }
  }
  allOrders.sort((a, b) => a.time - b.time);

  // Metadades locals
  const strategies = strategyGetAll();
  const orderMeta  = orderMetaGetAll();

  function getStrategyForTrade(t: BinanceTrade & { symbol: string }): string {
    return strategies[`ord:${t.orderId}`]
      ?? strategies[`oco:${t.orderListId}`]
      ?? "";
  }

  function getMetaForTrade(t: BinanceTrade & { symbol: string }) {
    return orderMeta[`ord:${t.orderId}`]
      ?? orderMeta[`oco:${t.orderListId}`]
      ?? null;
  }

  function getStrategyForOrder(o: BinanceOrder & { symbol: string }): string {
    return strategies[`ord:${o.orderId}`]
      ?? strategies[`oco:${o.orderListId}`]
      ?? "";
  }

  function getMetaForOrder(o: BinanceOrder & { symbol: string }) {
    return orderMeta[`ord:${o.orderId}`]
      ?? orderMeta[`oco:${o.orderListId}`]
      ?? null;
  }

  /* ── Resum executiu ── */
  section("RESUM");

  const buys  = allTrades.filter(t => t.isBuyer);
  const sells = allTrades.filter(t => !t.isBuyer);

  // PnL total: agrupar per symbol i calcular
  let totalPnl = 0;
  const pnlBySymbol: Record<string, number> = {};
  for (const sym of PAIRS) {
    const symTrades = allTrades.filter(t => t.symbol === sym);
    if (symTrades.length === 0) continue;
    const withPnl = calcPnl(symTrades);
    const symPnl  = withPnl.reduce((s, t) => s + (t.pnl ?? 0), 0);
    if (symPnl !== 0) pnlBySymbol[sym] = symPnl;
    totalPnl += symPnl;
  }

  const activePairs = [...new Set(allTrades.map(t => t.symbol))];
  out.push(`Trades executats : ${allTrades.length} (${buys.length} compres, ${sells.length} vendes)`);
  out.push(`Ordres tancades  : ${allOrders.length}`);
  out.push(`Parells actius   : ${activePairs.join(", ") || "cap"}`);
  out.push(`PnL total (USDT) : ${totalPnl >= 0 ? "+" : ""}${n(totalPnl, 4)}`);
  if (Object.keys(pnlBySymbol).length > 0) {
    out.push("");
    out.push("PnL per parell:");
    for (const [sym, pnl] of Object.entries(pnlBySymbol).sort((a, b) => b[1] - a[1])) {
      out.push(`  ${col(sym, 12)} ${pnl >= 0 ? "+" : ""}${n(pnl, 4)} USDT`);
    }
  }

  /* ── Trades executats ── */
  section("TRADES EXECUTATS");

  if (allTrades.length === 0) {
    out.push("Cap trade en aquest període.");
  } else {
    // Capçalera de taula
    out.push(
      col("Data/hora",       20) +
      col("Symbol",          10) +
      col("Acció",            6) +
      col("Quantitat",       12) +
      col("Preu",            12) +
      col("Total USDT",      12) +
      col("PnL",             12) +
      col("Estratègia",      18) +
      col("Interval",         8) +
      "Codi"
    );
    out.push("-".repeat(115));

    for (const sym of PAIRS) {
      const symTrades = allTrades.filter(t => t.symbol === sym);
      if (symTrades.length === 0) continue;
      const withPnl = calcPnl(symTrades);

      for (const t of withPnl) {
        const meta     = getMetaForTrade(t);
        const strategy = getStrategyForTrade(t);
        const action   = t.isBuyer ? "BUY" : "SELL";
        const qty      = parseFloat(t.qty);
        const price    = parseFloat(t.price);
        const total    = parseFloat(t.quoteQty);
        const pnlStr   = t.pnl !== null
          ? `${t.pnl >= 0 ? "+" : ""}${n(t.pnl, 4)}`
          : "-";

        out.push(
          col(fmtDatetime(t.time), 20) +
          col(t.symbol,            10) +
          col(action,               6) +
          col(n(qty, 6),           12) +
          col(n(price, 2),         12) +
          col(n(total, 2),         12) +
          col(pnlStr,              12) +
          col(strategy || "-",     18) +
          col(meta?.interval || "-", 8) +
          (meta?.tradeCode || "-")
        );

        if (meta?.exitNotes) {
          out.push(`  → Notes: ${meta.exitNotes}`);
        }
      }
    }
  }

  /* ── Ordres tancades/cancel·lades ── */
  section("ORDRES TANCADES / CANCEL·LADES");

  if (allOrders.length === 0) {
    out.push("Cap ordre en aquest període.");
  } else {
    out.push(
      col("Data/hora",    20) +
      col("Symbol",       10) +
      col("Tipus",        18) +
      col("Costat",        6) +
      col("Quantitat",    12) +
      col("Preu",         12) +
      col("Preu Stop",    12) +
      col("Estat",        14) +
      "Estratègia"
    );
    out.push("-".repeat(110));

    for (const o of allOrders) {
      const strategy = getStrategyForOrder(o);
      const meta     = getMetaForOrder(o);
      const qty      = parseFloat(o.origQty);
      const price    = parseFloat(o.price);
      const stop     = parseFloat(o.stopPrice);

      out.push(
        col(fmtDatetime(o.time), 20) +
        col(o.symbol,            10) +
        col(o.type,              18) +
        col(o.side,               6) +
        col(n(qty, 6),           12) +
        col(price > 0 ? n(price, 2) : "-", 12) +
        col(stop  > 0 ? n(stop,  2) : "-", 12) +
        col(o.status,            14) +
        (strategy || "-") + (meta?.interval ? ` [${meta.interval}]` : "") +
        (meta?.tradeCode ? ` ${meta.tradeCode}` : "")
      );
    }
  }

  /* ── Trailing stops configurats ── */
  section("TRAILING STOPS CONFIGURATS (BD LOCAL)");

  const trailingConfigs = trailingGetAll();
  if (trailingConfigs.length === 0) {
    out.push("Cap configuració de trailing stop registrada.");
  } else {
    out.push(
      col("Symbol",   10) +
      col("Costat",    6) +
      col("Activació",12) +
      col("Distància",10) +
      col("ATR act.", 10) +
      col("ATR dist.",10) +
      col("Lògica",   20) +
      col("Qty",      12) +
      "Entry Price"
    );
    out.push("-".repeat(100));
    for (const t of trailingConfigs) {
      out.push(
        col(t.symbol,              10) +
        col(t.side,                 6) +
        col(n(t.activateAt, 2),    12) +
        col(`${n(t.distance * 100, 2)}%`, 10) +
        col(String(t.activateAtr), 10) +
        col(String(t.distanceAtr), 10) +
        col(t.logic,               20) +
        col(t.quantity,            12) +
        (t.entryPrice > 0 ? n(t.entryPrice, 2) : "-")
      );
    }
  }

  /* ── Trailing actius/recents ── */
  const trailingActive = trailingActiveGetAllIncludingDone();
  const recentActive   = trailingActive.filter(t => t.createdAt >= since);
  if (recentActive.length > 0) {
    out.push("");
    out.push("TRAILING STOPS ACTIUS / RECENTS:");
    out.push(
      col("Symbol",   10) +
      col("Costat",    6) +
      col("Qty",      10) +
      col("SL actual",12) +
      col("Peak",     12) +
      col("Trail%",    8) +
      col("Estat",    10) +
      col("Entry",    12) +
      "Creat"
    );
    out.push("-".repeat(90));
    for (const t of recentActive) {
      out.push(
        col(t.symbol,              10) +
        col(t.side,                 6) +
        col(t.quantity,            10) +
        col(n(t.currentSl, 2),     12) +
        col(n(t.peakPrice, 2),     12) +
        col(`${n(t.trailDist * 100, 2)}%`, 8) +
        col(t.status,              10) +
        col(t.entryPrice > 0 ? n(t.entryPrice, 2) : "-", 12) +
        fmtDatetime(t.createdAt)
      );
    }
  }

  /* ── Logs del servidor (mòduls rellevants) ── */
  section("LOGS DEL SERVIDOR (orders + trailing-engine)");

  const relevantModules = new Set(["orders", "trailing-engine", "order-monitor"]);
  const logLines: string[] = [];
  for (let i = days; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    logLines.push(...readLines(logFilePath(d)));
  }

  let logCount = 0;
  for (const line of logLines) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      const ts  = (obj.time ?? obj.ts) as number;
      if (ts < since) continue;
      const mod = obj.module as string | undefined;
      if (!mod || !relevantModules.has(mod)) continue;
      out.push(formatLogLine(obj));
      logCount++;
    } catch { /* skip */ }
  }
  if (logCount === 0) out.push("Cap entrada de log rellevant en aquest període.");

  /* ── Errors de la BD ── */
  try {
    const errors = getRecentErrors(200).filter(e => e.ts >= since);
    if (errors.length > 0) {
      section("ERRORS REGISTRATS (app_errors)");
      for (const e of [...errors].reverse()) {
        const ctx = e.context
          ? " | " + Object.entries(e.context).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ")
          : "";
        out.push(`[${fmtTime(e.ts)}] ${col(e.severity.toUpperCase(), 8)} [${e.source}]  ${e.code}: ${e.message}${ctx}`);
      }
    }
  } catch { /* DB unavailable */ }

  /* ── Peu ── */
  out.push("");
  out.push("=".repeat(60));
  out.push(`Fi de l'informe. Total línies: ${out.length}`);

  const filename = `estrategia-${fromDay}_${today}.txt`;
  return new Response(out.join("\n"), {
    headers: {
      "Content-Type":        "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
