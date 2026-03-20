/**
 * api-error — helper centralitzat per a tots els catch d'API routes
 *
 * Classifica l'error, el logga amb Pino, el persiteix a SQLite
 * i retorna un NextResponse consistent:
 *   { error: string, code: ErrorCode }
 */

import { NextResponse } from "next/server";
import { log } from "./logger";
import { recordError, Severity } from "./error-store";

export type ErrorCode =
  | "RATE_LIMIT"
  | "AUTH"
  | "BAD_PARAMS"
  | "NOT_FOUND"
  | "NETWORK"
  | "INTERNAL";

function classify(msg: string): { code: ErrorCode; status: number; severity: Severity } {
  const m = msg.toLowerCase();

  if (m.includes("429") || m.includes("-1003") || m.includes("rate limit"))
    return { code: "RATE_LIMIT", status: 429, severity: "warn"     };
  if (m.includes("401") || m.includes("-2014") || m.includes("api-key") || m.includes("invalid key"))
    return { code: "AUTH",       status: 401, severity: "critical"  };
  if (m.includes("400") || m.includes("-1100") || m.includes("-1013") || m.includes("bad params"))
    return { code: "BAD_PARAMS", status: 400, severity: "warn"     };
  if (m.includes("404") || m.includes("-2011") || m.includes("no such"))
    return { code: "NOT_FOUND",  status: 404, severity: "warn"     };
  if (m.includes("fetch") || m.includes("econnrefused") || m.includes("network") || m.includes("etimedout"))
    return { code: "NETWORK",    status: 503, severity: "error"    };

  return { code: "INTERNAL", status: 500, severity: "error" };
}

export function apiError(
  e: unknown,
  source: string,
  extra?: Record<string, unknown>
): NextResponse<{ error: string; code: ErrorCode }> {
  const err = e instanceof Error ? e : new Error(String(e));
  const { code, status, severity } = classify(err.message);

  log.api.error({ source, code, err: err.message, ...extra }, "error de ruta");
  recordError(source, severity, code, err.message, extra);

  return NextResponse.json({ error: err.message, code }, { status });
}
