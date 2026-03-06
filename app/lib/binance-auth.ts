import { createHmac } from "crypto";

const TESTNET = "https://demo-api.binance.com/api/v3";

/* ── Server-time sync ──────────────────────────────────────── */
let _timeOffset = 0;
let _lastSync   = 0;

async function getSyncedTimestamp(): Promise<number> {
  const now = Date.now();
  if (now - _lastSync > 5 * 60 * 1000) {          // re-sync every 5 min
    try {
      const r = await fetch(`${TESTNET}/time`, { cache: "no-store" });
      const d = await r.json() as { serverTime: number };
      _timeOffset = d.serverTime - Date.now();
      _lastSync   = Date.now();
    } catch { /* keep existing offset on failure */ }
  }
  return Date.now() + _timeOffset;
}

function sign(params: Record<string, string | number>): string {
  const query = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)])
  ).toString();
  const sig = createHmac("sha256", process.env.BINANCE_SECRET_KEY!)
    .update(query)
    .digest("hex");
  return `${query}&signature=${sig}`;
}

async function signedRequest<T>(
  method: "GET" | "DELETE" | "POST" | "PUT",
  path: string,
  params: Record<string, string | number> = {}
): Promise<T> {
  const timestamp = await getSyncedTimestamp();
  const query = sign({ ...params, timestamp, recvWindow: 5000 });
  const isBody = method === "POST" || method === "PUT";
  const url = isBody ? `${TESTNET}${path}` : `${TESTNET}${path}?${query}`;
  const res = await fetch(url, {
    method,
    headers: {
      "X-MBX-APIKEY": process.env.BINANCE_API_KEY!,
      ...(isBody ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    ...(isBody ? { body: query } : {}),
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Binance ${path} ${res.status}: ${err}`);
  }
  return res.json();
}

async function signedGet<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  return signedRequest<T>("GET", path, params);
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

export async function getMyTrades(symbol: string, limit = 20): Promise<BinanceTrade[]> {
  return signedGet<BinanceTrade[]>("/myTrades", { symbol, limit });
}

export async function getOpenOrders(): Promise<BinanceOrder[]> {
  return signedGet<BinanceOrder[]>("/openOrders");
}

export async function getOrderHistory(symbol: string, limit = 20): Promise<BinanceOrder[]> {
  return signedGet<BinanceOrder[]>("/allOrders", { symbol, limit });
}

export async function getAccount(): Promise<BinanceAccount> {
  return signedGet<BinanceAccount>("/account");
}

export async function cancelOrder(symbol: string, orderId: number): Promise<unknown> {
  return signedRequest("DELETE", "/order", { symbol, orderId });
}

export async function cancelOcoOrder(symbol: string, orderListId: number): Promise<unknown> {
  return signedRequest("DELETE", "/orderList", { symbol, orderListId });
}

export async function getOrder(symbol: string, orderId: number): Promise<{ status: string; price: string; stopPrice: string }> {
  return signedGet(`/order`, { symbol, orderId });
}

export async function getTickerPrice(symbol: string): Promise<number> {
  const res = await fetch(`${TESTNET}/ticker/price?symbol=${symbol}`, { cache: "no-store" });
  const d = await res.json() as { price: string };
  return parseFloat(d.price);
}

export async function placeStopLossLimitOrder(params: {
  symbol: string; side: "BUY" | "SELL"; quantity: string;
  stopPrice: string; limitPrice: string;
}): Promise<{ orderId: number; status: string }> {
  return signedRequest("POST", "/order", {
    symbol: params.symbol, side: params.side, type: "STOP_LOSS_LIMIT",
    quantity: params.quantity, stopPrice: params.stopPrice,
    price: params.limitPrice, timeInForce: "GTC",
  });
}

export async function placeLimitMakerOrder(params: {
  symbol: string; side: "BUY" | "SELL"; quantity: string; price: string;
}): Promise<{ orderId: number; status: string }> {
  return signedRequest("POST", "/order", {
    symbol: params.symbol, side: params.side, type: "LIMIT_MAKER",
    quantity: params.quantity, price: params.price,
  });
}

export async function modifyOrder(
  symbol: string, orderId: number, side: string,
  quantity: string, price: string, stopPrice?: string
): Promise<unknown> {
  const params: Record<string, string | number> = { symbol, orderId, side, quantity, price };
  if (stopPrice) params.stopPrice = stopPrice;
  return signedRequest("PUT", "/order", params);
}

export async function placeOcoOrder(params: {
  symbol: string; side: "BUY" | "SELL"; quantity: string;
  tpPrice: string; slStopPrice: string; slLimitPrice: string;
}): Promise<unknown> {
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
  return signedRequest("POST", "/orderList/oco", body);
}
