import { BinanceTicker, CoinRow, MarketSummary } from "./types";
import { cacheGet, cacheSet } from "./cache-store";
import { BINANCE_BASE } from "./constants";
export { formatCurrency } from "./format";

const BASE = BINANCE_BASE;

// Well-known USDT pairs to show (sorted by typical market cap)
const TOP_PAIRS = [
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT",
  "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "TRXUSDT", "DOTUSDT",
  "LINKUSDT", "MATICUSDT", "LTCUSDT", "SHIBUSDT", "UNIUSDT",
  "ATOMUSDT", "ETCUSDT", "XLMUSDT", "APTUSDT", "NEARUSDT",
];

async function fetchTickers(): Promise<BinanceTicker[]> {
  const KEY = "ticker:batch";
  const cached = cacheGet<BinanceTicker[]>(KEY);
  if (cached) return cached.data;

  const symbols = encodeURIComponent(JSON.stringify(TOP_PAIRS));
  const res = await fetch(`${BASE}/ticker/24hr?symbols=${symbols}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Binance tickers HTTP ${res.status}`);
  const data: BinanceTicker[] = await res.json();
  cacheSet(KEY, data, 30);
  return data;
}

async function fetchWindowedChanges(window: "1h" | "4h" | "3d" | "7d" | "4w"): Promise<Record<string, number>> {
  const KEY = `ticker:window:${window}`;
  const cached = cacheGet<Record<string, number>>(KEY);
  if (cached) return cached.data;

  const symbols = encodeURIComponent(JSON.stringify(TOP_PAIRS));
  const res = await fetch(`${BASE}/ticker?symbols=${symbols}&windowSize=${window}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return {};
  const data: { symbol: string; priceChangePercent: string }[] = await res.json();
  const map: Record<string, number> = {};
  for (const d of data) map[d.symbol] = parseFloat(d.priceChangePercent);
  cacheSet(KEY, map, 30);
  return map;
}

async function fetchKlineChange(pairs: string[], daysBack: number): Promise<Record<string, number>> {
  const KEY = `kline:change:${daysBack}d`;
  const cached = cacheGet<Record<string, number>>(KEY);
  if (cached) return cached.data;

  const startTime = Date.now() - daysBack * 86_400_000;
  const results = await Promise.all(pairs.map(async pair => {
    try {
      const res = await fetch(
        `${BASE}/klines?symbol=${pair}&interval=1d&limit=2&startTime=${startTime}`,
        { signal: AbortSignal.timeout(8_000) }
      );
      if (!res.ok) return [pair, 0] as [string, number];
      const klines: unknown[][] = await res.json();
      if (!klines.length) return [pair, 0] as [string, number];
      return [pair, parseFloat(klines[0][4] as string)] as [string, number];
    } catch { return [pair, 0] as [string, number]; }
  }));
  const map: Record<string, number> = Object.fromEntries(results);
  cacheSet(KEY, map, 3600);
  return map;
}

async function fetchSparkline(pair: string): Promise<number[]> {
  const KEY = `sparkline:${pair}`;
  const cached = cacheGet<number[]>(KEY);
  if (cached) return cached.data;

  const res = await fetch(`${BASE}/klines?symbol=${pair}&interval=1h&limit=24`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return [];
  const klines: unknown[][] = await res.json();
  const data = klines.map((k) => parseFloat(k[4] as string)); // close price
  cacheSet(KEY, data, 14400);
  return data;
}

export async function getMarketData(): Promise<{
  coins: CoinRow[];
  summary: MarketSummary;
}> {
  const [tickers, w4h, w7d, w4w, pastPrices6m, pastPrices1y] = await Promise.all([
    fetchTickers(),
    fetchWindowedChanges("4h"),
    fetchWindowedChanges("7d"),
    fetchWindowedChanges("4w"),
    fetchKlineChange(TOP_PAIRS, 180),
    fetchKlineChange(TOP_PAIRS, 365),
  ]);

  // Sort by our preferred order
  tickers.sort(
    (a, b) => TOP_PAIRS.indexOf(a.symbol) - TOP_PAIRS.indexOf(b.symbol)
  );

  // Fetch sparklines in parallel
  const sparklines = await Promise.all(
    tickers.map((t) => fetchSparkline(t.symbol))
  );

  const coins: CoinRow[] = tickers.map((t, i) => {
    const currentPrice = parseFloat(t.lastPrice);
    const pastPrice6m  = pastPrices6m[t.symbol] ?? 0;
    const change6m     = pastPrice6m > 0
      ? ((currentPrice - pastPrice6m) / pastPrice6m) * 100
      : 0;
    return {
      symbol: t.symbol.replace("USDT", ""),
      pair: t.symbol,
      price: currentPrice,
      change1h:  0,
      change4h:  w4h[t.symbol]  ?? 0,
      change24h: parseFloat(t.priceChangePercent),
      change72h: 0,
      change7d:  w7d[t.symbol]  ?? 0,
      change4w:  w4w[t.symbol]  ?? 0,
      change6m,
      change1y: pastPrices1y[t.symbol] > 0
        ? ((currentPrice - pastPrices1y[t.symbol]) / pastPrices1y[t.symbol]) * 100
        : 0,
      high24h: parseFloat(t.highPrice),
      low24h: parseFloat(t.lowPrice),
      volumeUSDT: parseFloat(t.quoteVolume),
      sparkline: sparklines[i],
    };
  });

  const allUsdtTickers = tickers;
  const totalVolumeUSDT = allUsdtTickers.reduce(
    (sum, t) => sum + parseFloat(t.quoteVolume),
    0
  );

  const sorted = [...coins].sort((a, b) => b.change24h - a.change24h);
  const topGainer = sorted[0];
  const topLoser = sorted[sorted.length - 1];
  const btcPrice = coins.find((c) => c.pair === "BTCUSDT")?.price ?? 0;

  return {
    coins,
    summary: {
      totalVolumeUSDT,
      topGainer: { symbol: topGainer.symbol, pct: topGainer.change24h },
      topLoser: { symbol: topLoser.symbol, pct: topLoser.change24h },
      btcPrice,
      activePairs: TOP_PAIRS.length,
    },
  };
}

export async function getCoinDetail(pair: string) {
  const [tickerRes, klinesRes] = await Promise.all([
    fetch(`${BASE}/ticker/24hr?symbol=${pair}`, { signal: AbortSignal.timeout(10_000) }),
    fetch(`${BASE}/klines?symbol=${pair}&interval=4h&limit=42`, { signal: AbortSignal.timeout(10_000) }),
  ]);
  if (!tickerRes.ok) throw new Error("Not found");
  const ticker: BinanceTicker = await tickerRes.json();
  const klines: unknown[][] = await klinesRes.json();
  const chart = klines.map((k) => ({
    time: k[0] as number,
    close: parseFloat(k[4] as string),
  }));
  return { ticker, chart };
}

