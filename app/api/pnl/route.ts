import { NextResponse } from "next/server";
import { cacheGet, cacheSet } from "../../lib/cache-store";
import { journalGetAll } from "../../lib/journal-store";
import { apiError } from "../../lib/api-error";

const EXIT_TYPES = new Set(["EXIT_TP", "EXIT_SL", "EXIT_TRAILING", "EXIT_MARKET"]);

export async function GET() {
  const KEY = "pnl:summary";
  const cached = cacheGet<{ d1: number; d7: number; d30: number; d365: number }>(KEY);
  if (cached) return NextResponse.json(cached.data);

  try {
    const exits = journalGetAll({ limit: 5000 })
      .filter(e => EXIT_TYPES.has(e.type) && e.pnlUsdt != null);

    const now   = Date.now();
    const since = (days: number) => now - days * 86_400_000;
    const sum   = (minTime: number) =>
      exits.filter(e => e.executedAt >= minTime).reduce((s, e) => s + (e.pnlUsdt ?? 0), 0);

    const result = {
      d1:   sum(since(1)),
      d7:   sum(since(7)),
      d30:  sum(since(30)),
      d365: sum(since(365)),
    };

    cacheSet(KEY, result, 300);
    return NextResponse.json(result);
  } catch (e) {
    return apiError(e, "pnl");
  }
}
