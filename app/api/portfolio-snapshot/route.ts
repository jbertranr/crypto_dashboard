import { NextRequest, NextResponse } from "next/server";
import { addSnapshot, getSnapshots } from "../../lib/snapshot-store";

export async function GET() {
  return NextResponse.json(getSnapshots(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { time: number; value: number };
  if (typeof body.time !== "number" || typeof body.value !== "number") {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  addSnapshot({ time: body.time, value: body.value });
  return NextResponse.json({ ok: true });
}
