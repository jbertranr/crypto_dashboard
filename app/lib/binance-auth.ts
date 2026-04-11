import { createHmac, sign as cryptoSign, createPrivateKey } from "crypto";
import { log } from "./logger";

export type TradingMode = "paper" | "real";

const TESTNET = "https://demo-api.binance.com/api/v3";
const MAINNET = "https://api.binance.com/api/v3";

function getBaseUrl(mode: TradingMode = "paper"): string {
  return mode === "real" ? MAINNET : TESTNET;
}

type KeyType = "hmac" | "ed25519" | "rsa";

interface Credentials {
  apiKey:   string;
  secretKey: string;
  keyType:  KeyType;
}

function getCredentials(mode: TradingMode = "paper"): Credentials {
  if (mode === "real") {
    const apiKey    = process.env.BINANCE_API_KEY_REAL;
    const secretKey = process.env.BINANCE_SECRET_KEY_REAL;
    if (!apiKey || !secretKey) {
      throw new Error("BINANCE_API_KEY_REAL i BINANCE_SECRET_KEY_REAL no estan configurats a .env.local");
    }
    const keyType = (process.env.BINANCE_KEY_TYPE_REAL ?? "hmac").toLowerCase() as KeyType;
    return { apiKey, secretKey, keyType };
  }
  const apiKey    = process.env.BINANCE_API_KEY;
  const secretKey = process.env.BINANCE_SECRET_KEY;
  if (!apiKey || !secretKey) {
    throw new Error("BINANCE_API_KEY i BINANCE_SECRET_KEY són requerits. Afegeix-los a .env.local");
  }
  const keyType = (process.env.BINANCE_KEY_TYPE ?? "hmac").toLowerCase() as KeyType;
  return { apiKey, secretKey, keyType };
}

/* ── Server-time sync ──────────────────────────────────────── */
let _timeOffset = 0;
let _lastSync   = 0;

async function getSyncedTimestamp(mode: TradingMode = "paper"): Promise<number> {
  const now = Date.now();
  if (now - _lastSync > 2 * 60 * 1000) {          // re-sync every 2 min
    try {
      const r = await fetch(`${getBaseUrl(mode)}/time`, { cache: "no-store" });
      const d = await r.json() as { serverTime: number };
      // Compute offset as server time minus our local time at the moment the
      // response is processed. This intentionally under-corrects by ~½ RTT,
      // but keeps us safely behind the server (never ahead) which is what
      // Binance wants. recvWindow of 30s absorbs any remaining drift.
      _timeOffset = d.serverTime - Date.now();
      _lastSync   = Date.now();
    } catch { /* keep existing offset on failure */ }
  }
  return Date.now() + _timeOffset;
}

function sign(params: Record<string, string | number>, mode: TradingMode = "paper"): string {
  const { secretKey, keyType } = getCredentials(mode);
  const query = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)])
  ).toString();

  let sig: string;
  if (keyType === "ed25519" || keyType === "rsa") {
    // secretKey conté el PEM de la clau privada.
    // Les variables d'entorn guarden \n literals — els convertim a salts de línia reals.
    const pem        = secretKey.replace(/\\n/g, "\n");
    const privateKey = createPrivateKey(pem);
    const sigBuf     = cryptoSign(null, Buffer.from(query), privateKey);
    sig = encodeURIComponent(sigBuf.toString("base64"));
  } else {
    // HMAC-SHA256 (per defecte)
    sig = createHmac("sha256", secretKey).update(query).digest("hex");
  }

  return `${query}&signature=${sig}`;
}

const MAX_RETRIES = 3; // total attempts for safe (read-only) methods

async function signedRequest<T>(
  method: "GET" | "DELETE" | "POST" | "PUT",
  path: string,
  params: Record<string, string | number> = {},
  mode: TradingMode = "paper",
  _clockRetried = false,
  _attempt = 0,
): Promise<T> {
  const BASE      = getBaseUrl(mode);
  const timestamp = await getSyncedTimestamp(mode);
  const query     = sign({ ...params, timestamp, recvWindow: 30_000 }, mode);
  const isBody    = method === "POST" || method === "PUT";
  const url       = isBody ? `${BASE}${path}` : `${BASE}${path}?${query}`;

  const { apiKey } = getCredentials(mode);
  const res = await fetch(url, {
    method,
    headers: {
      "X-MBX-APIKEY": apiKey,
      ...(isBody ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    ...(isBody ? { body: query } : {}),
    cache: "no-store",
  });

  if (!res.ok) {
    const ct   = res.headers.get("content-type") ?? "";
    const body = await res.text();
    const isHtml = ct.includes("text/html") || body.trimStart().startsWith("<");
    const errMsg = isHtml ? `HTTP ${res.status} (error transitiu del servidor)` : body;

    // -1021: clock drift — re-sync and retry once regardless of method
    if (!_clockRetried && errMsg.includes("-1021")) {
      _lastSync = 0;
      log.orders.warn({ path, attempt: _attempt }, "clock drift (-1021): resyncing i reintentant");
      return signedRequest<T>(method, path, params, mode, true, _attempt);
    }

    // 5xx: transient Binance / gateway error
    if (res.status >= 500) {
      log.orders.warn({ path, method, status: res.status, attempt: _attempt, errMsg }, "Binance 5xx");

      // POST/DELETE are not idempotent — do NOT retry automatically to avoid double-execution
      if (method === "POST" || method === "DELETE") {
        throw new Error(`Binance ${path} ${res.status}: ${errMsg} (no es reintenta — verifica l'estat manualment)`);
      }

      // GET/PUT: retry with exponential back-off (1 s → 2 s → 4 s)
      if (_attempt < MAX_RETRIES - 1) {
        const delay = Math.pow(2, _attempt) * 1000;
        log.orders.info({ path, delay, nextAttempt: _attempt + 1 }, "reintentant GET...");
        await new Promise(r => setTimeout(r, delay));
        return signedRequest<T>(method, path, params, mode, _clockRetried, _attempt + 1);
      }
    }

    // 429 / 418: rate limit
    if (res.status === 429 || res.status === 418) {
      log.orders.error({ path, status: res.status }, "rate limit Binance");
    }

    throw new Error(`Binance ${path} ${res.status}: ${errMsg}`);
  }

  return res.json();
}

async function signedGet<T>(path: string, params: Record<string, string | number> = {}, mode: TradingMode = "paper"): Promise<T> {
  return signedRequest<T>("GET", path, params, mode);
}

export interface BinanceOrder {
  symbol: string;
  orderId: number;
  orderListId: number;
  side: "BUY" | "SELL";
  type: string;
  price: string;
  stopPrice: string;
  origQty: string;
  executedQty: string;
  status: string;
  timeInForce: string;
  time: number;
  updateTime: number;
}

export interface BinanceBalance {
  asset: string;
  free: string;
  locked: string;
}

export interface BinanceAccount {
  balances: BinanceBalance[];
}

export interface BinanceTrade {
  id: number;
  orderId: number;
  orderListId: number;
  symbol: string;
  price: string;
  qty: string;
  quoteQty: string;
  commission: string;
  commissionAsset: string;
  time: number;
  isBuyer: boolean;
  isMaker: boolean;
}

export async function getMyTrades(symbol: string, limit = 20, mode: TradingMode = "paper"): Promise<BinanceTrade[]> {
  return signedGet<BinanceTrade[]>("/myTrades", { symbol, limit }, mode);
}

export async function getOpenOrders(mode: TradingMode = "paper"): Promise<BinanceOrder[]> {
  return signedGet<BinanceOrder[]>("/openOrders", {}, mode);
}

export async function getOrderHistory(symbol: string, limit = 20, mode: TradingMode = "paper"): Promise<BinanceOrder[]> {
  return signedGet<BinanceOrder[]>("/allOrders", { symbol, limit }, mode);
}

export async function getAccount(mode: TradingMode = "paper"): Promise<BinanceAccount> {
  return signedGet<BinanceAccount>("/account", {}, mode);
}

export async function cancelOrder(symbol: string, orderId: number, mode: TradingMode = "paper"): Promise<unknown> {
  return signedRequest("DELETE", "/order", { symbol, orderId }, mode);
}

export async function cancelOcoOrder(symbol: string, orderListId: number, mode: TradingMode = "paper"): Promise<unknown> {
  return signedRequest("DELETE", "/orderList", { symbol, orderListId }, mode);
}

export async function getOrder(symbol: string, orderId: number, mode: TradingMode = "paper"): Promise<{
  status: string; price: string; stopPrice: string;
  executedQty: string; cummulativeQuoteQty: string; type: string;
}> {
  return signedGet(`/order`, { symbol, orderId }, mode);
}

export async function getTickerPrice(symbol: string, mode: TradingMode = "paper"): Promise<number> {
  const base = getBaseUrl(mode);
  const res = await fetch(`${base}/ticker/price?symbol=${symbol}`, { cache: "no-store" });
  const d = await res.json() as { price: string };
  return parseFloat(d.price);
}

export async function placeMarketSell(
  symbol: string, quantity: string, mode: TradingMode = "paper"
): Promise<{ orderId: number; executedQty: string; cummulativeQuoteQty: string }> {
  return signedRequest("POST", "/order", {
    symbol, side: "SELL", type: "MARKET", quantity,
  }, mode);
}

export async function placeStopLossLimitOrder(params: {
  symbol: string; side: "BUY" | "SELL"; quantity: string;
  stopPrice: string; limitPrice: string;
}, mode: TradingMode = "paper"): Promise<{ orderId: number; status: string }> {
  return signedRequest("POST", "/order", {
    symbol: params.symbol, side: params.side, type: "STOP_LOSS_LIMIT",
    quantity: params.quantity, stopPrice: params.stopPrice,
    price: params.limitPrice, timeInForce: "GTC",
  }, mode);
}

export async function placeLimitMakerOrder(params: {
  symbol: string; side: "BUY" | "SELL"; quantity: string; price: string;
}, mode: TradingMode = "paper"): Promise<{ orderId: number; status: string }> {
  return signedRequest("POST", "/order", {
    symbol: params.symbol, side: params.side, type: "LIMIT_MAKER",
    quantity: params.quantity, price: params.price,
  }, mode);
}

export async function modifyOrder(
  symbol: string, orderId: number, side: string,
  quantity: string, price: string, stopPrice?: string,
  mode: TradingMode = "paper"
): Promise<unknown> {
  const params: Record<string, string | number> = { symbol, orderId, side, quantity, price };
  if (stopPrice) params.stopPrice = stopPrice;
  return signedRequest("PUT", "/order", params, mode);
}

/**
 * Compute decimal places from a tickSize/stepSize string, handling both
 * decimal notation ("0.00100000") and scientific notation ("1E-3", "1e-8").
 */
function tickDp(tickSize: string): number {
  const n = parseFloat(tickSize);
  if (!Number.isFinite(n) || n <= 0) return 2;           // safe fallback
  const s = tickSize.trim().toUpperCase();
  if (s.includes('.') && !s.includes('E'))
    return s.length - s.indexOf('.') - 1;                // e.g. "0.01" → 2
  if (n >= 1) return 0;                                   // e.g. "1", "10"
  return Math.max(0, Math.round(-Math.log10(n)));         // e.g. "1E-8" → 8
}

/**
 * Safe integer-domain price rounding.
 * Works in the integer space of (price * 10^dp) to avoid IEEE-754 drift from
 * the naive (Math.xxx(price / s) * s) pattern, which can produce NaN/Infinity
 * strings if tickSize arrives in scientific notation or as a near-zero float.
 * The regex guard at the end is a final safety net before the string reaches Binance.
 */
function roundPriceImpl(
  price: number, tickSize: string,
  mode: "round" | "ceil" | "floor",
): string {
  tickSize = tickSize ?? "0.01";
  const s  = parseFloat(tickSize);
  const dp = tickDp(tickSize);
  if (!Number.isFinite(price) || price < 0 || !Number.isFinite(s) || s <= 0)
    throw new Error(`roundPrice(${mode}): valors invàlids price=${price} tickSize=${tickSize}`);
  const factor = Math.pow(10, dp);
  const sf     = Math.round(s * factor);          // tickSize in integer units
  const units  = price * factor;                  // price in integer units (may have float noise)
  let ticks: number;
  if      (mode === "ceil")  ticks = Math.ceil(units  / sf);
  else if (mode === "floor") ticks = Math.floor(units / sf);
  else                       ticks = Math.round(units / sf);
  const result = (ticks * sf / factor).toFixed(dp);
  if (!/^\d+(\.\d+)?$/.test(result))
    throw new Error(`roundPrice(${mode}): resultat invàlid "${result}" price=${price} tickSize=${tickSize}`);
  return result;
}

/**
 * Round a quantity DOWN to the nearest stepSize increment.
 * Always floors (never rounds up) to avoid placing an order for more than available.
 */
export function roundQty(qty: number, stepSize: string): string {
  stepSize = stepSize ?? "0.00001";
  const s  = parseFloat(stepSize);
  const dp = tickDp(stepSize);
  if (!Number.isFinite(qty) || qty < 0 || !Number.isFinite(s) || s <= 0)
    throw new Error(`roundQty: valors invàlids qty=${qty} stepSize=${stepSize}`);
  const factor = Math.pow(10, dp);
  const sf     = Math.round(s * factor);
  const units  = qty * factor;
  const result = (Math.floor(units / sf) * sf / factor).toFixed(dp);
  if (!/^\d+(\.\d+)?$/.test(result))
    throw new Error(`roundQty: resultat invàlid "${result}" qty=${qty} stepSize=${stepSize}`);
  return result;
}

export function roundPrice(price: number, tickSize: string): string {
  return roundPriceImpl(price, tickSize, "round");
}

/** Round UP to the nearest tick — use for TP (must be strictly above market price) */
export function roundPriceUp(price: number, tickSize: string): string {
  return roundPriceImpl(price, tickSize, "ceil");
}

/** Round DOWN to the nearest tick — use for SL (must be strictly below market price) */
export function roundPriceDown(price: number, tickSize: string): string {
  return roundPriceImpl(price, tickSize, "floor");
}

/** Fetch raw OHLCV candles from Binance public API (no auth required). */
export async function getKlines(
  symbol: string, interval: string, limit = 60
): Promise<Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>> {
  const res = await fetch(
    `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
  );
  if (!res.ok) throw new Error(`getKlines ${symbol}/${interval} HTTP ${res.status}`);
  const raw = await res.json() as unknown[][];
  return raw.map(k => ({
    time:   k[0] as number,
    open:   parseFloat(k[1] as string),
    high:   parseFloat(k[2] as string),
    low:    parseFloat(k[3] as string),
    close:  parseFloat(k[4] as string),
    volume: parseFloat(k[5] as string),
  }));
}

export interface MarketBuyResult {
  orderId: number;
  executedQty: string;
  cummulativeQuoteQty: string;
  status: string;
  fills: Array<{ price: string; qty: string; commission: string; commissionAsset?: string }>;
}

export async function placeMarketBuy(
  symbol: string,
  quoteOrderQty: string,
  mode: TradingMode = "paper"
): Promise<MarketBuyResult> {
  return signedRequest("POST", "/order", {
    symbol, side: "BUY", type: "MARKET", quoteOrderQty,
  }, mode);
}

export async function placeOcoOrder(params: {
  symbol: string; side: "BUY" | "SELL"; quantity: string;
  tpPrice: string; slStopPrice: string; slLimitPrice: string;
}, mode: TradingMode = "paper"): Promise<unknown> {
  const { symbol, side, quantity, tpPrice, slStopPrice, slLimitPrice } = params;
  // New Binance OCO format uses aboveType/belowType.
  // For SELL OCO: TP (LIMIT_MAKER) is the above order, SL (STOP_LOSS_LIMIT) is the below order.
  // For BUY  OCO: SL (STOP_LOSS_LIMIT) is the above order, TP (LIMIT_MAKER) is the below order.
  const body: Record<string, string | number> =
    side === "SELL"
      ? {
          symbol, side, quantity,
          aboveType: "LIMIT_MAKER",    abovePrice: tpPrice,
          belowType: "STOP_LOSS_LIMIT", belowStopPrice: slStopPrice,
          belowPrice: slLimitPrice,     belowTimeInForce: "GTC",
        }
      : {
          symbol, side, quantity,
          aboveType: "STOP_LOSS_LIMIT", aboveStopPrice: slStopPrice,
          abovePrice: slLimitPrice,     aboveTimeInForce: "GTC",
          belowType: "LIMIT_MAKER",    belowPrice: tpPrice,
        };
  return signedRequest("POST", "/orderList/oco", body, mode);
}
