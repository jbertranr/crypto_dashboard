import { NextResponse } from "next/server";
import { getMarketData } from "../../lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { coins } = await getMarketData();
    return NextResponse.json(coins);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
