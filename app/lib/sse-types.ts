/**
 * Tipus compartits per SSE (Server-Sent Events)
 * Fitxer separat per evitar dependències circulars entre
 * useServerEvents.ts i ServerEventsProvider.tsx
 */
import type { MutableRefObject } from "react";

export type SSEEventType =
  | "log:new" | "error:new" | "error:clear" | "order:fill"
  | "trailing:sl_moved" | "trailing:activated" | "heartbeat" | "snapshot";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SSEHandlers = Partial<Record<SSEEventType, (payload: any) => void>>;

export interface SSEContextValue {
  connected: boolean;
  subscribe: (handlersRef: MutableRefObject<SSEHandlers>) => () => void;
}

export const ALL_SSE_EVENTS: SSEEventType[] = [
  "log:new", "error:new", "error:clear", "order:fill",
  "trailing:sl_moved", "trailing:activated", "heartbeat", "snapshot",
];
