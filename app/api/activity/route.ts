export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { activityGetRecent } from "../../lib/activity-store";
import { ensureActivityLogger } from "../../lib/activity-logger";

ensureActivityLogger();

export async function GET() {
  const items = activityGetRecent(300);
  return NextResponse.json(items);
}
