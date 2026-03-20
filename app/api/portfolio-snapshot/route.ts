import { NextRequest, NextResponse } from "next/server";
import { addSnapshot, getSnapshots } from "../../lib/snapshot-store";

// Exclude snapshots recorded before the portfolio tracking start date
const PORTFOLIO_START = new Date("2026-03-17T00:00:00+01:00").getTime();

export async function GET() {
  const data = getSnapshots().filter(s => s.time >= PORTFOLIO_START);
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { time: number; value: number };
  if (typeof body.time !== "number" || typeof body.value !== "number") {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  addSnapshot({ time: body.time, value: body.value });
  return NextResponse.json({ ok: true });
}
