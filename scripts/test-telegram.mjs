/**
 * Envia missatges de prova de Telegram sense necessitat de sessió.
 * Crida l'API de Telegram directament (igual que fan els motors).
 * Ús: node scripts/test-telegram.mjs
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const root  = join(__dir, "..");

// Carrega .env.local manualment
const envPath = join(root, ".env.local");
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
}

const TOKEN  = process.env.TELEGRAM_BOT_TOKEN;
const CHAT   = process.env.TELEGRAM_CHAT_ID;
const ENV    = "DEV";

if (!TOKEN || !CHAT) {
  console.error("TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID no configurats");
  process.exit(1);
}

async function getIp() {
  try {
    const r = await fetch("https://api.ipify.org?format=json", { signal: AbortSignal.timeout(3000) });
    return (await r.json()).ip;
  } catch { return "desconeguda"; }
}

async function send(text) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  if (!r.ok) console.error("Error:", await r.text());
  else console.log("✓", text.slice(0, 60).replace(/\n/g, " "));
}

function ts() {
  return new Date().toLocaleString("ca-ES", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function kv(label, value, w = 14) {
  return label.padEnd(w) + value;
}

function fmtUSD(n) {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pairOf(symbol) {
  const q = ["USDC","USDT","BUSD","BTC","ETH","BNB"].find(q => symbol.endsWith(q)) ?? "USDT";
  return `${symbol.slice(0, -q.length)}/${q}`;
}

function pre(lines) {
  return `<pre>${lines.join("\n")}</pre>`;
}

function card(prefix, title, block, ip) {
  return `<b>[${prefix}]  ${title}</b>\n\n${pre(block)}\n<i>${ip} · ${ENV}</i>`;
}

// ─────────────────────────────────────────────────────────────────────────────

const ip = await getIp();
console.log(`IP: ${ip} | Telegram OK\n`);

// 1. Connexió bàsica
await send(card("📄 PAPER", "🧪 TEST DE CONNEXIÓ", [
  kv("Estat", "OK ✅"),
  kv("Hora",  ts()),
], ip));

// 2. Take Profit
await send(card("📄 PAPER", `✅ TAKE PROFIT  ·  SOL/USDC`, [
  kv("Símbol",    "SOL/USDC"),
  kv("Preu",      fmtUSD(152.40)),
  kv("Quantitat", "5.0000 SOL"),
  kv("Valor",     fmtUSD(762.00)),
  kv("OCO",       "#345678"),
  kv("Hora",      ts()),
], ip));

// 3. Stop Loss
await send(card("📄 PAPER", `🛑 STOP LOSS  ·  ETH/USDC`, [
  kv("Símbol",    "ETH/USDC"),
  kv("Preu",      fmtUSD(3180.00)),
  kv("Quantitat", "0.0500 ETH"),
  kv("Valor",     fmtUSD(159.00)),
  kv("OCO",       "#789012"),
  kv("Hora",      ts()),
], ip));

// 4. Compra + OCO
await send(card("📄 PAPER", `🛒 COMPRA + OCO  ·  BNB/USDC`, [
  kv("Símbol",      "BNB/USDC"),
  kv("Compra a",    fmtUSD(598.20)),
  kv("Invertit",    fmtUSD(200.00)),
  kv("Take Profit", fmtUSD(640.00)),
  kv("Stop Loss",   fmtUSD(572.00)),
  kv("OCO",         "#567890"),
  kv("Hora",        ts()),
], ip));

// 5. Trailing activat
await send(card("📄 PAPER", `🔔 TRAILING ACTIVAT  ·  SOL/USDC`, [
  kv("Símbol",      "SOL/USDC"),
  kv("Activació",   fmtUSD(152.40)),
  kv("SL inicial",  fmtUSD(145.80)),
  kv("Distància",   fmtUSD(6.60)),
  kv("OCO cancel.", "#345678"),
  kv("Hora",        ts()),
], ip));

// 6. Trailing executat
await send(card("📄 PAPER", `🔴 TRAILING STOP  ·  SOL/USDC`, [
  kv("Símbol",      "SOL/USDC"),
  kv("Stop activat", fmtUSD(148.50)),
  kv("Quantitat",   "5.0000 SOL"),
  kv("Valor est.",  fmtUSD(742.50)),
  kv("Hora",        ts()),
], ip));

// 7. Escaneig bot — skip
await send(`<b>[📄 PAPER]  🔍 ESCANEIG · Bot-Demo</b>\n\n${pre([
  kv("Omès", "fora de finestra horària (22:00–08:00)"),
  kv("Hora",  ts()),
])}\n<i>${ip} · ${ENV}</i>`);

// 8. Escaneig bot — resultats
const bar = s => "█".repeat(Math.round(s/10)) + "░".repeat(10-Math.round(s/10));
const rows = [
  ["SOLUSDC",  152.40, 78, "✅ COMPRA EXECUTADA"],
  ["BTCUSDC",  85420,  42, "⏸ sense senyal"],
  ["ETHUSDC",  3180,   55, "🔀 multi-TF no confirmat"],
].map(([sym, price, score, dec]) => {
  const base = sym.replace(/USDC$/,"").padEnd(5);
  return `${base} ${"$"+price.toFixed(2)}`.padEnd(20) + `  ${String(score).padStart(3)}/100  ${bar(score)}\n       → ${dec}`;
});
await send(`<b>[📄 PAPER]  🔍 ESCANEIG · Bot-Demo</b>\n${pre([
  `Interval: 1h  ·  Mínim: 60%  ·  ${ts()}`,
  "─".repeat(40),
  ...rows,
])}\n<i>${ip} · ${ENV}</i>`);

console.log("\nFet! Comprova Telegram.");
