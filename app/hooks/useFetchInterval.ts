"use client";
import { useEffect, useRef } from "react";

/**
 * Fetches `url` immediately and then every `interval` ms.
 * Calls `onData` with the parsed JSON response.
 * Uses a stable ref for `onData` so callers don't need to memoize it.
 * Set `enabled = false` to pause fetching (e.g. while another tab is active).
 */
export function useFetchInterval<T>(
  url: string,
  interval: number,
  onData: (data: T) => void,
  enabled = true,
): void {
  const onDataRef = useRef(onData);
  onDataRef.current = onData; // eslint-disable-line react-hooks/refs

  useEffect(() => {
    if (!enabled) return;

    const load = () =>
      fetch(url)
        .then(r => r.json())
        .then((d: T) => onDataRef.current(d))
        .catch(err => console.warn(`[useFetchInterval] ${url}:`, (err as Error).message));

    load();
    const id = setInterval(load, interval);
    return () => clearInterval(id);
  }, [url, interval, enabled]);
}
