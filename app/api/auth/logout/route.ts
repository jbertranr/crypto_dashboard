import { NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { SessionData, getSessionOptions } from "../../../lib/session";

export async function POST() {
  const session = await getIronSession<SessionData>(await cookies(), getSessionOptions());
  session.destroy();
  return NextResponse.json({ ok: true });
}
