import { NextRequest, NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { SessionData, getSessionOptions } from "../../../lib/session";

export async function POST(req: NextRequest) {
  const { password } = await req.json() as { password: string };

  if (!password || password !== process.env.DASHBOARD_PASSWORD) {
    // Delay amb jitter per dificultar brute-force (1–3 s)
    await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
    return NextResponse.json({ error: "Contrasenya incorrecta" }, { status: 401 });
  }

  const session = await getIronSession<SessionData>(await cookies(), getSessionOptions());
  session.isLoggedIn = true;
  await session.save();

  return NextResponse.json({ ok: true });
}
