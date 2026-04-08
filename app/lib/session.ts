import type { SessionOptions } from "iron-session";

export interface SessionData {
  isLoggedIn: boolean;
  username?: string;
}

// Funció en lloc de constant per garantir que llegeix l'env
// en el moment d'ús (tant en Node.js runtime com en edge middleware)
export function getSessionOptions(): SessionOptions {
  const password = process.env.SESSION_SECRET ?? "";
  if (!password || password.length < 32) {
    throw new Error("SESSION_SECRET ha de tenir mínim 32 caràcters. Afegeix-lo a .env.local");
  }
  return {
    password,
    cookieName: "cd_session",
    cookieOptions: {
      // SECURE_COOKIE=1 només si l'accés és via HTTPS (Cloudflare, nginx TLS…)
      // Amb IP directa http:// cal que sigui false o el navegador no envia la cookie
      secure: process.env.SECURE_COOKIE === "1",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 dies
    },
  };
}

/** Àlies per compatibilitat amb el codi existent */
export const SESSION_OPTIONS = getSessionOptions();
