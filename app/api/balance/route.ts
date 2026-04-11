import { NextResponse } from "next/server";
import { getAccount } from "../../lib/binance-auth";
import { apiError } from "../../lib/api-error";
import { log } from "../../lib/logger";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get("mode") === "real" ? "real" : "paper";
    const account = await getAccount(mode);
    // Only return assets with non-zero balance
    const balances = account.balances.filter(
      (b) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0
    );
    log.binance.info({ assets: balances.length, mode }, "balance");
    const res = NextResponse.json(balances);
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (e) {
    return apiError(e, "balance");
  }
}
