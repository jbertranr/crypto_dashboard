"use client";
import { useEffect, useRef, useContext, useState, useCallback } from "react";
import { ServerEventsContext } from "../components/ServerEventsProvider";
import {
  ALL_SSE_EVENTS,
  type SSEHandlers,
  type SSEEventType,
} from "../lib/sse-types";

export type { SSEHandlers, SSEEventType };

/**
 * Subscriu el component als events SSE del servidor.
 * Si existeix `ServerEventsProvider`, reutilitza la connexió compartida.
 * En cas contrari, obre una connexió pròpia amb reconnexió exponencial.
 */
export function useServerEvents(
  handlers: SSEHandlers,
  options?: { enabled?: boolean },
): { connected: boolean } {
  const ctx     = useContext(ServerEventsContext);
  const enabled = options?.enabled ?? true;

  // Ref estable per evitar re-subscripcions quan canvien els handlers
  const handlersRef = useRef<SSEHandlers>(handlers);
  handlersRef.current = handlers;

  // ── Path A: context disponible → delegar al provider compartit ──
  useEffect(() => {
    if (!enabled || !ctx) return;
    return ctx.subscribe(handlersRef);
  }, [ctx, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Path B: sense context → connexió pròpia amb reconnexió ──
  const [connected, setConnected] = useState(false);
  const retryRef = useRef(1_000);
  const esRef    = useRef<EventSource | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    const es = new EventSource("/api/stream");
    esRef.current = es;

    es.onopen = () => { setConnected(true); retryRef.current = 1_000; };

    ALL_SSE_EVENTS.forEach(evt => {
      es.addEventListener(evt, (e: MessageEvent) => {
        try {
          handlersRef.current[evt]?.(JSON.parse(e.data));
        } catch { /* malformed */ }
      });
    });

    es.onerror = () => {
      setConnected(false);
      es.close();
      esRef.current = null;
      const delay = retryRef.current;
      retryRef.current = Math.min(retryRef.current * 2, 30_000);
      timerRef.current = setTimeout(connect, delay);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!enabled || ctx) return;
    connect();
    return () => {
      esRef.current?.close();
      esRef.current = null;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, ctx, connect]);

  return { connected: ctx ? ctx.connected : connected };
}
