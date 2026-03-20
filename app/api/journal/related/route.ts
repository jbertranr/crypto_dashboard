import { NextRequest, NextResponse } from "next/server";
import { journalGetRelated } from "../../../lib/journal-store";

export async function GET(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    const entries = journalGetRelated(id);
    return NextResponse.json(entries);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
