/**
 * POST /api/telegram/test-all
 * Envia un missatge de prova de cada tipus de notificació.
 */
import { NextResponse } from "next/server";
import {
  isConfigured, sendCard,
  sendPortfolioReport, sendOpenOrdersReport,
  notifyOrderFill, notifyTrailingActivated, notifyTrailingFill,
  notifyNewOrder, notifyOrderSold, notifySlModified, notifyOrderCancel,
} from "../../../lib/telegram";
import type { BinanceOrder } from "../../../lib/binance-auth";
import { fmtUSD } from "../../../lib/format";

function ts() {
  return new Date().toLocaleString("ca-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
function kv(label: string, value: string, w = 14): string {
  return label.padEnd(w) + value;
}

export async function POST() {
  if (!isConfigured()) {
    return NextResponse.json(
      { ok: false, error: "TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID no configurats" },
      { status: 400 }
    );
  }

  const results: Record<string, "ok" | string> = {};

  // ── 1. Connexió bàsica ────────────────────────────────────────────────────
  try {
    await sendCard(
      "🧪 TEST DE CONNEXIÓ",
      ["Les notificacions Telegram funcionen ✅"],
      "gray",
      [kv("Estat", "OK"), kv("Hora", ts())],
    );
    results.connexio = "ok";
  } catch (e) { results.connexio = String(e); }

  // ── 2. Ordre executada (TP) ───────────────────────────────────────────────
  try {
    await notifyOrderFill({
      symbol: "BTCUSDT", side: "SELL", type: "LIMIT_MAKER",
      execPrice: 85420, origQty: 0.0012, execValue: 102.50, orderListId: 123456,
    });
    results.ordre_tp = "ok";
  } catch (e) { results.ordre_tp = String(e); }

  // ── 3. Stop Loss activat ─────────────────────────────────────────────────
  try {
    await notifyOrderFill({
      symbol: "ETHUSDT", side: "SELL", type: "STOP_LOSS_LIMIT",
      execPrice: 3180, origQty: 0.05, execValue: 159, orderListId: 789012,
    });
    results.ordre_sl = "ok";
  } catch (e) { results.ordre_sl = String(e); }

  // ── 4. Informe horari ────────────────────────────────────────────────────
  try {
    const delta1h = 23.15;
    const pct1h   = 0.18;
    const COL_HDR = `${"Asset".padEnd(5)} ${"Valor".padStart(10)}  ${"Pes".padStart(6)}  ${"24h".padStart(8)}`;
    const COL_SEP = "─".repeat(36);
    const assetRow = (a: string, v: number, p: number, c: number) =>
      `${a.padEnd(5)} ${"$"+v.toFixed(2)}`.padEnd(17) +
      `  ${(p.toFixed(1)+"%").padStart(6)}  ${((c>=0?"+":"")+c.toFixed(2)+"%").padStart(8)}`;

    await sendCard(
      "📈 RESUM HORARI",
      [`+${fmtUSD(delta1h)}  (+${pct1h.toFixed(2)}%)  ·  ${fmtUSD(12845.32)}`],
      "green",
      [
        kv("Saldo",    fmtUSD(12845.32)),
        kv("Canvi 1h", `+${fmtUSD(delta1h)}  (+${pct1h.toFixed(2)}%)`),
        kv("Ordres",   "4  (2 OCO · 2 LIM)"),
        "",
        "Crypto", COL_HDR, COL_SEP,
        assetRow("BTC",  8450,    65.8,  1.24),
        assetRow("ETH",  2100,    16.3,  0.85),
        assetRow("SOL",   850,     6.6, -0.42),
        "",
        "Stables",
        `${"USDT".padEnd(6)} ${"$845.32".padStart(10)}  ${"6.6%".padStart(6)}`,
        "",
        kv("Hora", ts()),
      ],
    );
    results.informe_horari = "ok";
  } catch (e) { results.informe_horari = String(e); }

  // ── 5. Informe portfolio (amb gràfic) ─────────────────────────────────────
  try {
    await sendPortfolioReport({
      totalValue:  12845.32,
      cryptoValue: 12000.00,
      stableValue:   845.32,
      pnl24h:        345.20,
      pnlPct:          2.76,
      delta1h:         23.15,
      delta24h:       312.40,
      openOrders: 4,
      ocoCount:   2,
      limitCount: 2,
      top: [
        { asset: "BTC", valueUSD: 8450.00, pct: 65.8, change24h:  1.24 },
        { asset: "ETH", valueUSD: 2100.00, pct: 16.3, change24h:  0.85 },
        { asset: "SOL", valueUSD:  850.00, pct:  6.6, change24h: -0.42 },
        { asset: "BNB", valueUSD:  600.00, pct:  4.7, change24h:  2.10 },
      ],
      stables: [
        { asset: "USDT", valueUSD: 845.32, pct: 6.6 },
      ],
    });
    results.informe_portfolio = "ok";
  } catch (e) { results.informe_portfolio = String(e); }

  // ── 6. Informe d'ordres ───────────────────────────────────────────────────
  try {
    const base: Omit<BinanceOrder, "orderId"|"orderListId"|"symbol"|"side"|"type"|"origQty"|"price"|"stopPrice"> = {
      executedQty: "0", timeInForce: "GTC", status: "NEW", updateTime: Date.now(), time: Date.now(),
    };
    const fakeOrders: BinanceOrder[] = [
      { ...base, symbol: "BTCUSDT", orderId: 1, orderListId: 111, side: "SELL", type: "LIMIT_MAKER",
        origQty: "0.001200", price: "87000.00", stopPrice: "0" },
      { ...base, symbol: "BTCUSDT", orderId: 2, orderListId: 111, side: "SELL", type: "STOP_LOSS_LIMIT",
        origQty: "0.001200", price: "82000.00", stopPrice: "82500.00" },
      { ...base, symbol: "ETHUSDT", orderId: 3, orderListId: -1, side: "BUY", type: "LIMIT",
        origQty: "0.050000", price: "3100.00", stopPrice: "0" },
    ];
    await sendOpenOrdersReport(fakeOrders);
    results.informe_ordres = "ok";
  } catch (e) { results.informe_ordres = String(e); }

  // ── 7. Trailing stop activat ──────────────────────────────────────────────
  try {
    await notifyTrailingActivated({
      symbol: "SOLUSDT", side: "SELL", price: 152.40,
      initialSl: "145.80", distance: 6.60, orderListId: 345678,
    });
    results.trailing_activat = "ok";
  } catch (e) { results.trailing_activat = String(e); }

  // ── 8. Trailing stop executat ─────────────────────────────────────────────
  try {
    await notifyTrailingFill({
      symbol: "SOLUSDT", side: "SELL", stopPrice: 148.50, qty: "5.000000",
    });
    results.trailing_fill = "ok";
  } catch (e) { results.trailing_fill = String(e); }

  // ── 9. Nova ordre OCO ─────────────────────────────────────────────────────
  try {
    await notifyNewOrder({
      symbol: "BNBUSDT", type: "BUY_AND_EXIT",
      fillPrice: 598.20, quoteQty: 200,
      tpPrice: "640.00", slStopPrice: "572.00", orderListId: 567890,
    });
    results.nova_ordre = "ok";
  } catch (e) { results.nova_ordre = String(e); }

  // ── 10. Venda a mercat ────────────────────────────────────────────────────
  try {
    await notifyOrderSold({
      symbol: "BNBUSDT", executedQty: "0.334000",
      receivedUSDT: "197.85", fillPrice: 592.37,
    });
    results.venda_mercat = "ok";
  } catch (e) { results.venda_mercat = String(e); }

  // ── 11. SL modificat ─────────────────────────────────────────────────────
  try {
    await notifySlModified({
      symbol: "BTCUSDT", oldSl: 80000,
      newSlStop: "83000.00", newSlLimit: "82800.00",
      tpPrice: "90000.00", orderListId: 111,
    });
    results.sl_modificat = "ok";
  } catch (e) { results.sl_modificat = String(e); }

  // ── 12. Ordre cancel·lada ─────────────────────────────────────────────────
  try {
    await notifyOrderCancel({
      symbol: "ETHUSDT", side: "SELL", type: "STOP_LOSS_LIMIT",
      origQty: 0.05, price: 3100, orderListId: 789012,
    });
    results.ordre_cancel = "ok";
  } catch (e) { results.ordre_cancel = String(e); }

  const allOk = Object.values(results).every(v => v === "ok");
  return NextResponse.json({ ok: allOk, results });
}
