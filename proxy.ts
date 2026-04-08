import { NextRequest, NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import type { SessionData } from "./app/lib/session";
import { getSessionOptions } from "./app/lib/session";

const PUBLIC = ["/login", "/api/auth/login", "/api/auth/logout", "/www"];

const ALLOWED_ORIGINS = [
  "http://localhost:3001",
  /^https:\/\/.*\.trycloudflare\.com$/,
];

function getAllowOrigin(origin: string | null): string | null {
  if (!origin) return null;
  for (const allowed of ALLOWED_ORIGINS) {
    if (typeof allowed === "string" ? allowed === origin : allowed.test(origin)) {
      return origin;
    }
  }
  return null;
}

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = getAllowOrigin(origin);
  if (!allow) return {};
  return {
    "Access-Control-Allow-Origin":      allow,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods":     "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers":     "Content-Type,Authorization",
  };
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const origin = req.headers.get("origin");

  // Preflight OPTIONS
  if (req.method === "OPTIONS" && pathname.startsWith("/api/")) {
    return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
  }

  // Rutes públiques i recursos estàtics
  if (PUBLIC.some(p => pathname.startsWith(p))) {
    const res = NextResponse.next();
    Object.entries(corsHeaders(origin)).forEach(([k, v]) => res.headers.set(k, v));
    return res;
  }

  const res     = NextResponse.next();
  const session = await getIronSession<SessionData>(req, res, getSessionOptions());

  if (!session.isLoggedIn) {
    // Crides API → JSON 401 (no HTML, per no trencar res.json() al client)
    if (pathname.startsWith("/api/")) {
      const r401 = NextResponse.json(
        { error: "Sessió caducada. Torna a iniciar sessió.", code: "AUTH" },
        { status: 401 }
      );
      Object.entries(corsHeaders(origin)).forEach(([k, v]) => r401.headers.set(k, v));
      return r401;
    }
    // Pàgines → redirigeix a /login
    return NextResponse.redirect(new URL("/login", req.url));
  }

  Object.entries(corsHeaders(origin)).forEach(([k, v]) => res.headers.set(k, v));
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
