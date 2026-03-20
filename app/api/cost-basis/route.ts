import { NextResponse } from "next/server";
import { getAccount, getMyTrades } from "../../lib/binance-auth";
import { apiError } from "../../lib/api-error";
import { STABLES } from "../../lib/constants";

export interface CostBasisEntry {
  avgCost: number;
  totalQty: number;
  firstBuyTime: number;  // ms timestamp of first buy trade
}

export async function GET() {
  try {
    const account = await getAccount();
    const assets = account.balances
      .filter(b => {
        const total = parseFloat(b.free) + parseFloat(b.locked);
        return total > 0 && !STABLES.has(b.asset);
      })
      .map(b => b.asset);

    const results = await Promise.allSettled(
      assets.map(asset => getMyTrades(`${asset}USDT`, 500))
    );

    const costBasis: Record<string, CostBasisEntry> = {};

    assets.forEach((asset, i) => {
      const result = results[i];
      if (result.status !== "fulfilled") return;

      // Ordered chronologically (Binance retorna per ordre de temps)
      const trades = result.value;
      let totalQty    = 0;
      let avgCost     = 0;
      let firstBuyTime = 0;

      for (const t of trades) {
        const qty   = parseFloat(t.qty);
        const price = parseFloat(t.price);
        if (t.isBuyer) {
          // Descomptar comissió si es paga en el base asset (ex: BTC si compres BTCUSDT)
          const commBase = t.commissionAsset === asset ? parseFloat(t.commission) : 0;
          const netQty   = qty - commBase;
          if (netQty > 0) {
            if (firstBuyTime === 0) firstBuyTime = t.time;
            avgCost  = (avgCost * totalQty + price * netQty) / (totalQty + netQty);
            totalQty += netQty;
          }
        } else {
          // Venda: redueix posició, cost mig no canvia
          totalQty = Math.max(0, totalQty - qty);
          // Si la posició es tanca completament, resetejem el timestamp
          if (totalQty === 0) { avgCost = 0; firstBuyTime = 0; }
        }
      }

      if (totalQty > 0 && avgCost > 0) {
        costBasis[asset] = { avgCost, totalQty, firstBuyTime };
      }
    });

    return NextResponse.json(costBasis);
  } catch (e) {
    return apiError(e, "cost-basis");
  }
}
