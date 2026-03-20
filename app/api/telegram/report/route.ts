import { NextResponse } from "next/server";
import { getAccount, getOpenOrders } from "../../../lib/binance-auth";
import { sendPortfolioReport, isConfigured } from "../../../lib/telegram";
import { apiError } from "../../../lib/api-error";
import { getSnapshots } from "../../../lib/snapshot-store";
import { STABLES, BINANCE_BASE } from "../../../lib/constants";

interface Ticker { symbol: string; lastPrice: string; priceChangePercent: string; }

async function fetchTickers(pairs: string[]): Promise<Map<string, Ticker>> {
  const map = new Map<string, Ticker>();
  try {
    // Fetch individual prices for the specific pairs we need
    const results = await Promise.allSettled(
      pairs.map(p =>
        fetch(`${BINANCE_BASE}/ticker/24hr?symbol=${p}`, { cache: "no-store" })
          .then(r => r.json() as Promise<Ticker>)
      )
    );
    results.forEach((r, i) => {
      if (r.status === "fulfilled") map.set(pairs[i], r.value);
    });
  } catch { /* retorna el mapa buit si fallen */ }
  return map;
}

export async function POST() {
  if (!isConfigured()) {
    return NextResponse.json(
      { error: "Telegram no configurat. Afegeix TELEGRAM_BOT_TOKEN i TELEGRAM_CHAT_ID a .env.local" },
      { status: 503 }
    );
  }

  try {
    // Dades paral·leles: balances + ordres obertes
    const [account, openOrders] = await Promise.all([
      getAccount(),
      getOpenOrders(),
    ]);

    // Assets amb saldo positiu
    const assets = account.balances.filter(b => {
      const total = parseFloat(b.free) + parseFloat(b.locked);
      return total > 0.000001;
    });

    // Parells USDT a consultar (no stables)
    const pairs = assets
      .filter(b => !STABLES.has(b.asset))
      .map(b => `${b.asset}USDT`);

    const tickers = await fetchTickers(pairs);

    // Calcula valor i P&L per asset
    type AssetVal = { asset: string; valueUSD: number; pct: number; change24h: number };
    let totalValue = 0;
    let totalPnl24 = 0;

    const assetRows: AssetVal[] = assets.map(b => {
      const qty       = parseFloat(b.free) + parseFloat(b.locked);
      const isStable  = STABLES.has(b.asset);
      const ticker    = tickers.get(`${b.asset}USDT`);
      const price     = ticker ? parseFloat(ticker.lastPrice) : (isStable ? 1 : 0);
      const change24h = ticker ? parseFloat(ticker.priceChangePercent) : 0;
      const valueUSD  = qty * price;
      const pnl24h    = valueUSD * (change24h / 100);

      totalValue += valueUSD;
      totalPnl24 += pnl24h;

      return { asset: b.asset, valueUSD, pct: 0, change24h };
    });

    // Calcula pct del portfolio per a cada asset
    assetRows.forEach(r => { r.pct = totalValue > 0 ? (r.valueUSD / totalValue) * 100 : 0; });

    const pnlPct    = totalValue > 0 ? (totalPnl24 / (totalValue - totalPnl24)) * 100 : 0;
    const ocoCount  = new Set(openOrders.filter(o => o.orderListId !== -1).map(o => o.orderListId)).size;
    const limCount  = openOrders.filter(o => o.orderListId === -1).length;

    // Cryptos >= $10, ordenades per valor
    const top = [...assetRows]
      .filter(r => r.valueUSD >= 10 && !STABLES.has(r.asset))
      .sort((a, b) => b.valueUSD - a.valueUSD)
      .slice(0, 8);

    // Stables
    const stables = [...assetRows]
      .filter(r => STABLES.has(r.asset) && r.valueUSD > 0.01)
      .sort((a, b) => b.valueUSD - a.valueUSD);

    const cryptoValue = assetRows.filter(r => !STABLES.has(r.asset)).reduce((s, r) => s + r.valueUSD, 0);
    const stableValue = stables.reduce((s, r) => s + r.valueUSD, 0);

    // Deltes basats en snapshots (canvi real de saldo)
    const snaps   = getSnapshots();
    const now     = Date.now();
    const snap1h  = [...snaps].reverse().find(s => s.time <= now - 60 * 60 * 1000) ?? null;
    const snap24h = [...snaps].reverse().find(s => s.time <= now - 24 * 60 * 60 * 1000) ?? null;

    await sendPortfolioReport({
      totalValue,
      cryptoValue,
      stableValue,
      pnl24h:     totalPnl24,
      pnlPct,
      delta1h:    snap1h  ? totalValue - snap1h.value  : null,
      delta24h:   snap24h ? totalValue - snap24h.value : null,
      openOrders: openOrders.length,
      ocoCount,
      limitCount: limCount,
      top,
      stables,
    });

    return NextResponse.json({ ok: true, totalValue, openOrders: openOrders.length });
  } catch (e) {
    return apiError(e, "telegram/report");
  }
}
