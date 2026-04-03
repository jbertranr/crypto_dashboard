export interface BinanceTicker {
  symbol: string;
  priceChangePercent: string;
  lastPrice: string;
  highPrice: string;
  lowPrice: string;
  quoteVolume: string; // volume in USDT
  volume: string;      // volume in base asset
}

export interface CoinRow {
  symbol: string;       // e.g. "BTC"
  pair: string;         // e.g. "BTCUSDT"
  price: number;
  change1h:  number;
  change4h:  number;
  change24h: number;
  change72h: number;
  change7d:  number;
  change4w:  number;
  change6m:  number;
  change1y:  number;
  high24h: number;
  low24h: number;
  volumeUSDT: number;
  sparkline: number[];  // 7d daily close prices
}

export interface MarketSummary {
  totalVolumeUSDT: number;
  topGainer: { symbol: string; pct: number };
  topLoser: { symbol: string; pct: number };
  btcPrice: number;
  activePairs: number;
}
