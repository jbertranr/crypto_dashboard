/**
 * random-buyer.mjs
 * Fa compres aleatòries de crypto cada 10 minuts durant 3 hores.
 * Execució: node scripts/random-buyer.mjs
 * Parar: Ctrl+C
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT    = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE    = "http://localhost:3000";
const MAX_USD = 40;
const MIN_USD = 15;
const INTERVAL_MIN = 10;

// --until HH:MM  →  para a l'hora indicada
// sense argument →  3 hores des d'ara
const untilArg = process.argv.find(a => a.startsWith("--until="))?.split("=")[1]
              ?? process.argv[process.argv.indexOf("--until") + 1];
let END_TIME;
if (untilArg && /^\d{1,2}:\d{2}$/.test(untilArg)) {
  const [h, m] = untilArg.split(":").map(Number);
  END_TIME = new Date(); END_TIME.setHours(h, m, 0, 0);
  if (END_TIME <= Date.now()) END_TIME.setDate(END_TIME.getDate() + 1); // demà si ja ha passat
} else {
  END_TIME = new Date(Date.now() + 3 * 60 * 60 * 1000);
}

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

const env  = loadEnv();
const USER = env.DASHBOARD_USERNAME || "admin";
const PASS = env.DASHBOARD_PASSWORD || "";

// ── HTTP helper amb cookie de sessió ─────────────────────────────────────────
let sessionCookie = "";

async function apiPost(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", ...(sessionCookie ? { cookie: sessionCookie } : {}) },
    body:    JSON.stringify(body),
  });
  // Captura cookie de login
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) sessionCookie = setCookie.split(";")[0];
  return res.json();
}

async function apiGet(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: sessionCookie ? { cookie: sessionCookie } : {},
  });
  return res.json();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function ts() {
  return new Date().toLocaleTimeString("ca-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function randBetween(min, max) {
  return min + Math.random() * (max - min);
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  // 1. Login
  if (!PASS) { console.error("❌ DASHBOARD_PASSWORD no definida a .env.local"); process.exit(1); }
  const loginRes = await apiPost("/api/auth/login", { username: USER, password: PASS });
  if (loginRes.error) { console.error("❌ Login fallat:", loginRes.error); process.exit(1); }
  console.log(`✅ Sessió iniciada com a "${USER}"`);

  const intervalMs = INTERVAL_MIN * 60 * 1000;
  const endTime    = END_TIME.getTime();
  const totalBuys  = Math.max(1, Math.floor((endTime - Date.now()) / intervalMs));

  console.log(`\n🎲 Compres aleatòries: ${INTERVAL_MIN} min interval · fins les ${END_TIME.toLocaleTimeString("ca-ES", { hour: "2-digit", minute: "2-digit" })} · màx $${MAX_USD}/compra`);
  console.log(`   ${totalBuys} compres previstes fins les ${new Date(endTime).toLocaleTimeString("ca-ES")}\n`);

  let count = 0;
  let lastSymbol = null;
  let shuffledCoins = [];

  while (Date.now() < endTime) {
    count++;
    const minsLeft = Math.round((endTime - Date.now()) / 60000);

    // Comprovar saldo USDT
    let usdtBalance = 0;
    try {
      const bal = await apiGet("/api/balance");
      const usdt = Array.isArray(bal) ? bal.find(b => b.asset === "USDT") : null;
      usdtBalance = usdt ? parseFloat(usdt.free) : 0;
    } catch {
      console.log(`[${ts()}] ⚠️  No s'ha pogut llegir el saldo`);
    }

    if (usdtBalance < MIN_USD) {
      console.log(`[${ts()}] ⛔ Saldo USDT insuficient: ${usdtBalance.toFixed(2)} < $${MIN_USD}. Parant.`);
      break;
    }

    // Triar coin aleatòria (sense repetir l'anterior; rota per totes abans de repetir)
    let symbol = null;
    try {
      const market = await apiGet("/api/market");
      const EXCLUDED = ["MATICUSDT"]; // mercats tancats
      const allCoins = Array.isArray(market) ? market.filter(c => c.pair?.endsWith("USDT") && c.price > 0 && !EXCLUDED.includes(c.pair)) : [];
      if (!allCoins.length) throw new Error("Llista de coins buida");
      // Reomplir la cua barrejada quan s'acaba
      if (!shuffledCoins.length) {
        shuffledCoins = [...allCoins].sort(() => Math.random() - 0.5).map(c => c.pair);
      }
      // Treure la primera que no sigui la mateixa que l'última
      const idx = lastSymbol ? shuffledCoins.findIndex(p => p !== lastSymbol) : 0;
      symbol = shuffledCoins.splice(idx === -1 ? 0 : idx, 1)[0];
      lastSymbol = symbol;
    } catch (e) {
      console.log(`[${ts()}] ⚠️  No s'han pogut llegir les coins: ${e.message}`);
      await sleep(intervalMs);
      continue;
    }

    // Import aleatori entre MIN i min(MAX, saldo disponible)
    const maxBuy = Math.min(MAX_USD, usdtBalance);
    const amount = randBetween(MIN_USD, maxBuy);

    // TP entre 2% i 6%, SL entre 1.5% i 4% (aleatoris)
    const tpPct = randBetween(2, 6);
    const slPct = randBetween(1.5, 4);

    // Trailing: activa entre 1.5% i 3% de guany, distància 1% i 2%
    const trailActPct  = randBetween(1.5, 3);
    const trailDistPct = randBetween(1, 2);

    // Obtenir preu actual de referència
    let refPrice = 0;
    try {
      const market = await apiGet("/api/market");
      const coin   = Array.isArray(market) ? market.find(c => c.pair === symbol) : null;
      refPrice = coin?.price ?? 0;
    } catch { /* ignora */ }

    const tpPrice    = refPrice * (1 + tpPct / 100);
    const slPrice    = refPrice * (1 - slPct / 100);
    const activateAt = refPrice * (1 + trailActPct / 100);
    const distance   = refPrice * (trailDistPct / 100);

    const trailing = {
      activateAt,
      distance,
      activateAtr: 0,
      distanceAtr: 0,
      logic: "PCT",
    };

    process.stdout.write(`[${ts()}] #${count}/${totalBuys} — ${symbol} $${amount.toFixed(2)} TP+${tpPct.toFixed(1)}% SL-${slPct.toFixed(1)}% Trail act+${trailActPct.toFixed(1)}% dist${trailDistPct.toFixed(1)}% (saldo: $${usdtBalance.toFixed(2)}, ${minsLeft} min restants) … `);

    try {
      const res = await apiPost("/api/orders/buy-and-exit", {
        symbol,
        quoteOrderQty: amount.toFixed(2),
        tpPrice,
        slPrice,
        trailing,
      });
      if (res.error) {
        console.log(`❌ ${res.error}`);
      } else {
        const qty   = parseFloat(res.quantity ?? 0).toPrecision(5);
        const price = parseFloat(res.fillPrice ?? 0).toFixed(2);
        console.log(`✅ OCO+Trail — ${qty} ${symbol.replace("USDT", "")} @ $${price} | TP $${parseFloat(res.tpPrice).toFixed(2)} SL $${parseFloat(res.slStopPrice).toFixed(2)} | Trail act $${activateAt.toFixed(2)}`);
      }
    } catch (e) {
      console.log(`❌ ${e.message}`);
    }

    // Esperar fins la propera compra
    const nextBuyIn = Math.min(intervalMs, endTime - Date.now());
    if (nextBuyIn > 5000) {
      const nextTime = new Date(Date.now() + nextBuyIn).toLocaleTimeString("ca-ES");
      console.log(`   ⏱  Propera compra a les ${nextTime}`);
      await sleep(nextBuyIn);
    }
  }

  console.log(`\n🏁 Sessió acabada: ${count} compres realitzades`);
}

main().catch(e => { console.error("❌ Error fatal:", e.message); process.exit(1); });
