/**
 * Telegram Bot integration
 * Requires: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env.local
 */

import { log } from "./logger";
import type { BinanceOrder } from "./binance-auth";
import { fmtUSD } from "./format";

const TG_API = `https://api.telegram.org/bot`;

export function isConfigured(): boolean {
  return !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

const KNOWN_QUOTES = ["USDT","USDC","BUSD","FDUSD","TUSD","BTC","ETH","BNB"];

/** Extracts the quote asset from a symbol like "SOLUSDC" → "USDC", "BTCUSDT" → "USDT" */
function quoteOf(symbol: string): string {
  return KNOWN_QUOTES.find(q => symbol.endsWith(q)) ?? "USDT";
}

/** Splits a symbol into [base, quote] display string e.g. "SOLUSDC" → "SOL/USDC" */
function pairOf(symbol: string): string {
  const q = quoteOf(symbol);
  return `${symbol.slice(0, -q.length)}/${q}`;
}

function ts(): string {
  return new Date().toLocaleString("ca-ES", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ── Helpers de format monospace ───────────────────────────────────────────────

function kv(label: string, value: string, w = 14): string {
  return label.padEnd(w) + value;
}

function assetRow(asset: string, valueUSD: number, pct: number, ch24h: number): string {
  const sym = asset.padEnd(5);
  const val = `$${valueUSD.toFixed(2)}`.padStart(10);
  const p   = `${pct.toFixed(1)}%`.padStart(6);
  const c   = `${ch24h >= 0 ? "+" : ""}${ch24h.toFixed(2)}%`.padStart(8);
  return `${sym} ${val}  ${p}  ${c}`;
}

const COL_HDR = `${"Asset".padEnd(5)} ${"Valor".padStart(10)}  ${"Pes".padStart(6)}  ${"24h".padStart(8)}`;
const COL_SEP = "─".repeat(36);

function pre(lines: string[]): string {
  return `<pre>${lines.join("\n")}</pre>`;
}

// ── Colors semàntics ──────────────────────────────────────────────────────────
// Usats com a fons dels gràfics/targetes QuickChart

const COLOR = {
  green:  "#14532d",   // guanys
  red:    "#7f1d1d",   // pèrdues
  gray:   "#1f2937",   // neutre / informació
  blue:   "#1e3a5f",   // compra / nova ordre
  orange: "#7c2d12",   // modificació / activació
} as const;

type CardColor = keyof typeof COLOR;

function pickColor(value: number | null | undefined): CardColor {
  if (value == null) return "gray";
  if (value > 0)  return "green";
  if (value < 0)  return "red";
  return "gray";
}

// ── QuickChart: targeta de color sòlid (per a notificacions) ──────────────────

function buildColoredCardUrl(
  title: string,
  subtitles: string[],
  color: CardColor,
): string {
  const chart = {
    type: "bar",
    data: {
      labels: [""],
      datasets: [{ data: [0], backgroundColor: "transparent", borderWidth: 0 }],
    },
    options: {
      plugins: {
        title: {
          display: true, text: title, color: "#ffffff",
          font: { size: 19, weight: "bold" },
          padding: { top: 22, bottom: subtitles.length ? 6 : 22 },
        },
        subtitle: {
          display: subtitles.length > 0,
          text: subtitles, color: "#d1d5db",
          font: { size: 13 },
          padding: { bottom: 22 },
        },
        legend: { display: false },
      },
      scales: {
        x: { display: false },
        y: { display: false, min: 0, max: 1 },
      },
      layout: { padding: 24 },
    },
  };
  const bg = encodeURIComponent(COLOR[color]);
  return `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chart))}&backgroundColor=${bg}&width=420&height=155`;
}

// ── QuickChart: donut de portfolio ────────────────────────────────────────────

const ASSET_COLORS: Record<string, string> = {
  BTC: "#F7931A", ETH: "#627EEA", BNB: "#F0B90B", SOL: "#9945FF",
  XRP: "#00AAE4", ADA: "#0033AD", DOT: "#E6007A", LINK: "#2A5ADA",
  AVAX: "#E84142", MATIC: "#8247E5",
};
const FALLBACK_COLORS = ["#00C087","#2EBAC6","#FF6384","#36A2EB","#FFCE56","#4BC0C0"];

function buildPortfolioChartUrl(
  top: Array<{ asset: string; valueUSD: number; pct: number }>,
  bgColor: CardColor = "gray",
): string {
  const bg     = COLOR[bgColor];
  const colors = top.map((a, i) => ASSET_COLORS[a.asset] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]);
  const chart  = {
    type: "doughnut",
    data: {
      labels: top.map(a => `${a.asset} ${a.pct.toFixed(1)}%`),
      datasets: [{ data: top.map(a => +a.valueUSD.toFixed(0)), backgroundColor: colors, borderWidth: 2, borderColor: bg }],
    },
    options: {
      plugins: {
        legend:     { display: true, position: "bottom", labels: { color: "#f3f4f6", font: { size: 12 } } },
        datalabels: { display: false },
      },
    },
  };
  return `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chart))}&backgroundColor=${encodeURIComponent(bg)}&width=420&height=310`;
}

// ── Missatge de text ──────────────────────────────────────────────────────────

function getTgCredentials(mode?: string): { token: string; chatId: string } | null {
  if (mode === "real") {
    const token  = process.env.TELEGRAM_BOT_TOKEN_REAL  ?? process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID_REAL    ?? process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return null;
    return { token, chatId };
  }
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return null;
  return { token, chatId };
}

export async function sendTelegram(text: string, mode?: string): Promise<void> {
  const creds = getTgCredentials(mode);
  if (!creds) {
    log.telegram.warn({ mode }, "TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID no configurats");
    return;
  }
  const res = await fetch(`${TG_API}${creds.token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: creds.chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  if (!res.ok) {
    const err = await res.text();
    log.telegram.error({ status: res.status, err, mode }, "error enviant missatge");
  }
}

// ── Foto amb caption monospace ────────────────────────────────────────────────

export async function sendTelegramPhoto(caption: string, imageUrl: string): Promise<void> {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  const res = await fetch(`${TG_API}${token}/sendPhoto`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, photo: imageUrl, caption, parse_mode: "HTML" }),
  });
  if (!res.ok) {
    log.telegram.warn({ status: res.status }, "foto fallida, enviant com a text");
    await sendTelegram(caption);
  }
}

// ── Helper: envia targeta de color + <pre> com a caption ──────────────────────

export async function sendCard(
  cardTitle: string,
  _cardSubs: string[],
  _color: CardColor,
  block: string[],
  mode?: string,
): Promise<void> {
  const prefix = mode === "real" ? "🟠 REAL · " : "";
  await sendTelegram(`<b>${prefix}${cardTitle}</b>\n\n${pre(block)}`, mode);
}

// ── Informe horari ────────────────────────────────────────────────────────────

export async function sendHourlyPortfolioReport(data: {
  totalValue:  number;
  delta1h:     number | null;
  openOrders:  number;
  ocoCount:    number;
  limitCount:  number;
  top:     Array<{ asset: string; valueUSD: number; pct: number; change24h: number }>;
  stables: Array<{ asset: string; valueUSD: number; pct: number }>;
}): Promise<void> {
  const up   = (data.delta1h ?? 0) >= 0;
  const sign = up ? "+" : "";
  const pct1h = data.delta1h != null && (data.totalValue - data.delta1h) > 0
    ? (data.delta1h / (data.totalValue - data.delta1h)) * 100
    : null;

  const title = up ? "📈 RESUM HORARI" : "📉 RESUM HORARI";

  const summaryLines: string[] = [
    kv("Saldo",    fmtUSD(data.totalValue)),
    data.delta1h != null
      ? kv("Canvi 1h", pct1h != null
          ? `${sign}${fmtUSD(data.delta1h)}  (${sign}${pct1h.toFixed(2)}%)`
          : `${sign}${fmtUSD(data.delta1h)}`)
      : kv("Canvi 1h", "sense dades prèvies"),
    kv("Ordres",   `${data.openOrders}  (${data.ocoCount} OCO · ${data.limitCount} LIM)`),
  ];

  const cryptoLines: string[] = data.top.length > 0
    ? ["", "Crypto", COL_HDR, COL_SEP, ...data.top.map(a => assetRow(a.asset, a.valueUSD, a.pct, a.change24h))]
    : [];

  const stableLines: string[] = data.stables.length > 0
    ? ["", "Stables", ...data.stables.map(a =>
        `${a.asset.padEnd(6)} ${fmtUSD(a.valueUSD).padStart(10)}  ${(a.pct.toFixed(1)+"%").padStart(6)}`)]
    : [];

  const block = [...summaryLines, ...cryptoLines, ...stableLines, "", kv("Hora", ts())];
  await sendTelegram(`<b>${title}</b>\n\n${pre(block)}`);
}

// ── Notificació: ordre executada ──────────────────────────────────────────────

export async function notifyOrderFill(data: {
  symbol:      string;
  side:        "BUY" | "SELL";
  type:        string;
  execPrice:   number;
  origQty:     number;
  execValue:   number;
  orderListId: number;
  mode?:    string;
}): Promise<void> {
  const base  = data.symbol.replace(/USDT$|USDC$|BUSD$|FDUSD$|TUSD$/, "");
  const isTP  = data.type === "LIMIT_MAKER";
  const isSL  = data.type === "STOP_LOSS_LIMIT" || data.type === "STOP_LOSS";
  const isBuy = data.side === "BUY";

  const label  = isTP ? "✅ TAKE PROFIT" : isSL ? "🛑 STOP LOSS" : isBuy ? "🟢 COMPRA" : "🔵 VENDA";
  const color: CardColor = isTP ? "green" : isSL ? "red" : "blue";
  const qty    = data.origQty;
  const qtyStr = `${qty.toFixed(qty < 1 ? 6 : 4)} ${base}`;

  await sendCard(
    `${label}  ·  ${pairOf(data.symbol)}`,
    [`Preu: ${fmtUSD(data.execPrice)}  ·  Valor: ${fmtUSD(data.execValue)}`],
    color,
    [
      kv("Símbol",    pairOf(data.symbol)),
      kv("Preu",      fmtUSD(data.execPrice)),
      kv("Quantitat", qtyStr),
      kv("Valor",     fmtUSD(data.execValue)),
      ...(data.orderListId !== -1 ? [kv("OCO", `#${data.orderListId}`)] : []),
      kv("Hora",      ts()),
    ],
      data.mode,
);
}

// ── Notificació: trailing stop executat ──────────────────────────────────────

export async function notifyTrailingFill(data: {
  symbol:    string;
  side:      string;
  stopPrice: number;
  qty:       string;
  mode?:    string;
}): Promise<void> {
  const base   = data.symbol.replace(/USDT$|USDC$|BUSD$|FDUSD$|TUSD$/, "");
  const qty    = parseFloat(data.qty);
  const qtyStr = `${qty.toFixed(qty < 1 ? 6 : 4)} ${base}`;

  await sendCard(
    `🔴 TRAILING STOP  ·  ${pairOf(data.symbol)}`,
    [`Stop: ${fmtUSD(data.stopPrice)}  ·  Valor: ${fmtUSD(qty * data.stopPrice)}`],
    "red",
    [
      kv("Símbol",      pairOf(data.symbol)),
      kv("Stop activat", fmtUSD(data.stopPrice)),
      kv("Quantitat",   qtyStr),
      kv("Valor est.",  fmtUSD(qty * data.stopPrice)),
      kv("Hora",        ts()),
    ],
      data.mode,
);
}

// ── Informe d'ordres en curs ──────────────────────────────────────────────────

export async function sendOpenOrdersReport(orders: BinanceOrder[]): Promise<void> {
  if (!orders.length) {
    await sendCard(
      "📋 ORDRES EN CURS",
      ["Cap ordre oberta"],
      "gray",
      [kv("Estat", "Cap ordre oberta"), kv("Hora", ts())],
    );

    return;
  }

  const ocoMap = new Map<number, BinanceOrder[]>();
  const singles: BinanceOrder[] = [];
  for (const o of orders) {
    if (o.orderListId !== -1) {
      const g = ocoMap.get(o.orderListId) ?? [];
      g.push(o); ocoMap.set(o.orderListId, g);
    } else {
      singles.push(o);
    }
  }

  const totalPos  = ocoMap.size + singles.length;
  const textParts: string[] = [
    `<b>📋 ORDRES EN CURS</b>  —  ${totalPos} posició${totalPos !== 1 ? "ns" : ""}  (${ocoMap.size} OCO · ${singles.length} simples)`,
  ];

  for (const [listId, legs] of ocoMap) {
    const base = legs[0].symbol.replace(/USDT$|USDC$|BUSD$|FDUSD$|TUSD$/, "");
    const qty  = parseFloat(legs[0].origQty);
    const tp   = legs.find(l => l.type === "LIMIT_MAKER");
    const sl   = legs.find(l => l.type === "STOP_LOSS_LIMIT" || l.type === "STOP_LOSS");
    const block = [
      `OCO #${listId}  ·  ${pairOf(legs[0].symbol)}`,
      COL_SEP.slice(0, 22),
      ...(tp ? [kv("TP",       fmtUSD(parseFloat(tp.price)))] : []),
      ...(sl ? [kv("SL stop",  fmtUSD(parseFloat(sl.stopPrice)))] : []),
      ...(sl ? [kv("SL límit", fmtUSD(parseFloat(sl.price)))] : []),
      kv("Qty", `${qty.toFixed(qty < 1 ? 6 : 4)} ${base}`),
    ];
    textParts.push(pre(block));
  }

  for (const o of singles) {
    const base  = o.symbol.replace(/USDT$|USDC$|BUSD$|FDUSD$|TUSD$/, "");
    const qty   = parseFloat(o.origQty);
    const price = parseFloat(o.price) || parseFloat(o.stopPrice);
    const typeLabels: Record<string, string> = {
      LIMIT: "LIMIT", LIMIT_MAKER: "LIMIT MAKER",
      STOP_LOSS_LIMIT: "STOP LOSS", STOP_LOSS: "STOP LOSS",
    };
    const block = [
      `${typeLabels[o.type] ?? o.type}  ·  ${pairOf(o.symbol)}  ·  ${o.side}`,
      COL_SEP.slice(0, 22),
      ...(parseFloat(o.stopPrice) > 0
        ? [kv("Stop", fmtUSD(parseFloat(o.stopPrice))), kv("Límit", fmtUSD(parseFloat(o.price)))]
        : [kv("Preu", fmtUSD(price))]),
      kv("Qty", `${qty.toFixed(qty < 1 ? 6 : 4)} ${base}`),
    ];
    textParts.push(pre(block));
  }

  textParts.push(`🕐 ${ts()}`);
  await sendTelegram(textParts.join("\n"));
}

// ── Informe de portfolio (amb donut) ──────────────────────────────────────────

export async function sendPortfolioReport(data: {
  totalValue:   number;
  cryptoValue?: number;
  stableValue?: number;
  pnl24h:       number;
  pnlPct:       number;
  delta1h?:     number | null;
  delta24h?:    number | null;
  openOrders:   number;
  ocoCount:     number;
  limitCount:   number;
  top:     Array<{ asset: string; valueUSD: number; pct: number; change24h: number }>;
  stables?: Array<{ asset: string; valueUSD: number; pct: number }>;
}): Promise<void> {
  const color = pickColor(data.delta24h ?? data.delta1h ?? data.pnl24h);
  const s24   = data.pnl24h  >= 0 ? "+" : "";
  const sd1   = (data.delta1h  ?? 0) >= 0 ? "+" : "";
  const sd24  = (data.delta24h ?? 0) >= 0 ? "+" : "";

  const summaryLines: string[] = [
    kv("Saldo total",  fmtUSD(data.totalValue)),
    ...(data.cryptoValue != null ? [kv("Crypto",  fmtUSD(data.cryptoValue))] : []),
    ...(data.stableValue != null ? [kv("Stables", fmtUSD(data.stableValue))] : []),
    ...(data.delta1h  != null ? [kv("Canvi 1h",  `${sd1}${fmtUSD(data.delta1h)}  (${sd1}${(data.delta1h  / (data.totalValue - data.delta1h)  * 100).toFixed(2)}%)`)] : []),
    ...(data.delta24h != null ? [kv("Canvi 24h", `${sd24}${fmtUSD(data.delta24h)}  (${sd24}${(data.delta24h / (data.totalValue - data.delta24h) * 100).toFixed(2)}%)`)] : []),
    kv("Mercat 24h",  `${s24}${fmtUSD(data.pnl24h)}  (${s24}${data.pnlPct.toFixed(2)}%)`),
    kv("Ordres",      `${data.openOrders}  (${data.ocoCount} OCO · ${data.limitCount} LIM)`),
  ];

  const cryptoLines: string[] = data.top.length > 0
    ? ["", "Crypto", COL_HDR, COL_SEP, ...data.top.map(a => assetRow(a.asset, a.valueUSD, a.pct, a.change24h))]
    : [];

  const stableLines: string[] = (data.stables ?? []).length > 0
    ? ["", "Stables", ...(data.stables!.map(a =>
        `${a.asset.padEnd(6)} ${fmtUSD(a.valueUSD).padStart(10)}  ${(a.pct.toFixed(1)+"%").padStart(6)}`))]
    : [];

  const block = [...summaryLines, ...cryptoLines, ...stableLines, "", kv("Hora", ts())];
  await sendTelegram(`<b>📊 INFORME DE PORTFOLIO</b>\n\n${pre(block)}`);
}

// ── Notificació: nova ordre col·locada ────────────────────────────────────────

export async function notifyNewOrder(data: {
  symbol:       string;
  type:         "OCO" | "BUY_AND_EXIT";
  quoteQty?:    number;
  quantity?:    string;
  fillPrice?:   number;
  tpPrice:      string;
  slStopPrice:  string;
  orderListId?: number;
  mode?:    string;
}): Promise<void> {
  const base      = data.symbol.replace(/USDT$|USDC$|BUSD$|FDUSD$|TUSD$/, "");
  const isBuyExit = data.type === "BUY_AND_EXIT";
  const label     = isBuyExit ? "🛒 COMPRA + OCO" : "📌 NOVA ORDRE OCO";

  const subs: string[] = [
    `TP: ${fmtUSD(parseFloat(data.tpPrice))}  ·  SL: ${fmtUSD(parseFloat(data.slStopPrice))}`,
  ];

  await sendCard(
    `${label}  ·  ${pairOf(data.symbol)}`,
    subs,
    "blue",
    [
      kv("Símbol", pairOf(data.symbol)),
      ...(isBuyExit && data.fillPrice ? [kv("Compra a",  fmtUSD(data.fillPrice))]  : []),
      ...(isBuyExit && data.quoteQty  ? [kv("Invertit",  fmtUSD(data.quoteQty))]   : []),
      ...(!isBuyExit && data.quantity ? [kv("Quantitat", `${data.quantity} ${base}`)] : []),
      kv("Take Profit", fmtUSD(parseFloat(data.tpPrice))),
      kv("Stop Loss",   fmtUSD(parseFloat(data.slStopPrice))),
      ...(data.orderListId != null && data.orderListId !== -1 ? [kv("OCO", `#${data.orderListId}`)] : []),
      kv("Hora", ts()),
    ],
      data.mode,
);
}

// ── Notificació: venda de mercat a USDT ──────────────────────────────────────

export async function notifyOrderSold(data: {
  symbol:       string;
  executedQty:  string;
  receivedUSDT: string;
  fillPrice:    number;
  mode?:    string;
}): Promise<void> {
  const base   = data.symbol.replace(/USDT$|USDC$|BUSD$|FDUSD$|TUSD$/, "");
  const qty    = parseFloat(data.executedQty);
  const qtyStr = `${qty.toFixed(qty < 1 ? 6 : 4)} ${base}`;

  await sendCard(
    `💸 VENDA A MERCAT  ·  ${pairOf(data.symbol)}`,
    [`${fmtUSD(data.fillPrice)}  →  ${fmtUSD(parseFloat(data.receivedUSDT))} ${quoteOf(data.symbol)}`],
    "blue",
    [
      kv("Símbol",    pairOf(data.symbol)),
      kv("Preu exec.", fmtUSD(data.fillPrice)),
      kv("Quantitat", qtyStr),
      kv("Rebut",     fmtUSD(parseFloat(data.receivedUSDT))),
      kv("Hora",      ts()),
    ],
      data.mode,
);
}

// ── Notificació: Stop Loss modificat ─────────────────────────────────────────

export async function notifySlModified(data: {
  symbol:       string;
  oldSl?:       number;
  newSlStop:    string;
  newSlLimit:   string;
  tpPrice?:     string;
  orderListId?: number;
  orderId?:     number;
  mode?:    string;
}): Promise<void> {
  const base = data.symbol.replace(/USDT$|USDC$|BUSD$|FDUSD$|TUSD$/, "");

  await sendCard(
    `🛡 STOP LOSS MODIFICAT  ·  ${pairOf(data.symbol)}`,
    [`Nou stop: ${fmtUSD(parseFloat(data.newSlStop))}`],
    "orange",
    [
      kv("Símbol",    pairOf(data.symbol)),
      ...(data.oldSl != null ? [kv("SL anterior",  fmtUSD(data.oldSl))] : []),
      kv("SL nou stop", fmtUSD(parseFloat(data.newSlStop))),
      kv("SL nou lím",  fmtUSD(parseFloat(data.newSlLimit))),
      ...(data.tpPrice ? [kv("Take Profit", fmtUSD(parseFloat(data.tpPrice)))] : []),
      ...(data.orderListId != null && data.orderListId !== -1
        ? [kv("OCO", `#${data.orderListId}`)]
        : data.orderId != null ? [kv("Ordre", `#${data.orderId}`)] : []),
      kv("Hora", ts()),
    ],
      data.mode,
);
}

// ── Notificació: ordre cancel·lada ────────────────────────────────────────────

export async function notifyOrderCancel(data: {
  symbol:       string;
  side:         "BUY" | "SELL";
  type:         string;
  origQty:      number;
  price:        number;
  orderId?:     number;
  orderListId?: number;
  mode?:    string;
}): Promise<void> {
  const base  = data.symbol.replace(/USDT$|USDC$|BUSD$|FDUSD$|TUSD$/, "");
  const qty   = data.origQty;
  const isOco = (data.orderListId ?? -1) !== -1;

  await sendCard(
    `⚫ ORDRE CANCEL·LADA  ·  ${pairOf(data.symbol)}`,
    [`${data.side === "BUY" ? "Compra" : "Venda"}  ·  ${qty.toFixed(qty < 1 ? 6 : 4)} ${base}`],
    "gray",
    [
      kv("Símbol",    pairOf(data.symbol)),
      kv("Direcció",  data.side === "BUY" ? "Compra" : "Venda"),
      kv("Quantitat", `${qty.toFixed(qty < 1 ? 6 : 4)} ${base}`),
      ...(data.price > 0 ? [kv("Preu límit", fmtUSD(data.price))] : []),
      ...(isOco ? [kv("OCO", `#${data.orderListId}`)] : data.orderId ? [kv("Ordre", `#${data.orderId}`)] : []),
      kv("Hora", ts()),
    ],
      data.mode,
);
}

// ── Notificació: posició detectada sense stop-loss ────────────────────────────

export async function notifyOrphanDetected(data: {
  symbol:      string;
  valueUsd:    number;
  qty:         string;
  entryPrice:  number | null;
  fixIn:       number;
  orderId:     number | null;
  orderListId: number | null;
  tradeCode:   string | null;
  mode?:    string;
}): Promise<void> {
  const base = data.symbol.replace(/USDT$|USDC$|BUSD$|FDUSD$|TUSD$/, "");
  await sendCard(
    `🚨 POSICIÓ SENSE SL  ·  ${pairOf(data.symbol)}`,
    [`Aplicant correcció en ${data.fixIn} min`],
    "orange",
    [
      kv("Símbol",     pairOf(data.symbol)),
      kv("Valor",      fmtUSD(data.valueUsd)),
      kv("Quantitat",  `${data.qty} ${base}`),
      ...(data.entryPrice  ? [kv("Entrada est.",  fmtUSD(data.entryPrice))]        : []),
      ...(data.tradeCode   ? [kv("Codi trade",    data.tradeCode)]                 : []),
      ...(data.orderListId != null && data.orderListId > 0
                           ? [kv("OCO #",         String(data.orderListId))]       : []),
      ...(data.orderId     != null && data.orderId > 0
                           ? [kv("Ordre #",       String(data.orderId))]           : []),
      kv("Correcció",  `en ${data.fixIn} min (lògica bot actiu)`),
      kv("Hora",       ts()),
    ],
      data.mode,
);
}

// ── Notificació: posició òrfena venuda a mercat (sense bot) ──────────────────

export async function notifyOrphanNoBot(data: {
  symbol:      string;
  qty:         string;
  fillPrice:   number;
  receivedUsd: number;
  entryPrice:  number | null;
  orderId:     number | null;
  orderListId: number | null;
  tradeCode:   string | null;
  mode?:    string;
}): Promise<void> {
  const base   = data.symbol.replace(/USDT$|USDC$|BUSD$|FDUSD$|TUSD$/, "");
  const qty    = parseFloat(data.qty);
  const qtyStr = `${qty.toFixed(qty < 1 ? 6 : 4)} ${base}`;

  const pnlUsd = data.entryPrice ? (data.fillPrice - data.entryPrice) * qty : null;
  const pnlPct = data.entryPrice ? ((data.fillPrice - data.entryPrice) / data.entryPrice) * 100 : null;
  const pnlSign = pnlUsd != null ? (pnlUsd >= 0 ? "+" : "") : "";

  await sendCard(
    `🚨 VENDA AUTOMÀTICA — POSICIÓ ÒRFENA  ·  ${pairOf(data.symbol)}`,
    ["Cap bot actiu — posició tancada a mercat per seguretat"],
    "red",
    [
      kv("Símbol",      pairOf(data.symbol)),
      kv("Quantitat",   qtyStr),
      kv("Preu exec.",  fmtUSD(data.fillPrice)),
      kv("Rebut",       fmtUSD(data.receivedUsd)),
      ...(data.entryPrice  ? [kv("Entrada est.", fmtUSD(data.entryPrice))]  : []),
      ...(pnlUsd != null   ? [kv("PnL", `${pnlSign}${fmtUSD(pnlUsd)} (${pnlSign}${pnlPct!.toFixed(2)}%)`)] : []),
      ...(data.tradeCode   ? [kv("Codi trade",  data.tradeCode)]            : []),
      ...(data.orderListId != null && data.orderListId > 0
                           ? [kv("OCO #",       String(data.orderListId))]  : []),
      ...(data.orderId     != null && data.orderId > 0
                           ? [kv("Ordre #",     String(data.orderId))]      : []),
      kv("Motiu",       "Sense OCO/SL i cap bot configurat per al símbol"),
      kv("Hora",        ts()),
    ],
      data.mode,
);
}

// ── Notificació: OCO no col·locada (reintent pendent) ────────────────────────

export async function notifyOcoFailed(data: {
  symbol:    string;
  fillPrice: number;
  quoteQty:  number;
  ocoQty:    string;
  tpPrice:   string;
  slPrice:   string;
  error:     string;
  journalId: number;
  mode?:    string;
}): Promise<void> {
  const base = data.symbol.replace(/USDT$|USDC$|BUSD$|FDUSD$|TUSD$/, "");
  await sendCard(
    `⚠️ COMPRA SENSE OCO  ·  ${pairOf(data.symbol)}`,
    [`Posició sense SL/TP — reintent en curs`],
    "orange",
    [
      kv("Símbol",    pairOf(data.symbol)),
      kv("Compra a",  fmtUSD(data.fillPrice)),
      kv("Invertit",  fmtUSD(data.quoteQty)),
      kv("Quantitat", `${data.ocoQty} ${base}`),
      kv("TP previst", fmtUSD(parseFloat(data.tpPrice))),
      kv("SL previst", fmtUSD(parseFloat(data.slPrice))),
      kv("Error",     data.error.slice(0, 60)),
      kv("Journal",   `#${data.journalId}`),
      kv("Hora",      ts()),
    ],
      data.mode,
);
}

// ── Notificació: escaneig de mercat (decisió d'entrada) ──────────────────────

export type ScanDecision =
  | "BUY_EXECUTED"
  | "NO_SIGNAL"
  | "MULTI_TF_FAIL"
  | "TRAILING_ACTIVE";

export interface ScanSymbolResult {
  symbol:       string;
  price:        number;
  score:        number;
  verdict:      string;
  decision:     ScanDecision;
  probability?: number;   // probabilitat calculada (score * 0.7 + bonuses)
  reason?:      string;   // motiu detallat del rebuig
  strategy?:    string;   // nom de l'estratègia millor (si n'hi ha)
}

export async function notifyMarketScan(data: {
  botName:     string;
  interval:    string;
  minScore:    number;
  skipReason?: string;
  results:     ScanSymbolResult[];
  mode?:    string;
}): Promise<void> {
  const DECISION_ICON: Record<ScanDecision, string> = {
    BUY_EXECUTED:   "✅ COMPRA EXECUTADA",
    NO_SIGNAL:      "⏸ sense senyal",
    MULTI_TF_FAIL:  "🔀 multi-TF no confirmat",
    TRAILING_ACTIVE:"🔵 trailing actiu",
  };

  const modePrefix = data.mode === "real" ? "🟠 REAL · " : "";
  const header = `🔍 ${modePrefix}ESCANEIG · ${data.botName}`;

  if (data.skipReason) {
    await sendTelegram(`<b>${header}</b>\n⏭ Omès: ${data.skipReason}\n<i>${ts()}</i>`, data.mode);
    return;
  }

  const scoreBar = (s: number) => {
    const filled = Math.round(s / 10);
    return "█".repeat(filled) + "░".repeat(10 - filled);
  };

  const rows = data.results.map(r => {
    const base  = r.symbol.replace(/USDT$|USDC$/,"").padEnd(5);
    const price = fmtUSD(r.price).padStart(10);
    const score = `${r.score}`.padStart(3);
    const bar   = scoreBar(r.score);
    const dec   = DECISION_ICON[r.decision];

    let detail = "";
    if (r.probability !== undefined) {
      detail += `  prob: ${r.probability.toFixed(0)}% / mínim ${data.minScore}%`;
    }
    if (r.strategy) {
      detail += `  [${r.strategy}]`;
    }
    if (r.reason) {
      detail += `\n         motiu: ${r.reason}`;
    }

    return `${base} ${price}  ${score}/100  ${bar}\n       → ${dec}${detail}`;
  });

  const infoLine = `Interval: ${data.interval}  ·  Mínim: ${data.minScore}%  ·  ${ts()}`;
  const body     = rows.length > 0 ? pre([infoLine, "─".repeat(40), ...rows]) : pre([infoLine, "(cap símbol analitzat)"]);

  await sendTelegram(`<b>${header}</b>\n${body}`, data.mode);
}

// ── Notificació: trailing stop activat ───────────────────────────────────────

export async function notifyTrailingActivated(data: {
  symbol:      string;
  side:        string;
  price:       number;
  initialSl:   string;
  distance:    number;
  orderListId: number;
  mode?:    string;
}): Promise<void> {
  const base = data.symbol.replace(/USDT$|USDC$|BUSD$|FDUSD$|TUSD$/, "");

  await sendCard(
    `🔔 TRAILING ACTIVAT  ·  ${pairOf(data.symbol)}`,
    [`Activació: ${fmtUSD(data.price)}  ·  SL: ${fmtUSD(parseFloat(data.initialSl))}`],
    "orange",
    [
      kv("Símbol",      pairOf(data.symbol)),
      kv("Activació",   fmtUSD(data.price)),
      kv("SL inicial",  fmtUSD(parseFloat(data.initialSl))),
      kv("Distància",   fmtUSD(data.distance)),
      kv("OCO cancel.", `#${data.orderListId}`),
      kv("Hora",        ts()),
    ],
      data.mode,
);
}
