export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { type NextRequest } from "next/server";
import { eventBus, type AppEvent } from "../../lib/event-bus";
import { getRecentErrors } from "../../lib/error-store";
import { todayFile } from "../../lib/logger";
import { ensureActivityLogger } from "../../lib/activity-logger";

ensureActivityLogger();
import fs from "fs";

declare global {
  var __sseClients: Set<ReadableStreamDefaultController> | undefined;
}

const clients: Set<ReadableStreamDefaultController> =
  (global.__sseClients ??= new Set());

const enc = new TextEncoder();

function sendSSE(
  ctrl: ReadableStreamDefaultController,
  eventName: string,
  data: unknown,
): boolean {
  try {
    ctrl.enqueue(enc.encode(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`));
    return true;
  } catch {
    clients.delete(ctrl);
    return false;
  }
}

function getRecentLogs(limit: number): unknown[] {
  const filePath = todayFile();
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, "utf-8")
    .split("\n").filter(Boolean).slice(-limit);
  const result: unknown[] = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      if ((obj.level as number) >= 30) {
        if (!obj.ts && obj.time) obj.ts = obj.time;
        result.push(obj);
      }
    } catch { /* línia malformada */ }
  }
  return result;
}

const ALL_TYPES: AppEvent["type"][] = [
  "log:new", "error:new", "error:clear",
  "order:fill", "trailing:sl_moved", "trailing:activated", "heartbeat",
];

const MAX_SSE_CLIENTS = 10;

export async function GET(req: NextRequest) {
  // D5: limit concurrent SSE connections to prevent unbounded growth
  if (clients.size >= MAX_SSE_CLIENTS) {
    return new Response("Too many connections", { status: 503 });
  }

  const stream = new ReadableStream({
    start(ctrl) {
      clients.add(ctrl);

      // Snapshot inicial en connectar
      const errors     = getRecentErrors(50);
      const recentLogs = getRecentLogs(50);
      sendSSE(ctrl, "snapshot", { errors, errorCount: errors.length, recentLogs });

      // Listener compartit per tots els tipus d'event
      const onEvent = (event: AppEvent) => {
        const data = "payload" in event
          ? (event as { type: string; payload: unknown }).payload
          : {};
        sendSSE(ctrl, event.type, data);
      };

      ALL_TYPES.forEach(t => eventBus.onEvent(t, onEvent));

      // Neteja quan el client es desconnecta
      req.signal.addEventListener("abort", () => {
        ALL_TYPES.forEach(t => eventBus.offEvent(t, onEvent));
        clients.delete(ctrl);
        try { ctrl.close(); } catch { /* ja tancat */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":      "text/event-stream",
      "Cache-Control":     "no-cache, no-transform",
      "Connection":        "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
