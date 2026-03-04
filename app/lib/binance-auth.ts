import { createHmac } from "crypto";

const TESTNET = "https://demo-api.binance.com/api/v3";

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
  const query = sign({ ...params, timestamp: Date.now() });
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
