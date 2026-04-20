"use client";
import { useEffect, useState, useCallback } from "react";
import type { AppError, Severity } from "../lib/error-store";
import { useServerEvents } from "../hooks/useServerEvents";

type Filter = "all" | Severity;

const SEV_LABEL: Record<Severity, string> = {
  warn:     "Avís",
  error:    "Error",
  critical: "Crític",
};

const CODE_LABEL: Record<string, string> = {
  RATE_LIMIT: "Rate Limit",
  AUTH:       "Auth",
  BAD_PARAMS: "Params",
  NOT_FOUND:  "Not Found",
  NETWORK:    "Xarxa",
  INTERNAL:   "Intern",
};

function relTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)       return `fa ${s}s`;
  if (s < 3600)     return `fa ${Math.floor(s / 60)}min`;
  if (s < 86400)    return `fa ${Math.floor(s / 3600)}h`;
  return new Date(ts).toLocaleDateString("ca-ES", { day: "2-digit", month: "short" });
}

export default function ErrorsPanel() {
  const [errors,   setErrors]   = useState<AppError[]>([]);
  const [filter,   setFilter]   = useState<Filter>("all");
  const [clearing, setClearing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/errors");
      const d = await r.json() as { errors: AppError[] };
      setErrors(d.errors);
    } catch { /* silenciat */ }
  }, []);

  // Càrrega inicial
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  // Subscripció SSE — substitueix el setInterval(load, 15_000)
  useServerEvents({
    "error:new": (err: AppError) => {
      setErrors(prev => {
        // Evitar duplicats
        if (prev.some(e => e.id === err.id)) return prev;
        return [err, ...prev];
      });
    },
    "error:clear": () => {
      setErrors([]);
    },
    "snapshot": (payload: { errors: AppError[] }) => {
      if (Array.isArray(payload.errors)) setErrors(payload.errors);
    },
  });

  const handleClear = async () => {
    setClearing(true);
    await fetch("/api/errors", { method: "DELETE" });
    setErrors([]);
    setClearing(false);
  };

  const visible = filter === "all" ? errors : errors.filter(e => e.severity === filter);

  const counts = {
    warn:     errors.filter(e => e.severity === "warn").length,
    error:    errors.filter(e => e.severity === "error").length,
    critical: errors.filter(e => e.severity === "critical").length,
  };

  const lastError = errors[0] ?? null;

  return (
    <div className="err-panel">

      {/* ── 5 KPIs ── */}
      <div className="section-title">
        <i className="fa-solid fa-triangle-exclamation" /> Errors del sistema
      </div>
      <div className="portfolio__cards">
        <div className={`portfolio__card portfolio__card--${errors.length > 0 ? "red" : "green"}`}>
          <span className="portfolio__card-label"><i className="fa-solid fa-list" /> Total errors</span>
          <span className="portfolio__card-value portfolio__card-value--count">{errors.length}</span>
          <span className="portfolio__card-sub">errors en memòria</span>
        </div>
        <div className={`portfolio__card portfolio__card--${counts.critical > 0 ? "red" : "neutral"}`}>
          <span className="portfolio__card-label"><i className="fa-solid fa-skull" /> Crítics</span>
          <span className="portfolio__card-value portfolio__card-value--count">{counts.critical}</span>
          <span className="portfolio__card-sub">requereixen acció immediata</span>
        </div>
        <div className={`portfolio__card portfolio__card--${counts.error > 0 ? "red" : "neutral"}`}>
          <span className="portfolio__card-label"><i className="fa-solid fa-circle-exclamation" /> Errors</span>
          <span className="portfolio__card-value portfolio__card-value--count">{counts.error}</span>
          <span className="portfolio__card-sub">errors no crítics</span>
        </div>
        <div className={`portfolio__card portfolio__card--${counts.warn > 0 ? "neutral" : "neutral"}`}>
          <span className="portfolio__card-label"><i className="fa-solid fa-triangle-exclamation" /> Avisos</span>
          <span className="portfolio__card-value portfolio__card-value--count">{counts.warn}</span>
          <span className="portfolio__card-sub">warnings del sistema</span>
        </div>
        <div className="portfolio__card portfolio__card--neutral">
          <span className="portfolio__card-label"><i className="fa-solid fa-clock" /> Últim error</span>
          <span className="portfolio__card-value" style={{ fontSize: "0.85rem" }}>
            {lastError ? relTime(lastError.ts) : "—"}
          </span>
          <span className="portfolio__card-sub">
            {lastError ? (lastError.message.slice(0, 28) + (lastError.message.length > 28 ? "…" : "")) : "cap error registrat"}
          </span>
        </div>
      </div>

      {/* Capçalera */}
      <div className="err-panel__header">
        <div className="err-panel__filters">
          <button
            className={`err-filter${filter === "all" ? " err-filter--active" : ""}`}
            onClick={() => setFilter("all")}>
            Tots <span className="err-filter__count">{errors.length}</span>
          </button>
          {(["warn", "error", "critical"] as Severity[]).map(sev => (
            <button key={sev}
              className={`err-filter err-filter--${sev}${filter === sev ? " err-filter--active" : ""}`}
              onClick={() => setFilter(sev)}>
              {SEV_LABEL[sev]}
              {counts[sev] > 0 && <span className="err-filter__count">{counts[sev]}</span>}
            </button>
          ))}
        </div>

        <button className="err-clear-btn" onClick={handleClear} disabled={clearing || errors.length === 0}>
          <i className="fa-solid fa-trash-can" /> Esborra tots
        </button>
      </div>

      {/* Llista */}
      {visible.length === 0 ? (
        <div className="err-empty">
          <i className="fa-solid fa-circle-check" />
          <span>Cap error registrat</span>
        </div>
      ) : (
        <div className="err-list">
          {visible.map(err => (
            <div key={err.id} className={`err-row err-row--${err.severity}`}>
              <div className={`err-row__sev err-row__sev--${err.severity}`} />
              <div className="err-row__body">
                <div className="err-row__top">
                  <span className={`err-badge err-badge--sev err-badge--${err.severity}`}>
                    {SEV_LABEL[err.severity]}
                  </span>
                  <span className="err-badge err-badge--code">
                    {CODE_LABEL[err.code] ?? err.code}
                  </span>
                  <span className="err-badge err-badge--source">{err.source}</span>
                  <span className="err-row__time">{relTime(err.ts)}</span>
                </div>
                <div className="err-row__msg">{err.message}</div>
                {err.context && Object.keys(err.context).length > 0 && (
                  <details className="err-row__ctx">
                    <summary>Context</summary>
                    <pre>{JSON.stringify(err.context, null, 2)}</pre>
                  </details>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
