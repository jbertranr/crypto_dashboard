/**
 * Logger central — basat en Pino
 *
 * Dev:  pino-pretty a la consola  +  JSON a logs/app-YYYY-MM-DD.log
 * Prod: JSON a logs/app-YYYY-MM-DD.log
 *
 * Child loggers disponibles per mòdul:
 *   import { log } from "@/lib/logger";
 *   log.trailing.info("SL mogut");
 *   log.api.warn({ symbol }, "rate limit proper");
 */

import pino, { type Logger } from "pino";
import pretty from "pino-pretty";
import path from "path";
import fs from "fs";
import { Writable } from "stream";

/* ── Directori de logs ─────────────────────────────────────────── */
const LOG_DIR = path.join(process.cwd(), "logs");
// Assegurem que el directori existeix (pino/file ho fa amb mkdir:true,
// però l'API de logs també necessita accedir-hi directament).
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

export function todayFile(): string {
  return path.join(LOG_DIR, `app-${new Date().toISOString().slice(0, 10)}.log`);
}

export { LOG_DIR };

/* ── Crea el logger base (singleton via global) ────────────────── */
// __pinoLoggerVer: quan canvia, força reconstruir el logger (hot-reload safe)
const LOGGER_VER = "sse-1";
declare global {
  var __pinoLogger:    Logger | undefined;
  var __pinoLoggerVer: string | undefined;
}

function buildLogger(): Logger {
  const isDev = process.env.NODE_ENV !== "production";
  const dest  = todayFile();

  // pino.destination usa SonicBoom (stream síncron-compatible, sense worker threads)
  const fileStream = pino.destination({ dest, append: true, mkdir: true, sync: false });

  // Stream SSE: remet events log:new al event-bus per a clients SSE connectats
  const sseStream = new Writable({
    write(chunk, _enc, cb) {
      try {
        const entry = JSON.parse(chunk.toString()) as Record<string, unknown>;
        if (!entry.ts && entry.time) entry.ts = entry.time;
        import("./event-bus").then(({ eventBus }) =>
          eventBus.emitEvent({ type: "log:new", payload: entry as import("./event-bus").LogEntry })
        ).catch(() => {});
      } catch { /* línia malformada */ }
      cb();
    },
  });

  if (isDev) {
    // pino-pretty com a transform (stream normal, no ThreadStream) —
    // pino.multistream pot combinar-los sense problemes
    const prettyStream = pretty({
      colorize:            true,
      translateTime:       "SYS:HH:MM:ss.l",
      ignore:              "pid,hostname",
      messageFormat:       "{module} › {msg}",
      errorLikeObjectKeys: ["err", "error"],
    });
    return pino(
      { level: "debug" },
      pino.multistream([
        { stream: prettyStream },
        { stream: fileStream   },
        { stream: sseStream, level: "info" },
      ])
    );
  }

  // Producció: JSON a fitxer diari + SSE
  return pino(
    { level: "info" },
    pino.multistream([
      { stream: fileStream },
      { stream: sseStream, level: "info" },
    ])
  );
}

// Reconstruïm si no existeix O si la versió ha canviat (hot-reload)
if (global.__pinoLoggerVer !== LOGGER_VER) {
  global.__pinoLogger    = buildLogger();
  global.__pinoLoggerVer = LOGGER_VER;
}
const root: Logger = global.__pinoLogger!;

/* ── Child loggers per mòdul ───────────────────────────────────── */
export const log = {
  /** Motor de trailing stop */
  trailing: root.child({ module: "trailing-engine" }),
  /** Monitor de fills d'ordres */
  monitor:  root.child({ module: "order-monitor"   }),
  /** Integració Telegram */
  telegram: root.child({ module: "telegram"         }),
  /** API routes genèriques */
  api:      root.child({ module: "api"              }),
  /** Anàlisi tècnica */
  analysis: root.child({ module: "analysis"         }),
  /** Caché SQLite */
  cache:    root.child({ module: "cache"            }),
  /** Activitat d'ordres (entrada, venda, compra, cancel·lació...) */
  orders:   root.child({ module: "orders"           }),
  /** Baixades de dades de Binance i resultats del scanner */
  binance:  root.child({ module: "binance"          }),
  /** Trading automàtic (auto-trader) */
  auto:     root.child({ module: "auto-trader"      }),
  /** Logger arrel per usos generals */
  root,
} as const;

export default root;
