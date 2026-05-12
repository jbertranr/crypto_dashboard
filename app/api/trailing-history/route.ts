import { NextRequest, NextResponse } from "next/server";
import { trailingSlHistoryGet, trailingSlHistoryGetBySymbol, trailingActiveGetAllIncludingDone } from "../../lib/cache-store";

export interface SlMod {
  time:  number;
  oldSl: number;
  newSl: number;
  peak:  number;
}

export async function GET(req: NextRequest) {
  const sp              = req.nextUrl.searchParams;
  const symbol          = sp.get("symbol");
  const trailingIdParam = sp.get("trailingActiveId");
  const fromMs          = parseInt(sp.get("from") ?? "0", 10);
  const toMs            = parseInt(sp.get("to")   ?? String(Date.now()), 10);

  // Lookup by trailingActiveId (precise, preferred)
  if (trailingIdParam) {
    const id = parseInt(trailingIdParam, 10);
    if (isNaN(id)) return NextResponse.json({ error: "trailingActiveId invàlid" }, { status: 400 });
    return NextResponse.json(trailingSlHistoryGet(id));
  }

  // Lookup by symbol + time range
  if (!symbol || !fromMs) {
    return NextResponse.json({ error: "symbol i from són obligatoris (o trailingActiveId)" }, { status: 400 });
  }

  // Try DB first (new records)
  const dbMods = trailingSlHistoryGetBySymbol(symbol, fromMs, toMs);
  if (dbMods.length > 0) {
    return NextResponse.json(dbMods);
  }

  // Fallback: look up by matching trailing_active record for this symbol/timerange
  const allTrailing = trailingActiveGetAllIncludingDone();
  const match = allTrailing.find(t =>
    t.symbol === symbol &&
    t.createdAt >= fromMs - 60_000 &&
    t.createdAt <= toMs + 60_000
  );
  if (match) {
    const mods = trailingSlHistoryGet(match.id);
    if (mods.length > 0) return NextResponse.json(mods);
  }

  return NextResponse.json([]);
}
