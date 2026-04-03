/**
 * sell-all.mjs
 * Cancel·la totes les ordres obertes i ven totes les posicions crypto a mercat.
 * Execució: node scripts/sell-all.mjs
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── Llegir .env.local ─────────────────────────────────────────────────────────
function loadEnv() {
  const env = {};
  try {
    const lines = readFileSync(join(ROOT, ".env.local"), "utf8").split("\n");
    for (const line of lines) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch { /* no .env.local */ }
  return env;
}

const env    = loadEnv();
const APIKEY = env.BINANCE_API_KEY    || "";
const SECRET = env.BINANCE_SECRET_KEY || "";
const BASE   = "https://demo-api.binance.com/api/v3";

const STABLES = new Set(["USDT","BUSD","USDC","DAI","TUSD","FDUSD","USDP"]);
const MIN_USD = 1;

// Arrodoneix qty al stepSize cap a baix
function roundDown(qty, stepSize) {
  const step = parseFloat(stepSize);
  if (step <= 0) return qty.toString();
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  const rounded = Math.floor(qty / step) * step;
  return rounded.toFixed(decimals);
}

if (!APIKEY || !SECRET) {
  console.error("❌ BINANCE_API_KEY / BINANCE_API_SECRET no definides a .env.local");
  process.exit(1);
}

// ── Binance signed request ────────────────────────────────────────────────────
function sign(params) {
  const qs = new URLSearchParams(params).toString();
  const sig = crypto.createHmac("sha256", SECRET).update(qs).digest("hex");
  return `${qs}&signature=${sig}`;
}

async function binance(method, path, params = {}) {
  params.timestamp = Date.now();
  const query = sign(params);
  const url = method === "GET" ? `${BASE}${path}?${query}` : `${BASE}${path}`;
  const res = await fetch(url, {
    method,
    headers: { "X-MBX-APIKEY": APIKEY, "Content-Type": "application/x-www-form-urlencoded" },
    ...(method !== "GET" ? { body: query } : {}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.msg || JSON.stringify(data));
  return data;
}

function ts() {
  return new Date().toLocaleTimeString("ca-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("🔄 Obtenint ordres obertes i saldo...\n");

  // 1. Cancel·lar totes les ordres obertes
  const openOrders = await binance("GET", "/openOrders", {});
  console.log(`📋 ${openOrders.length} ordres obertes trobades`);

  // Agrupar per orderListId per cancel·lar OCOs com a grup
  const cancelledLists = new Set();
  let cancelled = 0;

  for (const o of openOrders) {
    try {
      if (o.orderListId != null && o.orderListId > 0) {
        if (cancelledLists.has(o.orderListId)) continue;
        await binance("DELETE", "/orderList", { symbol: o.symbol, orderListId: o.orderListId });
        cancelledLists.add(o.orderListId);
        console.log(`[${ts()}] ❌ OCO #${o.orderListId} cancel·lada (${o.symbol})`);
      } else {
        await binance("DELETE", "/order", { symbol: o.symbol, orderId: o.orderId });
        console.log(`[${ts()}] ❌ Ordre #${o.orderId} cancel·lada (${o.symbol})`);
      }
      cancelled++;
    } catch (e) {
      console.log(`[${ts()}] ⚠️  Error cancel·lant ${o.symbol} #${o.orderId}: ${e.message}`);
    }
  }

  console.log(`\n✅ ${cancelled} ordres cancel·lades\n`);

  // Petit delay per deixar que Binance actualitzi els balances
  await new Promise(r => setTimeout(r, 1500));

  // 2. Obtenir exchange info (stepSize per symbol)
  const exInfoRes = await fetch(`${BASE}/exchangeInfo`);
  const exInfo    = await exInfoRes.json();
  const stepSizeMap = new Map();
  for (const s of exInfo.symbols ?? []) {
    const lot = s.filters?.find(f => f.filterType === "LOT_SIZE");
    if (lot) stepSizeMap.set(s.symbol, lot.stepSize);
  }

  // 3. Obtenir balances i vendre tot
  const account = await binance("GET", "/account", {});
  const balances = account.balances.filter(b => {
    if (STABLES.has(b.asset)) return false;
    const total = parseFloat(b.free) + parseFloat(b.locked);
    return total > 0;
  });

  console.log(`💰 ${balances.length} actius crypto trobats\n`);

  let sold = 0;
  let totalUsdt = 0;

  for (const b of balances) {
    const symbol   = `${b.asset}USDT`;
    const freeQty  = parseFloat(b.free);

    if (freeQty <= 0) {
      console.log(`[${ts()}] ⏭  ${b.asset}: tot bloquejat (${b.locked}) — saltant`);
      continue;
    }

    // Arrodonir al stepSize
    const stepSize = stepSizeMap.get(symbol) ?? "0.00001";
    const qty      = roundDown(freeQty, stepSize);

    if (parseFloat(qty) <= 0) {
      console.log(`[${ts()}] ⏭  ${b.asset}: qty 0 després d'arrodonir — saltant`);
      continue;
    }

    // Obtenir preu per verificar valor mínim
    let price = 0;
    try {
      const ticker = await fetch(`${BASE}/ticker/price?symbol=${symbol}`);
      const td = await ticker.json();
      price = parseFloat(td.price ?? 0);
    } catch { /* ignora */ }

    const valueUsd = parseFloat(qty) * price;
    if (valueUsd < MIN_USD) {
      console.log(`[${ts()}] ⏭  ${b.asset}: valor $${valueUsd.toFixed(2)} < $${MIN_USD} — saltant`);
      continue;
    }

    process.stdout.write(`[${ts()}] 💸 Venent ${qty} ${b.asset} (~$${valueUsd.toFixed(2)})… `);
    try {
      const res = await binance("POST", "/order", {
        symbol, side: "SELL", type: "MARKET", quantity: qty,
      });
      const received = parseFloat(res.cummulativeQuoteQty);
      totalUsdt += received;
      sold++;
      console.log(`✅ $${received.toFixed(2)} USDT rebuts`);
    } catch (e) {
      console.log(`❌ ${e.message}`);
    }
  }

  console.log(`\n🏁 Fet! ${sold} actius venuts · Total rebut: $${totalUsdt.toFixed(2)} USDT`);
}

main().catch(e => { console.error("❌ Error fatal:", e.message); process.exit(1); });
