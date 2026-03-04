import { NextResponse } from "next/server";
import { getAccount } from "../../lib/binance-auth";

export async function GET() {
  try {
    const account = await getAccount();
    // Only return assets with non-zero balance
    const balances = account.balances.filter(
      (b) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0
    );
    return NextResponse.json(balances);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
