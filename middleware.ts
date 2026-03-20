import { NextRequest, NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import type { SessionData } from "./app/lib/session";
import { getSessionOptions } from "./app/lib/session";

const PUBLIC = ["/login", "/api/auth/login", "/api/auth/logout"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Rutes públiques i recursos estàtics
  if (PUBLIC.some(p => pathname.startsWith(p))) return NextResponse.next();

  const res     = NextResponse.next();
  const session = await getIronSession<SessionData>(req, res, getSessionOptions());

  if (!session.isLoggedIn) {
    // Crides API → JSON 401 (no HTML, per no trencar res.json() al client)
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Sessió caducada. Torna a iniciar sessió.", code: "AUTH" },
        { status: 401 }
      );
    }
    // Pàgines → redirigeix a /login
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
