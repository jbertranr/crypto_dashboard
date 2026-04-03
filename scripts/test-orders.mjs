/**
 * test-orders.mjs
 * Compara les ordres de Binance directament vs les que retorna la nostra API.
 * Execució: node scripts/test-orders.mjs
 */

import { createHmac } from "crypto";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── Llegir .env.local ────────────────────────────────────────────────────────
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

const env = loadEnv();
const API_KEY    = env.BINANCE_API_KEY    || process.env.BINANCE_API_KEY;
const SECRET_KEY = env.BINANCE_SECRET_KEY || process.env.BINANCE_SECRET_KEY;
const TESTNET    = "https://demo-api.binance.com/api/v3";
const LOCAL_API  = "http://localhost:3000";

if (!API_KEY || !SECRET_KEY) {
  console.error("❌ Falten BINANCE_API_KEY / BINANCE_SECRET_KEY a .env.local");
  process.exit(1);
}

// ── Signatura Binance ─────────────────────────────────────────────────────────
function sign(params) {
  const query = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)])
  ).toString();
  const sig = createHmac("sha256", SECRET_KEY).update(query).digest("hex");
  return `${query}&signature=${sig}`;
}

async function binanceOpenOrders() {
  // Sync server time
  const timeRes  = await fetch(`${TESTNET}/time`);
  const { serverTime } = await timeRes.json();
  const offset   = serverTime - Date.now();
  const timestamp = Date.now() + offset;

  const query = sign({ timestamp, recvWindow: 30000 });
  const res   = await fetch(`${TESTNET}/openOrders?${query}`, {
    headers: { "X-MBX-APIKEY": API_KEY },
  });
  if (!res.ok) throw new Error(`Binance error ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Cridar API local (login + orders) ────────────────────────────────────────
async function getSessionCookie() {
  const username = env.DASHBOARD_USERNAME || "admin";
  const password = env.DASHBOARD_PASSWORD;
  if (!password) return null;

  const res = await fetch(`${LOCAL_API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) return null;
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) return null;
  // Extreu només nom=valor (sense atributs)
  return setCookie.split(";")[0].trim();
}

async function localOrders(sessionCookie) {
  const res = await fetch(`${LOCAL_API}/api/orders`, {
    headers: sessionCookie ? { Cookie: sessionCookie } : {},
  });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`API local error ${res.status}`);
  return res.json();
}

// ── Comparació ───────────────────────────────────────────────────────────────
function compareOrders(binance, local) {
  const binanceIds = new Map(binance.map(o => [o.orderId, o]));
  const localIds   = new Map(local.map(o => [o.orderId, o]));

  const onlyBinance = binance.filter(o => !localIds.has(o.orderId));
  const onlyLocal   = local.filter(o => !binanceIds.has(o.orderId));
  const inBoth      = binance.filter(o => localIds.has(o.orderId));

  console.log("\n" + "═".repeat(60));
  console.log(`  BINANCE: ${binance.length} ordres    LOCAL API: ${local.length} ordres`);
  console.log("═".repeat(60));

  if (onlyBinance.length) {
    console.log(`\n⚠️  Només a Binance (${onlyBinance.length}):`);
    for (const o of onlyBinance) {
      console.log(`   orderId=${o.orderId}  ${o.symbol}  ${o.side} ${o.type}  qty=${o.origQty}  price=${o.price}`);
    }
  }

  if (onlyLocal.length) {
    console.log(`\n⚠️  Només a la nostra API (${onlyLocal.length}):`);
    for (const o of onlyLocal) {
      console.log(`   orderId=${o.orderId}  ${o.symbol}  ${o.side} ${o.type}  tradeCode=${o.tradeCode ?? "—"}`);
    }
  }

  if (!onlyBinance.length && !onlyLocal.length) {
    console.log("\n✅ Totes les ordres coincideixen!");
  }

  console.log(`\n📋 Ordres coincidents (${inBoth.length}):`);
  for (const b of inBoth) {
    const l = localIds.get(b.orderId);
    const fields = [
      `orderId=${b.orderId}`,
      `listId=${b.orderListId}`,
      `${b.symbol}`,
      `${b.side} ${b.type}`,
      `qty=${b.origQty}`,
      `price=${b.price}`,
      `status=${b.status}`,
    ];
    const extra = [];
    if (l.tradeCode)    extra.push(`tradeCode=${l.tradeCode}`);
    if (l.botName)      extra.push(`bot=${l.botName}`);
    if (l.isTrailingSl) extra.push(`trailing✓`);
    console.log(`   ${fields.join("  ")}${extra.length ? "  [" + extra.join(", ") + "]" : ""}`);

    // Detectar divergències de camps clau
    const checks = [
      ["symbol",    b.symbol,    l.symbol],
      ["side",      b.side,      l.side],
      ["status",    b.status,    l.status],
      ["origQty",   b.origQty,   l.origQty],
      ["price",     b.price,     l.price],
    ];
    for (const [field, bv, lv] of checks) {
      if (String(bv) !== String(lv)) {
        console.log(`     ⚠️  ${field}: Binance=${bv}  local=${lv}`);
      }
    }
  }

  console.log("\n" + "═".repeat(60) + "\n");
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("🔍 Obtenint ordres de Binance...");
  const binance = await binanceOpenOrders();

  console.log(`✅ Binance: ${binance.length} ordres obertes`);
  console.log("🔍 Obtenint ordres de la API local...");

  const cookie = await getSessionCookie();
  let local = await localOrders(cookie);

  if (!local) {
    console.log("⚠️  La API local requereix sessió. Mostrant només dades de Binance:\n");
    console.log("📋 Ordres Binance:");
    for (const o of binance) {
      console.log(`   orderId=${o.orderId}  listId=${o.orderListId}  ${o.symbol}  ${o.side} ${o.type}  qty=${o.origQty}  price=${o.price}  status=${o.status}`);
    }
    console.log(`\nTotal: ${binance.length} ordres`);
    return;
  }

  compareOrders(binance, local);
}

main().catch(err => {
  console.error("❌", err.message);
  process.exit(1);
});
