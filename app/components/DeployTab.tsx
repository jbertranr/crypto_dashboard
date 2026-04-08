"use client";
import { useEffect, useRef, useState, useCallback } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Pm2App {
  name:   string;
  status: string;
  uptime: number;
  pid:    string | number;
}

interface Release {
  name:   string;
  date:   string;
  commit: string;
}

interface ProdStatus {
  commit?:   string;
  message?:  string;
  date?:     string;
  pm2?:      Pm2App[];
  releases?: Release[];
  error?:    string;
}

type Phase = "idle" | "running" | "success" | "error";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtUptime(ms: number): string {
  if (!ms) return "—";
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s/60)}m ${s%60}s`;
  return `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`;
}

function statusColor(s: string): string {
  if (s === "online")  return "deploy-pm2__status--online";
  if (s === "stopped") return "deploy-pm2__status--stopped";
  return "deploy-pm2__status--other";
}

// Coloritza una línia de log
function colorLine(text: string): React.ReactNode {
  if (!text) return <>&nbsp;</>;
  if (text.startsWith("❌") || text.toLowerCase().includes("error") || text.includes("Error"))
    return <span className="deploy-log__err">{text}</span>;
  if (text.startsWith("⚠") || text.toLowerCase().includes("warn"))
    return <span className="deploy-log__warn">{text}</span>;
  if (text.startsWith("✅") || text.includes("completat") || text.includes("OK"))
    return <span className="deploy-log__ok">{text}</span>;
  if (text.startsWith("──") || text.startsWith("  ──"))
    return <span className="deploy-log__sep">{text}</span>;
  if (text.includes("ℹ"))
    return <span className="deploy-log__info">{text}</span>;
  return <>{text}</>;
}

// ── Component principal ───────────────────────────────────────────────────────

export default function DeployTab() {
  const [status,      setStatus]      = useState<ProdStatus | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [branch,      setBranch]      = useState("master");
  const [phase,       setPhase]       = useState<Phase>("idle");
  const [logLines,    setLogLines]    = useState<string[]>([]);
  const [exitCode,    setExitCode]    = useState<number | null>(null);
  const [confirmDeploy, setConfirmDeploy] = useState(false);
  const [confirmRollback, setConfirmRollback] = useState<Release | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const esRef  = useRef<EventSource | null>(null);

  // ── Carrega estat de producció ───────────────────────────────────────────────

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/deploy");
      const d = await r.json() as ProdStatus;
      setStatus(d);
    } catch {
      setStatus({ error: "No s'ha pogut connectar amb el servidor de producció" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  // Scroll automàtic al final del log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logLines]);

  // ── Llança un job i segueix l'output ─────────────────────────────────────────

  const launchJob = useCallback(async (body: Record<string, string>) => {
    setPhase("running");
    setLogLines([]);
    setExitCode(null);
    setConfirmDeploy(false);
    setConfirmRollback(null);

    let jobId: string;
    try {
      const r = await fetch("/api/deploy", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
      const d = await r.json() as { jobId?: string; error?: string };
      if (!d.jobId) throw new Error(d.error ?? "Error desconegut");
      jobId = d.jobId;
    } catch (err) {
      setLogLines([`❌ ${(err as Error).message}`]);
      setPhase("error");
      return;
    }

    // Obre SSE
    esRef.current?.close();
    const es = new EventSource(`/api/deploy/stream?jobId=${jobId}`);
    esRef.current = es;

    es.addEventListener("line", (e: MessageEvent) => {
      const { text } = JSON.parse(e.data) as { text: string };
      setLogLines(prev => [...prev, text]);
    });

    es.addEventListener("done", (e: MessageEvent) => {
      const { exitCode: code } = JSON.parse(e.data) as { exitCode: number };
      setExitCode(code);
      setPhase(code === 0 ? "success" : "error");
      es.close();
      // Refresca l'estat de producció
      setTimeout(loadStatus, 2000);
    });

    es.onerror = () => {
      setLogLines(prev => [...prev, "❌ Connexió SSE perduda"]);
      setPhase("error");
      es.close();
    };
  }, [loadStatus]);

  const doDeploy   = () => launchJob({ action: "deploy", branch });
  const doRollback = (r: Release) => launchJob({ action: "rollback", release: r.name });

  // ── Render ────────────────────────────────────────────────────────────────────

  const releases = status?.releases ?? [];
  const pm2      = status?.pm2      ?? [];

  return (
    <div className="deploy-tab">

      {/* ── Títol ── */}
      <div className="section-title">
        <i className="fa-solid fa-rocket" /> Desplegament
      </div>

      {/* ── Estat de producció ── */}
      <div className="deploy-status-row">

        {/* Commit */}
        <div className={`deploy-card deploy-card--commit${loading ? " deploy-card--loading" : ""}`}>
          <div className="deploy-card__label">
            <i className="fa-solid fa-code-commit" /> Commit en producció
          </div>
          {loading ? (
            <div className="deploy-card__loading"><i className="fa-solid fa-spinner fa-spin" /></div>
          ) : status?.error ? (
            <div className="deploy-card__error"><i className="fa-solid fa-triangle-exclamation" /> {status.error}</div>
          ) : (
            <>
              <div className="deploy-card__commit">
                <span className="deploy-card__hash">{status?.commit ?? "—"}</span>
                <span className="deploy-card__msg">{status?.message ?? "—"}</span>
              </div>
              <div className="deploy-card__date">{status?.date ? new Date(status.date).toLocaleString("ca-ES") : "—"}</div>
            </>
          )}
        </div>

        {/* PM2 apps */}
        <div className="deploy-card deploy-card--pm2">
          <div className="deploy-card__label">
            <i className="fa-solid fa-server" /> Processos PM2
          </div>
          {loading ? (
            <div className="deploy-card__loading"><i className="fa-solid fa-spinner fa-spin" /></div>
          ) : pm2.length === 0 ? (
            <div className="deploy-pm2__empty">Cap procés</div>
          ) : pm2.map(app => (
            <div key={app.name} className="deploy-pm2__row">
              <span className={`deploy-pm2__status ${statusColor(app.status)}`}>
                <span className="deploy-pm2__dot" />
              </span>
              <span className="deploy-pm2__name">{app.name}</span>
              <span className="deploy-pm2__uptime">{fmtUptime(app.uptime)}</span>
              <span className="deploy-pm2__pid">PID {app.pid}</span>
            </div>
          ))}
        </div>

        {/* Botó refresca */}
        <button className="deploy-refresh-btn" onClick={loadStatus} disabled={loading} title="Refresca estat">
          <i className={`fa-solid fa-rotate-right${loading ? " fa-spin" : ""}`} />
        </button>
      </div>

      {/* ── Acció de desplegament ── */}
      <div className="deploy-actions">

        <div className="deploy-actions__deploy">
          <div className="deploy-actions__title">
            <i className="fa-solid fa-upload" /> Desplegar nova versió
          </div>
          <div className="deploy-actions__row">
            <label className="deploy-actions__label">Branca</label>
            <input
              className="deploy-actions__branch"
              value={branch}
              onChange={e => setBranch(e.target.value)}
              disabled={phase === "running"}
              placeholder="master"
            />
            {!confirmDeploy ? (
              <button
                className="btn btn-primary deploy-actions__btn"
                onClick={() => setConfirmDeploy(true)}
                disabled={phase === "running" || loading || !!status?.error}>
                <i className="fa-solid fa-rocket" /> Desplegar
              </button>
            ) : (
              <div className="deploy-confirm">
                <span className="deploy-confirm__text">
                  <i className="fa-solid fa-triangle-exclamation" /> Desplegar branca <strong>{branch}</strong>?
                </span>
                <button className="btn btn-danger btn-sm" onClick={doDeploy}>
                  <i className="fa-solid fa-check" /> Confirma
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => setConfirmDeploy(false)}>
                  Cancel·la
                </button>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* ── Log terminal ── */}
      {(phase !== "idle" || logLines.length > 0) && (
        <div className="deploy-terminal">
          <div className="deploy-terminal__header">
            <span className="deploy-terminal__title">
              <i className="fa-solid fa-terminal" />
              {phase === "running" && <><i className="fa-solid fa-spinner fa-spin deploy-terminal__spinner" /> Executant…</>}
              {phase === "success" && <><span className="deploy-terminal__ok">✅ Completat (codi 0)</span></>}
              {phase === "error"   && <><span className="deploy-terminal__err">❌ Error (codi {exitCode ?? "?"})</span></>}
            </span>
            <button className="deploy-terminal__clear" onClick={() => { setPhase("idle"); setLogLines([]); }}>
              <i className="fa-solid fa-xmark" />
            </button>
          </div>
          <div className="deploy-terminal__body" ref={logRef}>
            {logLines.map((line, i) => (
              <div key={i} className="deploy-log__line">
                {colorLine(line)}
              </div>
            ))}
            {phase === "running" && (
              <div className="deploy-log__line deploy-log__cursor">▋</div>
            )}
          </div>
        </div>
      )}

      {/* ── Releases per rollback ── */}
      {releases.length > 0 && (
        <div className="deploy-releases">
          <div className="deploy-releases__title">
            <i className="fa-solid fa-clock-rotate-left" /> Versions guardades
            <span className="deploy-releases__hint">({releases.length} disponibles)</span>
          </div>
          <div className="deploy-releases__list">
            {releases.map((rel, i) => (
              <div key={rel.name} className={`deploy-release${i === 0 ? " deploy-release--latest" : ""}`}>
                <div className="deploy-release__info">
                  <span className="deploy-release__date">
                    <i className="fa-solid fa-calendar-days" /> {rel.date}
                  </span>
                  <span className="deploy-release__commit">
                    <i className="fa-solid fa-code-commit" /> {rel.commit}
                  </span>
                  {i === 0 && <span className="deploy-release__badge">última</span>}
                </div>
                <div className="deploy-release__name">{rel.name}</div>
                {confirmRollback?.name === rel.name ? (
                  <div className="deploy-confirm deploy-confirm--inline">
                    <span className="deploy-confirm__text">
                      <i className="fa-solid fa-triangle-exclamation" /> Restaurar aquest build?
                    </span>
                    <button className="btn btn-danger btn-sm" onClick={() => doRollback(rel)}>
                      <i className="fa-solid fa-check" /> Sí, rollback
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setConfirmRollback(null)}>
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    className="btn btn-secondary btn-sm deploy-release__btn"
                    onClick={() => setConfirmRollback(rel)}
                    disabled={phase === "running"}>
                    <i className="fa-solid fa-rotate-left" /> Rollback
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Sense releases ── */}
      {!loading && releases.length === 0 && !status?.error && (
        <div className="deploy-releases">
          <div className="deploy-releases__title">
            <i className="fa-solid fa-clock-rotate-left" /> Versions guardades
          </div>
          <div className="deploy-releases__empty">
            <i className="fa-solid fa-box-open" />
            Cap versió guardada. Desplega per primera vegada per crear el primer backup.
          </div>
        </div>
      )}

    </div>
  );
}
