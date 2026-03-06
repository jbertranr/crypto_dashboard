import { NextRequest, NextResponse } from "next/server";
import { getStrategies, setStrategy } from "../../lib/strategy-store";

export async function GET() {
  return NextResponse.json(getStrategies(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const { key, strategy } = await req.json() as { key: string; strategy: string | null };
  if (!key) return NextResponse.json({ error: "Missing key" }, { status: 400 });
  setStrategy(key, strategy ?? null);
  return NextResponse.json({ ok: true });
}
