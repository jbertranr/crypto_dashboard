/**
 * /api/convert
 *
 * GET  ?action=assets&mode=   → llista d'assets convertibles
 * POST { action: "quote", fromAsset, toAsset, fromAmount, mode }  → cotització
 * POST { action: "accept", quoteId, mode }                        → executa conversió
 * GET  ?action=history&mode=  → historial de conversions
 */

import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { apiError } from "../../lib/api-error";

const SAPI_MAINNET = "https://api.binance.com/sapi/v1";
const SAPI_TESTNET = "https://api.binance.com/sapi/v1"; // testnet no suporta /sapi/v1/convert

function getCredentials(mode: "paper" | "real") {
  if (mode === "real") {
    const apiKey    = process.env.BINANCE_API_KEY_REAL;
    const secretKey = process.env.BINANCE_SECRET_KEY_REAL;
    if (!apiKey || !secretKey) throw new Error("Claus real no configurades");
    return { apiKey, secretKey };
  }
  const apiKey    = process.env.BINANCE_API_KEY;
  const secretKey = process.env.BINANCE_SECRET_KEY;
  if (!apiKey || !secretKey) throw new Error("Claus paper no configurades");
  return { apiKey, secretKey };
}

function signQuery(params: Record<string, string | number>, secretKey: string): string {
  const query = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)])
  ).toString();
  const sig = createHmac("sha256", secretKey).update(query).digest("hex");
  return `${query}&signature=${sig}`;
}

async function sapiGet<T>(path: string, params: Record<string, string | number>, mode: "paper" | "real"): Promise<T> {
  const { apiKey, secretKey } = getCredentials(mode);
  const base = mode === "real" ? SAPI_MAINNET : SAPI_TESTNET;
  const query = signQuery({ ...params, timestamp: Date.now(), recvWindow: 30_000 }, secretKey);
  const res = await fetch(`${base}${path}?${query}`, {
    headers: { "X-MBX-APIKEY": apiKey },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Binance ${path} ${res.status}: ${body}`);
  }
  return res.json();
}

async function sapiPost<T>(path: string, params: Record<string, string | number>, mode: "paper" | "real"): Promise<T> {
  const { apiKey, secretKey } = getCredentials(mode);
  const base = mode === "real" ? SAPI_MAINNET : SAPI_TESTNET;
  const query = signQuery({ ...params, timestamp: Date.now(), recvWindow: 30_000 }, secretKey);
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "X-MBX-APIKEY": apiKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: query,
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Binance ${path} ${res.status}: ${body}`);
  }
  return res.json();
}

export async function GET(req: NextRequest) {
  try {
    const p      = req.nextUrl.searchParams;
    const action = p.get("action") ?? "assets";
    const mode   = p.get("mode") === "real" ? "real" : "paper";

    if (action === "assets") {
      const data = await sapiGet<{ fromAsset: string; toAsset: string[] }[]>(
        "/convert/exchangeInfo", {}, mode
      );
      // Extreure llista única d'assets
      const assets = [...new Set([
        ...data.map(d => d.fromAsset),
        ...data.flatMap(d => d.toAsset),
      ])].sort();
      return NextResponse.json({ assets, pairs: data });
    }

    if (action === "history") {
      const startTime = Date.now() - 30 * 24 * 3600 * 1000;
      const data = await sapiGet<{ list: unknown[] }>(
        "/convert/tradeFlow", { startTime, endTime: Date.now(), limit: 100 }, mode
      );
      return NextResponse.json(data);
    }

    return NextResponse.json({ error: "Acció desconeguda" }, { status: 400 });
  } catch (e) {
    return apiError(e, "convert/GET");
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      action: string;
      fromAsset?: string;
      toAsset?: string;
      fromAmount?: number;
      quoteId?: string;
      mode?: string;
    };
    const mode = body.mode === "real" ? "real" : "paper";

    if (body.action === "quote") {
      const { fromAsset, toAsset, fromAmount } = body;
      if (!fromAsset || !toAsset || !fromAmount) {
        return NextResponse.json({ error: "fromAsset, toAsset i fromAmount són requerits" }, { status: 400 });
      }
      const data = await sapiPost<{
        quoteId: string;
        ratio: string;
        inverseRatio: string;
        validTimestamp: number;
        toAmount: string;
        fromAmount: string;
        fromAsset: string;
        toAsset: string;
      }>("/convert/getQuote", { fromAsset, toAsset, fromAmount }, mode);
      return NextResponse.json(data);
    }

    if (body.action === "accept") {
      const { quoteId } = body;
      if (!quoteId) return NextResponse.json({ error: "quoteId requerit" }, { status: 400 });
      const data = await sapiPost<{
        orderId: string;
        orderStatus: string;
        fromAsset: string;
        fromAmount: string;
        toAsset: string;
        toAmount: string;
      }>("/convert/acceptQuote", { quoteId }, mode);
      return NextResponse.json(data);
    }

    return NextResponse.json({ error: "Acció desconeguda" }, { status: 400 });
  } catch (e) {
    return apiError(e, "convert/POST");
  }
}
