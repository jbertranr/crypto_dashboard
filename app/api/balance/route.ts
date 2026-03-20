import { NextResponse } from "next/server";
import { getAccount } from "../../lib/binance-auth";
import { apiError } from "../../lib/api-error";
import { log } from "../../lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const account = await getAccount();
    // Only return assets with non-zero balance
    const balances = account.balances.filter(
      (b) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0
    );
    log.binance.info({ assets: balances.length }, "balance");
    const res = NextResponse.json(balances);
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (e) {
    return apiError(e, "balance");
  }
}
