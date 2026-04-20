"use client";
import {
  createContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type MutableRefObject,
  type ReactNode,
} from "react";
import {
  ALL_SSE_EVENTS,
  type SSEHandlers,
  type SSEContextValue,
} from "../lib/sse-types";

export const ServerEventsContext = createContext<SSEContextValue | null>(null);

/**
 * Manté UNA sola connexió EventSource per a tota l'app.
 * Els components fills usen `useServerEvents` per subscriure's als events.
 */
export default function ServerEventsProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const subscribersRef = useRef<Set<MutableRefObject<SSEHandlers>>>(new Set());
  const esRef          = useRef<EventSource | null>(null);
  const retryRef       = useRef(1_000);
  const timerRef       = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    const es = new EventSource("/api/stream");
    esRef.current = es;

    es.onopen = () => { setConnected(true); retryRef.current = 1_000; };

    ALL_SSE_EVENTS.forEach(evt => {
      es.addEventListener(evt, (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data);
          subscribersRef.current.forEach(ref => ref.current[evt]?.(payload));
        } catch { /* malformed */ }
      });
    });

    es.onerror = () => {
      setConnected(false);
      es.close();
      esRef.current = null;
      const delay = retryRef.current;
      retryRef.current = Math.min(retryRef.current * 2, 30_000);
      timerRef.current = setTimeout(connect, delay); // eslint-disable-line react-hooks/immutability
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      esRef.current?.close();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [connect]);

  const subscribe = useCallback(
    (handlersRef: MutableRefObject<SSEHandlers>): (() => void) => {
      subscribersRef.current.add(handlersRef);
      return () => { subscribersRef.current.delete(handlersRef); };
    },
    [],
  );

  return (
    <ServerEventsContext.Provider value={{ connected, subscribe }}>
      {children}
    </ServerEventsContext.Provider>
  );
}
