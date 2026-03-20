import { NextRequest, NextResponse } from "next/server";
import { cacheDeletePrefix } from "../../../lib/cache-store";

export async function DELETE(req: NextRequest) {
  const prefix = req.nextUrl.searchParams.get("prefix");
  if (!prefix) return NextResponse.json({ error: "prefix required" }, { status: 400 });
  if (!/^[a-z0-9:_-]+$/.test(prefix)) {
    return NextResponse.json({ error: "prefix invàlid" }, { status: 400 });
  }

  cacheDeletePrefix(prefix);
  return NextResponse.json({ ok: true, prefix });
}
