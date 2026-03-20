/**
 * Event Bus global — SSE push servidor → client
 * Singleton via global per sobreviure hot-reloads de Next.js
 */
import { EventEmitter } from "events";
import type { AppError } from "./error-store";

export interface LogEntry {
  ts:      number;
  level:   number;
  module?: string;
  msg:     string;
  [key: string]: unknown;
}

export type AppEvent =
  | { type: "log:new";            payload: LogEntry }
  | { type: "error:new";          payload: AppError }
  | { type: "error:clear" }
  | { type: "order:fill";         payload: { symbol: string; side: string; orderId: number; execPrice: number } }
  | { type: "trailing:sl_moved";  payload: { symbol: string; newSl: number } }
  | { type: "trailing:activated"; payload: { symbol: string } }
  | { type: "heartbeat" };

class AppEventBus extends EventEmitter {
  emitEvent(event: AppEvent): void {
    super.emit(event.type, event);
  }
  onEvent(type: AppEvent["type"], listener: (event: AppEvent) => void): this {
    return super.on(type, listener as never);
  }
  offEvent(type: AppEvent["type"], listener: (event: AppEvent) => void): this {
    return super.off(type, listener as never);
  }
}

declare global {
  var __appEventBus:    AppEventBus    | undefined;
  var __sseHeartbeatId: NodeJS.Timeout | undefined;
}

export const eventBus: AppEventBus = (global.__appEventBus ??= new AppEventBus());
eventBus.setMaxListeners(100);

// Heartbeat global cada 25s (un únic interval per procés)
if (!global.__sseHeartbeatId) {
  global.__sseHeartbeatId = setInterval(() => {
    eventBus.emitEvent({ type: "heartbeat" });
  }, 25_000);
}
