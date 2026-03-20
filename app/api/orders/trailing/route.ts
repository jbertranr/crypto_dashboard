import { NextResponse } from "next/server";
import { trailingGetAll, trailingActiveGetAllIncludingDone } from "../../../lib/cache-store";
import { ensureTrailingEngine } from "../../../lib/trailing-engine";

export async function GET() {
  ensureTrailingEngine();
  return NextResponse.json({
    suggestions: trailingGetAll(),
    active: trailingActiveGetAllIncludingDone(),
  });
}
