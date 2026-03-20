import { NextRequest, NextResponse } from "next/server";
import { getRecentErrors, countErrorsSince, clearErrors } from "../../lib/error-store";

/** GET /api/errors?since=<ts>  — retorna errors recents */
export async function GET(req: NextRequest) {
  const since = parseInt(req.nextUrl.searchParams.get("since") ?? "0", 10);
  const errors = getRecentErrors(100);
  const unseen = since > 0 ? countErrorsSince(since) : errors.length;
  return NextResponse.json({ errors, unseen });
}

/** DELETE /api/errors  — esborra tots els errors */
export async function DELETE() {
  clearErrors();
  return NextResponse.json({ ok: true });
}
