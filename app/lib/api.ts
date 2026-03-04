import { BinanceTicker, CoinRow, MarketSummary } from "./types";

const BASE = "https://api.binance.com/api/v3";

// Well-known USDT pairs to show (sorted by typical market cap)
const TOP_PAIRS = [
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT",
  "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "TRXUSDT", "DOTUSDT",
  "LINKUSDT", "MATICUSDT", "LTCUSDT", "SHIBUSDT", "UNIUSDT",
  "ATOMUSDT", "ETCUSDT", "XLMUSDT", "APTUSDT", "NEARUSDT",
];

async function fetchTickers(): Promise<BinanceTicker[]> {
  const symbols = encodeURIComponent(JSON.stringify(TOP_PAIRS));
  const res = await fetch(`${BASE}/ticker/24hr?symbols=${symbols}`, {
    next: { revalidate: 30 },
  });
  if (!res.ok) throw new Error("Failed to fetch Binance tickers");
  return res.json();
}

async function fetchSparkline(pair: string): Promise<number[]> {
  const res = await fetch(
    `${BASE}/klines?symbol=${pair}&interval=1h&limit=24`,
    { next: { revalidate: 14400 } }
  );
  if (!res.ok) return [];
  const klines: unknown[][] = await res.json();
  return klines.map((k) => parseFloat(k[4] as string)); // close price
}

export async function getMarketData(): Promise<{
  coins: CoinRow[];
  summary: MarketSummary;
}> {
  const tickers = await fetchTickers();

  // Sort by our preferred order
  tickers.sort(
    (a, b) => TOP_PAIRS.indexOf(a.symbol) - TOP_PAIRS.indexOf(b.symbol)
  );

  // Fetch sparklines in parallel
  const sparklines = await Promise.all(
    tickers.map((t) => fetchSparkline(t.symbol))
  );

  const coins: CoinRow[] = tickers.map((t, i) => ({
    symbol: t.symbol.replace("USDT", ""),
    pair: t.symbol,
    price: parseFloat(t.lastPrice),
    change24h: parseFloat(t.priceChangePercent),
    high24h: parseFloat(t.highPrice),
    low24h: parseFloat(t.lowPrice),
    volumeUSDT: parseFloat(t.quoteVolume),
    sparkline: sparklines[i],
  }));

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
    fetch(`${BASE}/ticker/24hr?symbol=${pair}`, { next: { revalidate: 30 } }),
    fetch(`${BASE}/klines?symbol=${pair}&interval=4h&limit=42`, {
      next: { revalidate: 3600 },
    }),
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

export function formatCurrency(n: number, decimals?: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals ?? 2,
    maximumFractionDigits: decimals ?? (n < 1 ? 6 : 2),
  }).format(n);
}
