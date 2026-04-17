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
 * Envia un Telegram d'avís però NO bloqueja l'operació.
 */
export async function warnBotRealFromDev(botName: string, symbol: string): Promise<void> {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const isDev   = nodeEnv !== "production";
  if (!isDev) return;

  const msg =
    `⚠️ <b>AVÍS DE DESENVOLUPAMENT</b>\n\n` +
    `El bot <b>${botName}</b> està executant una operació <b>REAL</b> des d'un entorn de desenvolupament (localhost).\n\n` +
    `Símbol: <b>${symbol}</b>\n` +
    `Entorn: <code>${nodeEnv}</code>\n\n` +
    `<i>Si això és intencionat, ignora aquest missatge. Si no, atura el bot immediatament.</i>`;

  await sendTelegram(msg, "real").catch(err =>
    log.auto.warn({ err: (err as Error).message }, "warnBotRealFromDev: error enviant Telegram"),
  );
}
