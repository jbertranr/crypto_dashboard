"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import type { LogEntry } from "../api/logs/route";
import { useServerEvents } from "../hooks/useServerEvents";

/* ── Helpers ── */
const LEVEL_MAP: Record<number, { label: string; cls: string }> = {
  10: { label: "TRACE", cls: "log-level--trace" },
  20: { label: "DEBUG", cls: "log-level--debug" },
  30: { label: "INFO",  cls: "log-level--info"  },
  40: { label: "WARN",  cls: "log-level--warn"  },
  50: { label: "ERROR", cls: "log-level--error" },
  60: { label: "FATAL", cls: "log-level--fatal" },
};

const LEVEL_NUM: Record<string, number> = {
  trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60,
};

const MODULES = [
  "trailing-engine", "order-monitor", "telegram", "api", "analysis", "cache",
];

const MIN_LEVELS = [
  { value: "debug", label: "Debug+"  },
  { value: "info",  label: "Info+"   },
  { value: "warn",  label: "Warn+"   },
  { value: "error", label: "Error+"  },
];

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("ca-ES", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function entryKey(e: LogEntry, i: number): string {
  return `${e.ts}-${i}`;
}

function extraFields(e: LogEntry): Record<string, unknown> {
  const skip = new Set(["level", "time", "ts", "pid", "hostname", "module", "msg", "v"]);
  return Object.fromEntries(Object.entries(e).filter(([k]) => !skip.has(k)));
}

/* ── Component ── */
export default function LogsPanel() {
  const [entries,   setEntries]   = useState<LogEntry[]>([]);
  const [minLevel,  setMinLevel]  = useState("info");
  const [modFilter, setModFilter] = useState("");
  const [live,      setLive]      = useState(true);

  // Refs per accedir als filtres actuals dins els handlers SSE
  const minLevelRef  = useRef(minLevel);
  const modFilterRef = useRef(modFilter);
  const liveRef      = useRef(live);
  minLevelRef.current  = minLevel;
  modFilterRef.current = modFilter;
  liveRef.current      = live;

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ level: minLevel, limit: "300" });
      if (modFilter) params.set("module", modFilter);
      const r = await fetch(`/api/logs?${params}`);
      const d = await r.json() as { entries: LogEntry[] };
      setEntries([...d.entries].reverse());
    } catch { /* silenciat */ }
  }, [minLevel, modFilter]);

  // Càrrega inicial i quan canvien els filtres
  useEffect(() => { load(); }, [load]);

  // Subscripció SSE
  useServerEvents({
    "log:new": (entry: LogEntry) => {
      if (!liveRef.current) return;
      if (!entry.ts && (entry as Record<string, unknown>).time) {
        entry.ts = (entry as Record<string, unknown>).time as number;
      }
      // Filtrar per nivell i mòdul actuals
      if (entry.level < (LEVEL_NUM[minLevelRef.current] ?? 20)) return;
      if (modFilterRef.current && entry.module !== modFilterRef.current) return;
      setEntries(prev => [entry, ...prev].slice(0, 300));
    },
    "snapshot": () => {
      // Recarregar des de REST per aplicar els filtres actuals
      load();
    },
  });

  return (
    <div className="logs-panel">

      {/* Toolbar */}
      <div className="logs-toolbar">
        <div className="logs-toolbar__left">
          {/* Filtre de nivell */}
          <div className="logs-filter-group">
            {MIN_LEVELS.map(l => (
              <button key={l.value}
                className={`logs-filter-btn${minLevel === l.value ? " logs-filter-btn--active" : ""}`}
                onClick={() => setMinLevel(l.value)}>
                {l.label}
              </button>
            ))}
          </div>

          {/* Filtre de mòdul */}
          <select className="logs-module-select"
            value={modFilter} onChange={e => setModFilter(e.target.value)}>
            <option value="">Tots els mòduls</option>
            {MODULES.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        <div className="logs-toolbar__right">
          <label className="logs-toggle">
            <input type="checkbox" checked={live}
              onChange={e => setLive(e.target.checked)} />
            <span>Live</span>
          </label>
          <span className="logs-count">{entries.length} entrades</span>
          <button className="logs-refresh-btn" onClick={load} title="Refresca">
            <i className="fa-solid fa-rotate-right" />
          </button>
        </div>
      </div>

      {/* Llista */}
      <div className="logs-list">
        {entries.length === 0 ? (
          <div className="logs-empty">
            <i className="fa-solid fa-file-lines" />
            <span>Cap entrada de log. El fitxer es crea quan s&apos;executa alguna acció.</span>
          </div>
        ) : (
          entries.map((e, i) => {
            const lv    = LEVEL_MAP[e.level] ?? { label: String(e.level), cls: "" };
            const extra = extraFields(e);
            const hasExtra = Object.keys(extra).length > 0;
            return (
              <div key={entryKey(e, i)} className={`log-row log-row--${lv.cls.replace("log-level--", "")}`}>
                <span className="log-row__time">{fmtTime(e.ts || (e as Record<string,unknown>).time as number)}</span>
                <span className={`log-level ${lv.cls}`}>{lv.label}</span>
                {e.module && <span className="log-module">{e.module}</span>}
                <span className="log-msg">{e.msg}</span>
                {hasExtra && (
                  <details className="log-extra">
                    <summary><i className="fa-solid fa-chevron-right" /></summary>
                    <pre>{JSON.stringify(extra, null, 2)}</pre>
                  </details>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
