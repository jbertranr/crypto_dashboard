import { NextRequest, NextResponse } from "next/server";
import {
  journalGetAll, journalStats, journalAdd, journalPatchNotes,
  journalPatchStrategy, journalDelete, NewJournalEntry,
} from "../../lib/journal-store";
import { apiError } from "../../lib/api-error";

/* GET /api/journal?symbol=&side=&strategy=&from=&to=&limit=&offset= */
export async function GET(req: NextRequest) {
  try {
    const p        = req.nextUrl.searchParams;
    const entries  = journalGetAll({
      symbol:   p.get("symbol")   ?? undefined,
      side:     p.get("side")     ?? undefined,
      strategy: p.get("strategy") ?? undefined,
      from:     p.get("from")     ? parseInt(p.get("from")!)   : undefined,
      to:       p.get("to")       ? parseInt(p.get("to")!)     : undefined,
      limit:    p.get("limit")    ? parseInt(p.get("limit")!)  : 200,
      offset:   p.get("offset")   ? parseInt(p.get("offset")!) : 0,
    });
    const stats = journalStats();
    return NextResponse.json({ entries, stats });
  } catch (e) {
    return apiError(e, "journal/GET");
  }
}

/* POST /api/journal — add manual entry */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as NewJournalEntry;
    const id   = journalAdd({ ...body, source: "MANUAL" });
    return NextResponse.json({ id });
  } catch (e) {
    return apiError(e, "journal/POST");
  }
}

/* PATCH /api/journal — patch notes or strategy */
export async function PATCH(req: NextRequest) {
  try {
    const { id, notes, strategy, _delete } = await req.json() as {
      id: number; notes?: string; strategy?: string | null; _delete?: boolean;
    };
    if (_delete)                   journalDelete(id);
    if (notes     !== undefined)   journalPatchNotes(id, notes);
    if (strategy  !== undefined)   journalPatchStrategy(id, strategy ?? null);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e, "journal/PATCH");
  }
}
