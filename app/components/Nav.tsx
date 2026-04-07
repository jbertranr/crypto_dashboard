"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Tab } from "./OrdersPanel";
import { useServerEvents } from "../hooks/useServerEvents";
import type { AppError } from "../lib/error-store";

type NavItem = { key: Tab; label: string; icon: string };

const CARTERA: NavItem[] = [
  { key: "portfolio", label: "Portfolio", icon: "fa-wallet"            },
  { key: "balance",   label: "Balance",   icon: "fa-coins"             },
];
const ORDRES: NavItem[] = [
  { key: "open",    label: "Ordres obertes", icon: "fa-list-check"       },
  { key: "history", label: "Historial",      icon: "fa-clock-rotate-left"},
];
const ANALISI: NavItem[] = [
  { key: "analysis", label: "Anàlisi",  icon: "fa-magnifying-glass-chart" },
  { key: "matrix",   label: "Escàner",  icon: "fa-table-cells"            },
  { key: "journal",  label: "Diari",    icon: "fa-book-open"              },
];
const AUTOMATITZACIO: NavItem[] = [
  { key: "simulation", label: "Simulació",    icon: "fa-flask-vial"          },
  { key: "equalizer",  label: "Equalitzador", icon: "fa-sliders"             },
  { key: "autolab",    label: "AutoLab",      icon: "fa-wand-magic-sparkles" },
  { key: "bot",        label: "Bot",          icon: "fa-robot"               },
];

const GROUPS: { label: string; tabs: NavItem[] }[] = [
  { label: "Cartera",        tabs: CARTERA        },
  { label: "Ordres",         tabs: ORDRES         },
  { label: "Anàlisi",        tabs: ANALISI        },
  { label: "Automatització", tabs: AUTOMATITZACIO },
];

export default function Nav({ tab, onTab, openOrdersCount, username }: {
  tab: Tab; onTab: (t: Tab) => void; openOrdersCount?: number; username?: string;
}) {
  const router = useRouter();
  const [errorCount, setErrorCount] = useState(0);
  const [collapsed,  setCollapsed]  = useState(false);
  const [lastSeen]                  = useState(() => {
    if (typeof localStorage === "undefined") return 0;
    return parseInt(localStorage.getItem("errLastSeen") ?? "0", 10);
  });

  // Càrrega inicial del comptador d'errors no vistos
  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch(`/api/errors?since=${lastSeen}`);
        const d = await r.json() as { unseen: number };
        setErrorCount(d.unseen);
      } catch { /* silenciat */ }
    };
    load();
  }, [lastSeen]);

  // Subscripció SSE — substitueix el setInterval(load, 30_000)
  useServerEvents({
    "error:new": (_err: AppError) => {
      setErrorCount(prev => prev + 1);
    },
    "error:clear": () => {
      setErrorCount(0);
    },
  });

  const handleErrorsTab = () => {
    onTab("errors");
    localStorage.setItem("errLastSeen", String(Date.now()));
    setErrorCount(0);
  };

  const c = collapsed;

  return (
    <nav className={`nav${c ? " nav--collapsed" : ""}`}>

      <button className="nav__collapse-btn" onClick={() => setCollapsed(v => !v)}
        title={c ? "Expandir" : "Col·lapsar"}>
        <i className="fa-solid fa-bars" />
      </button>

      {GROUPS.map(({ label, tabs }, gi) => (
        <div key={label}>
          {gi > 0 && c && <div className="nav__section-divider" />}
          {!c && <span className="nav__section-label">{label}</span>}
          {tabs.map(({ key, label: lbl, icon }) => (
            <button key={key} onClick={() => onTab(key)} title={c ? lbl : undefined}
              className={`nav__item${tab === key ? " nav__item--active" : ""}`}>
              <i className={`fa-solid ${icon} nav__item-icon`} />
              {!c && lbl}
              {key === "open" && (openOrdersCount ?? 0) > 0 && (
                <span className={`nav__badge${c ? " nav__badge--dot" : ""}`}>
                  {c ? "" : openOrdersCount}
                </span>
              )}
            </button>
          ))}
        </div>
      ))}

      <div className="nav__spacer" />

      {!c && <span className="nav__section-label">Sistema</span>}
      {c && <div className="nav__section-divider" />}
      <button onClick={() => onTab("status")} title={c ? "Motors" : undefined}
        className={`nav__item${tab === "status" ? " nav__item--active" : ""}`}>
        <i className="fa-solid fa-gear nav__item-icon" />
        {!c && "Motors"}
      </button>

      <button onClick={handleErrorsTab} title={c ? "Errors" : undefined}
        className={`nav__item${tab === "errors" ? " nav__item--active" : ""}${errorCount > 0 ? " nav__item--alert" : ""}`}>
        <i className="fa-solid fa-triangle-exclamation nav__item-icon" />
        {!c && "Errors"}
        {errorCount > 0 && (
          <span className={`nav__badge nav__badge--err${c ? " nav__badge--dot" : ""}`}>{c ? "" : errorCount > 99 ? "99+" : errorCount}</span>
        )}
      </button>

      <button onClick={() => onTab("logs")} title={c ? "Logs" : undefined}
        className={`nav__item${tab === "logs" ? " nav__item--active" : ""}`}>
        <i className="fa-solid fa-terminal nav__item-icon" />
        {!c && "Logs"}
      </button>

      <button onClick={() => onTab("settings")} title={c ? "Configuració" : undefined}
        className={`nav__item${tab === "settings" ? " nav__item--active" : ""}`}>
        <i className="fa-solid fa-gear nav__item-icon" />
        {!c && "Configuració"}
      </button>

      <button className="nav__logout" title={c ? "Tancar sessió" : undefined}
        onClick={async () => {
          await fetch("/api/auth/logout", { method: "POST" });
          router.push("/login");
        }}>
        <i className="fa-solid fa-right-from-bracket nav__item-icon" />
        {!c && "Tancar sessió"}
      </button>

      {!c && username && (
        <div className="nav__user">
          <i className="fa-solid fa-circle-user nav__user-icon" />
          <span className="nav__user-name">{username}</span>
        </div>
      )}
      {!c && (
        <div className="nav__live">
          <div className="nav__live-dot" />
          <div>
            <div className="nav__live-text">Binance Demo</div>
            <div className="nav__live-sub">Connected · Live data</div>
          </div>
        </div>
      )}
    </nav>
  );
}
