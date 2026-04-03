/**
 * Motor Watchdog — detecta comportaments anòmals dels motors i envia alertes Telegram.
 * S'invoca des de /api/status cada vegada que el client fa polling (cada 15s).
 * Rate-limit: màxim 1 alerta per motor cada 30 min.
 */
import { sendTelegram, isConfigured } from "./telegram";
import { settingGetBool, settingGet } from "./settings-store";
import type { EngineStatus } from "../api/status/route";

// Poll intervals per motor (ms) — han de coincidir amb els valors reals dels motors
const POLL_MS: Record<string, number> = {
  autoTrader:   60_000,
  orderMonitor:  5_000,   // cicle ràpid, però el status pot trigar 35s
  trailing:     30_000,
  crashMonitor: 60_000,
  scheduler:    15 * 60_000,
};

const MOTOR_LABEL: Record<string, string> = {
  autoTrader:   "Auto-Trader",
  orderMonitor: "Order Monitor",
  trailing:     "Trailing Engine",
  crashMonitor: "Crash Monitor",
  scheduler:    "Scheduler",
};

declare global {
  var __watchdogLastAlert: Map<string, number> | undefined;
}

const ALERT_COOLDOWN_MS = 30 * 60_000; // 30 min entre alertes del mateix motor

function lastAlertMap(): Map<string, number> {
  global.__watchdogLastAlert ??= new Map();
  return global.__watchdogLastAlert;
}

function canAlert(key: string): boolean {
  const map = lastAlertMap();
  const last = map.get(key) ?? 0;
  return Date.now() - last > ALERT_COOLDOWN_MS;
}

function markAlerted(key: string): void {
  lastAlertMap().set(key, Date.now());
}

type MotorData = {
  started:    boolean;
  running?:   boolean;
  lastRun:    number | null;
  lastResult: string | null;
};

function getMotorData(status: EngineStatus, key: string): MotorData | null {
  switch (key) {
    case "autoTrader":   return status.autoTrader   ? { started: status.autoTrader.started,   running: status.autoTrader.running,   lastRun: status.autoTrader.lastRun,   lastResult: status.autoTrader.lastResult }   : null;
    case "orderMonitor": return status.orderMonitor ? { started: status.orderMonitor.started, running: !!status.orderMonitor.running, lastRun: status.orderMonitor.lastRun, lastResult: status.orderMonitor.lastResult } : null;
    case "trailing":     return status.trailing     ? { started: status.trailing.started,     running: false,                         lastRun: status.trailing.lastRun,     lastResult: status.trailing.lastResult }     : null;
    case "crashMonitor": return status.crashMonitor ? { started: status.crashMonitor.started, running: false,                         lastRun: status.crashMonitor.lastRun, lastResult: status.crashMonitor.lastResult } : null;
    case "scheduler":    return status.scheduler    ? { started: status.scheduler.started,    running: false,                         lastRun: status.scheduler.lastSnapshot ?? null, lastResult: null }               : null;
    default: return null;
  }
}

export async function checkMotorWatchdog(status: EngineStatus): Promise<void> {
  if (!settingGetBool("tg_on_motor_anomaly")) return;
  if (!isConfigured()) return;

  const multiplier = Math.max(1, parseFloat(settingGet("motor_anomaly_multiplier")) || 3);
  const now = Date.now();
  const alerts: string[] = [];

  for (const [key, pollMs] of Object.entries(POLL_MS)) {
    const motor = getMotorData(status, key);
    if (!motor || !motor.started) continue; // motor no iniciat → no es monitoritza

    const label = MOTOR_LABEL[key] ?? key;

    // Error en l'últim resultat
    if (motor.lastResult?.startsWith("error") || motor.lastResult?.startsWith("crash")) {
      const alertKey = `${key}:error`;
      if (canAlert(alertKey)) {
        alerts.push(`⚠️ *${label}*: error en l'últim cicle\n_${motor.lastResult}_`);
        markAlerted(alertKey);
      }
    }

    // Motor aturat (no ha corregut en N × pollMs)
    if (motor.lastRun !== null) {
      const elapsed = now - motor.lastRun;
      const threshold = pollMs * multiplier;
      if (elapsed > threshold) {
        const alertKey = `${key}:timeout`;
        if (canAlert(alertKey)) {
          const mins = Math.round(elapsed / 60_000);
          alerts.push(`🔴 *${label}*: sense activitat fa ${mins} min (esperats ≤${Math.round(threshold / 60_000)} min)`);
          markAlerted(alertKey);
        }
      }
    }
  }

  if (alerts.length === 0) return;

  const lines = [
    "🤖 *Alerta Motors del Sistema*",
    "",
    ...alerts,
    "",
    `_${new Date().toLocaleString("ca-ES")}_`,
  ];
  await sendTelegram(lines.join("\n")).catch(() => { /* silencia errors de xarxa */ });
}
