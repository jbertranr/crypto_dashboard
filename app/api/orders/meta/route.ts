import { NextRequest, NextResponse } from "next/server";
import { orderMetaGetAll, orderMetaPatchNotes } from "../../../lib/cache-store";

export async function GET() {
  return NextResponse.json(orderMetaGetAll(), { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(req: NextRequest) {
  const { key, exitNotes } = await req.json() as { key: string; exitNotes: string };
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });
  orderMetaPatchNotes(key, exitNotes ?? "");
  return NextResponse.json({ ok: true });
}
