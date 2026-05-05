/**
 * real-guard.ts
 * Detecta si una operació real s'està fent des de localhost/127.0.0.1.
 *
 * - En endpoints de l'API (manual): retorna un error HTTP 403.
 * - En el bot (auto-trader): envia un Telegram d'avís i continua.
 */

import { NextRequest, NextResponse } from "next/server";
import { log } from "./logger";
import { sendTelegram } from "./telegram";

function isLocalhost(req: NextRequest): boolean {
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : null;
  const host = req.headers.get("host") ?? "";

  if (ip && (ip === "127.0.0.1" || ip === "::1" || ip.startsWith("::ffff:127."))) return true;
  if (!ip && (host.startsWith("localhost") || host.startsWith("127."))) return true;
  return false;
}

/**
 * Crida des dels endpoints de l'API (operació manual).
 * Si mode=real i la request ve de localhost, retorna un 403.
 */
export function guardRealFromLocalhost(req: NextRequest, mode: string): NextResponse | null {
  if (mode !== "real") return null;
  if (!isLocalhost(req)) return null;

  log.orders.warn({ url: req.url }, "operació REAL bloquejada — origen localhost");
  return NextResponse.json(
    {
      error: "Operacions en mode REAL no permeses des de localhost / entorn de desenvolupament.",
      code: "DEV_REAL_BLOCKED",
    },
    { status: 403 },
  );
}

/**
 * Crida des del bot (auto-trader, sense request HTTP).
 * En entorn de desenvolupament bloqueja l'operació llençant un error.
 */
export async function warnBotRealFromDev(botName: string, symbol: string): Promise<void> {
  const isDev = (process.env.NODE_ENV ?? "development") !== "production";
  if (!isDev) return;

  await sendTelegram(
    `🚫 <b>COMPRA REAL BLOQUEJADA</b>\n\n` +
    `El bot <b>${botName}</b> ha intentat comprar <b>${symbol}</b> en mode REAL des d'un entorn de desenvolupament.\n\n` +
    `L'operació ha estat cancel·lada. Les compres reals només estan permeses a producció.`,
    "real",
  ).catch(err => log.auto.warn({ err: (err as Error).message }, "warnBotRealFromDev: error enviant Telegram"));

  throw new Error(`Compra REAL bloquejada en entorn de desenvolupament (bot: ${botName}, símbol: ${symbol})`);
}
