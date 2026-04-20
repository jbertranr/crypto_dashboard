/**
 * Subscriu-se al event-bus i guarda cada event rellevant a activity_log.
 * S'inicia com a singleton (una sola subscripció per procés).
 */
import { eventBus, type AppEvent } from "./event-bus";
import { activityPush } from "./activity-store";
import { settingGetBool } from "./settings-store";

const activityEnabled = () =>
  settingGetBool("activity_logger_enabled") || settingGetBool("activity_logger_enabled_real");

declare global {
  var __activityLoggerStarted: boolean | undefined;
  var __activityLoggerVer:     string  | undefined;
}
const LOGGER_VER = "qtype-1";

type MotorKey = "trailing" | "monitor" | "autotrader" | "crash" | "scheduler" | "system";

// ── Motor from log module ──────────────────────────────────────────────────────
function modToMotor(mod: string, msg = ""): MotorKey {
  if (mod.includes("trailing") || mod.includes("trailing-engine")) return "trailing";
  if (mod.includes("monitor")  || mod.includes("order-monitor"))   return "monitor";
  if (mod.includes("auto-trader") || mod === "auto")                return "autotrader";
  if (mod.includes("crash"))                                        return "crash";
  if (mod.includes("telegram") || mod.includes("scheduler"))        return "scheduler";
  if (mod === "binance" || mod === "orders") {
    if (/trades|order.hist|open.order|fill|execut/i.test(msg))     return "monitor";
    if (/scanner|klines|candle|score|buy.signal/i.test(msg))       return "autotrader";
    if (/btc.*price|crash|drop/i.test(msg))                        return "crash";
    if (/balance|budget/i.test(msg))                               return "autotrader";
  }
  return "system";
}

// ── Tipus de consulta (qtype) per motor ────────────────────────────────────────
// Retorna una etiqueta curta (~20 car.) que descriu el tipus d'operació.

const TRAILING_QTYPES: [RegExp, string][] = [
  [/activ/i,                        "Activa trailing"],
  [/cancel/i,                       "Cancel·la ordre SL"],
  [/col·loc|place|new.*order|sl.*order/i, "Col·loca ordre SL"],
  [/mov|updat.*sl|sl.*updat/i,      "Actualitza SL"],
  [/consult|fetch|check|get.*order/i,"Consulta ordre SL"],
  [/cicle|tick|poll|loop|scan/i,    "Cicle trailing"],
  [/pic|peak/i,                     "Nou pic detectat"],
  [/error|fail/i,                   "Error Binance"],
];

const MONITOR_QTYPES: [RegExp, string][] = [
  [/fill|execut|complet/i,          "Execució detectada"],
  [/journal/i,                      "Escriu journal"],
  [/cancel/i,                       "Cancel·la ordre"],
  [/consult|fetch|open.*order|get.*order/i, "Consulta ordres obertes"],
  [/poll|cicle|tick/i,              "Cicle monitor"],
];

const AUTOTRADER_QTYPES: [RegExp, string][] = [
  [/compra|buy.*exec|market.*buy/i, "Executa compra"],
  [/oco|place.*oco/i,               "Col·loca OCO"],
  [/klines|veles|candle/i,          "Obté veles"],
  [/anàlisi|analiz|score|scan/i,    "Escaneig símbol"],
  [/bot.*activ|start.*bot/i,        "Bot activat"],
  [/cicle|poll|tick/i,              "Cicle auto-trader"],
  [/limit|budget|pressupost/i,      "Comprova pressupost"],
];

const CRASH_QTYPES: [RegExp, string][] = [
  [/crash|alerta|alert|trigger/i,   "Alerta crash BTC"],
  [/cancel/i,                       "Cancel·la ordres"],
  [/preu|price|btc/i,               "Consulta preu BTC"],
  [/cicle|poll|tick/i,              "Cicle crash monitor"],
];

const SCHEDULER_QTYPES: [RegExp, string][] = [
  [/diari|daily|7.30|7:30/i,        "Informe diari"],
  [/horar|hourly|hora/i,            "Informe horari"],
  [/snapshot|portfolio/i,           "Snapshot portfolio"],
  [/telegram|missatge|send/i,       "Envia Telegram"],
];

function matchQtype(patterns: [RegExp, string][], msg: string): string | null {
  for (const [re, label] of patterns) {
    if (re.test(msg)) return label;
  }
  return null;
}

function qtypeFromLog(motor: MotorKey, msg: string, level: number): string {
  if (level >= 50) return "Error sistema";
  if (level >= 40) return "Advertència";
  switch (motor) {
    case "trailing":   return matchQtype(TRAILING_QTYPES,   msg) ?? "Cicle trailing";
    case "monitor":    return matchQtype(MONITOR_QTYPES,    msg) ?? "Cicle monitor";
    case "autotrader": return matchQtype(AUTOTRADER_QTYPES, msg) ?? "Cicle auto-trader";
    case "crash":      return matchQtype(CRASH_QTYPES,      msg) ?? "Cicle crash monitor";
    case "scheduler":  return matchQtype(SCHEDULER_QTYPES,  msg) ?? "Tasca planificada";
    default:           return "Operació sistema";
  }
}

// ── Visual classification ──────────────────────────────────────────────────────
function classifyLog(mod: string, msg: string, level: number) {
  if (level >= 50) return { motor: modToMotor(mod, msg), kind: "error",    badge: "ERR",   icon: "fa-circle-exclamation" };
  if (level >= 40) return { motor: modToMotor(mod, msg), kind: "warn",     badge: "WARN",  icon: "fa-triangle-exclamation" };
  const motor = modToMotor(mod, msg);
  if (motor === "autotrader") {
    const isBuy = /compra|buy|executat|order/i.test(msg);
    return { motor, kind: isBuy ? "bot_buy" : "bot_scan", badge: "BOT", icon: isBuy ? "fa-cart-shopping" : "fa-magnifying-glass" };
  }
  if (motor === "trailing")  return { motor, kind: "trailing",  badge: "TRAIL", icon: "fa-shield-halved" };
  if (motor === "monitor")   return { motor, kind: "system",    badge: "MON",   icon: "fa-eye" };
  if (motor === "crash")     return { motor, kind: "warn",      badge: "CRASH", icon: "fa-triangle-exclamation" };
  if (motor === "scheduler") return { motor, kind: "scheduler", badge: "SCHED", icon: "fa-clock" };
  return { motor: "system" as MotorKey, kind: "data", badge: "SYS", icon: "fa-gear" };
}

// ── Singleton listener ─────────────────────────────────────────────────────────
export function ensureActivityLogger(): void {
  if (global.__activityLoggerStarted && global.__activityLoggerVer === LOGGER_VER) return;
  global.__activityLoggerStarted = true;
  global.__activityLoggerVer     = LOGGER_VER;

  eventBus.onEvent("log:new", (event: AppEvent) => {
    if (!activityEnabled()) return;
    if (event.type !== "log:new") return;
    const { ts, level, module: mod = "", msg } = event.payload;
    const cls   = classifyLog(mod, msg, level);
    const qtype = qtypeFromLog(cls.motor, msg, level);
    activityPush({ ts, ...cls, qtype, msg, detail: mod || null });
  });

  eventBus.onEvent("order:fill", (event: AppEvent) => {
    if (!activityEnabled()) return;
    if (event.type !== "order:fill") return;
    const { symbol, side, execPrice } = event.payload;
    activityPush({ ts: Date.now(), motor: "monitor", kind: "fill",
      badge: "FILL", icon: "fa-arrow-right-arrow-left",
      qtype: "Execució detectada",
      msg: `${side} ${symbol} @ ${execPrice}` });
  });

  eventBus.onEvent("trailing:activated", (event: AppEvent) => {
    if (event.type !== "trailing:activated") return;
    activityPush({ ts: Date.now(), motor: "trailing", kind: "trailing",
      badge: "TRAIL", icon: "fa-shield-halved",
      qtype: "Activa trailing",
      msg: `Trailing activat: ${event.payload.symbol}` });
  });

  eventBus.onEvent("trailing:sl_moved", (event: AppEvent) => {
    if (event.type !== "trailing:sl_moved") return;
    const { symbol, newSl } = event.payload;
    activityPush({ ts: Date.now(), motor: "trailing", kind: "trailing",
      badge: "SL", icon: "fa-shield-halved",
      qtype: "Actualitza SL",
      msg: `SL mogut: ${symbol} → ${newSl}` });
  });
}
