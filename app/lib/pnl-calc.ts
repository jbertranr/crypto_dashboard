import type { BinanceTrade } from "./binance-auth";

export interface PnlPoint { time: number; pnl: number; }

/**
 * Càlcul de P&L realitzat FIFO per un conjunt de trades d'un parell.
 * Usa quoteQty (USDC real liquidat) per capturar el preu d'execució real
 * incl. slippage. Comissions USDC es descompten; comissions BNB s'ignoren
 * (es paguen d'un wallet separat).
 */
export function calcSymbolPnl(trades: BinanceTrade[]): PnlPoint[] {
  const sorted = [...trades].sort((a, b) => a.time - b.time);
  const buyQueue: { qty: number; unitCost: number }[] = [];
  const results: PnlPoint[] = [];

  for (const t of sorted) {
    const qty      = parseFloat(t.qty);
    const quoteQty = parseFloat(t.quoteQty);
    const commUSDT = t.commissionAsset === "USDT" ? parseFloat(t.commission) : 0;

    if (t.isBuyer) {
      buyQueue.push({ qty, unitCost: quoteQty / qty });
    } else {
      let remaining = qty;
      let totalCost = 0;
      while (remaining > 1e-12 && buyQueue.length > 0) {
        const lot  = buyQueue[0];
        const used = Math.min(remaining, lot.qty);
        totalCost += used * lot.unitCost;
        lot.qty   -= used;
        remaining -= used;
        if (lot.qty < 1e-12) buyQueue.shift();
      }
      const revenue = quoteQty - commUSDT;
      results.push({ time: t.time, pnl: revenue - totalCost });
    }
  }
  return results;
}
