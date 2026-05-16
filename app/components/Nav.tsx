"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Tab } from "./OrdersPanel";
import { useServerEvents } from "../hooks/useServerEvents";
import { useTradingMode } from "../contexts/TradingModeContext";
import type { AppError } from "../lib/error-store";

type NavMode = "paper" | "real";

// Tabs que existeixen en variant paper i real
const MODE_PAIRS: Record<string, { paper: Tab; real: Tab }> = {
  portfolio: { paper: "portfolio",  real: "portfolio-real" },
  balance:   { paper: "balance",    real: "balance-real"   },
  open:      { paper: "open",       real: "open-real"      },
  history:   { paper: "history",    real: "history-real"   },
  journal:   { paper: "journal",    real: "journal-real"   },
  bot:       { paper: "bot",        real: "bot-real"       },
};

// Donat un tab actiu, retorna la clau base (sense -real)
function baseKey(tab: Tab): string {
  return tab.endsWith("-real") ? tab.slice(0, -5) : tab;
}

// Retorna el tab equivalent per al mode donat
function tabForMode(tab: Tab, mode: NavMode): Tab {
  const base = baseKey(tab);
  const pair = MODE_PAIRS[base];
  if (!pair) return tab; // tab comú, no canvia
  return mode === "real" ? pair.real : pair.paper;
}

type NavItem = { key: string; label: string; icon: string; modeDependent?: boolean };

const CARTERA: NavItem[] = [
  { key: "portfolio", label: "Portfolio", icon: "fa-wallet", modeDependent: true },
  { key: "balance",   label: "Balance",   icon: "fa-coins",  modeDependent: true },
  { key: "convert",   label: "Convertir", icon: "fa-arrow-right-arrow-left" },
];
const ORDRES: NavItem[] = [
  { key: "open",    label: "Ordres",    icon: "fa-list-check",        modeDependent: true },
  { key: "history", label: "Historial", icon: "fa-clock-rotate-left", modeDependent: true },
  { key: "journal", label: "Diari",     icon: "fa-book-open",         modeDependent: true },
];
const ANALISI: NavItem[] = [
  { key: "analysis", label: "Anàlisi", icon: "fa-magnifying-glass-chart" },
  { key: "matrix",   label: "Escàner", icon: "fa-table-cells"            },
];
const AUTOMATITZACIO: NavItem[] = [
  { key: "simulation", label: "Simulació",    icon: "fa-flask-vial"          },
  { key: "equalizer",  label: "Equalitzador", icon: "fa-sliders"             },
  { key: "autolab",    label: "AutoLab",      icon: "fa-wand-magic-sparkles" },
  { key: "bot",        label: "Bot",          icon: "fa-robot", modeDependent: true },
  { key: "deploy",     label: "Deploy",       icon: "fa-rocket"              },
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
  const { realConfigured, realLocked, setRealLocked } = useTradingMode();

  // Mode actiu del toggle de nav
  const [navMode, setNavMode] = useState<NavMode>(() =>
    tab.endsWith("-real") ? "real" : "paper"
  );

  const [errorCount, setErrorCount] = useState(0);
  const [collapsed,  setCollapsed]  = useState(false);
  const [darkMode,   setDarkMode]   = useState(false);
  const [lastSeen]                  = useState(() => {
    if (typeof localStorage === "undefined") return 0;
    return parseInt(localStorage.getItem("errLastSeen") ?? "0", 10);
  });

  // Sincronitzar navMode quan la tab canvia externament.
  // Tabs comunes (sense sufix de mode) no canvien el mode actiu.
  useEffect(() => {
    if (tab.endsWith("-real")) setNavMode("real"); // eslint-disable-line react-hooks/set-state-in-effect
    else if (Object.values(MODE_PAIRS).some(p => p.paper === tab)) setNavMode("paper"); // eslint-disable-line react-hooks/set-state-in-effect
    // else: tab comuna — manté el navMode actual
  }, [tab]);

  useEffect(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "dark") {
      setDarkMode(true);
      document.documentElement.setAttribute("data-theme", "dark");
    }
  }, []);

  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    if (next) {
      document.documentElement.setAttribute("data-theme", "dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
      localStorage.setItem("theme", "light");
    }
  };

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

  useServerEvents({
    "error:new": (_err: AppError) => { setErrorCount(prev => prev + 1); },
    "error:clear": () => { setErrorCount(0); },
  });

  const handleErrorsTab = () => {
    onTab("errors");
    localStorage.setItem("errLastSeen", String(Date.now()));
    setErrorCount(0);
  };

  const handleModeToggle = (m: NavMode) => {
    if (m === "real" && !realConfigured) return;
    if (m === navMode) return; // ja estem en aquest mode
    setNavMode(m);
    // Sempre va al portfolio del nou mode per recarregar tot
    onTab(m === "real" ? "portfolio-real" : "portfolio");
  };

  const c = collapsed;
  const isReal = navMode === "real";

  return (
    <nav className={`nav${c ? " nav--collapsed" : ""}${isReal ? " nav--real" : ""}`}>

      <button className="nav__collapse-btn" onClick={() => setCollapsed(v => !v)}
        title={c ? "Expandir menú" : "Col·lapsar menú"}>
        <i className="fa-solid fa-bars" />
        {!c && <span className="nav__collapse-label">Menú</span>}
      </button>

      {/* ── Toggle PAPER / REAL ── */}
      <div className={`nav__mode-toggle${c ? " nav__mode-toggle--collapsed" : ""}`}
           title={c ? (isReal ? "Mode REAL" : "Mode PAPER") : undefined}>
        <button
          className={`nav__mode-btn${!isReal ? " nav__mode-btn--active" : ""}`}
          onClick={() => handleModeToggle("paper")}
        >
          {c ? "P" : "PAPER"}
        </button>
        <button
          className={`nav__mode-btn nav__mode-btn--real${isReal ? " nav__mode-btn--active" : ""}${!realConfigured ? " nav__mode-btn--locked" : ""}`}
          onClick={() => handleModeToggle("real")}
          title={!realConfigured ? "Claus de trading real no configurades" : undefined}
        >
          {c ? "R" : "REAL"}
        </button>
      </div>

      {/* ── Lock: Sols consultes (mode real) ── */}
      <div
        className={`nav__lock-wrap${c ? " nav__lock-wrap--collapsed" : ""}`}
        title={c ? (realLocked ? "Real bloquejat (sols consultes)" : "Real desblocat (operativa activa)") : undefined}
      >
        {!c && <span className="nav__lock-label">
          <i className={`fa-solid ${realLocked ? "fa-lock" : "fa-lock-open"} nav__lock-icon${!realLocked ? " nav__lock-icon--open" : ""}`} />
          Sols consultes
        </span>}
        {c && <i className={`fa-solid ${realLocked ? "fa-lock" : "fa-lock-open"} nav__lock-icon-solo${!realLocked ? " nav__lock-icon--open" : ""}`} />}
        <label className="nav__switch" title={realLocked ? "Clic per desblocar operativa real" : "Clic per bloquejar operativa real"}>
          <input
            type="checkbox"
            checked={realLocked}
            onChange={e => {
              if (!e.target.checked) {
                const ok = confirm(
                  "⚠️  DESBLOCAR OPERATIVA REAL\n\n" +
                  "Podràs col·locar i cancel·lar ordres reals.\n" +
                  "Continuar?"
                );
                if (!ok) return;
              }
              setRealLocked(e.target.checked);
            }}
          />
          <span className="nav__switch-track" />
        </label>
      </div>

      {GROUPS.map(({ label, tabs }, gi) => (
        <div key={label}>
          {gi > 0 && c && <div className="nav__section-divider" />}
          {!c && <span className="nav__section-label">{label}</span>}
          {tabs.map(({ key, label: lbl, icon, modeDependent }) => {
            const resolvedKey: Tab = modeDependent
              ? (MODE_PAIRS[key]?.[navMode] ?? key as Tab)
              : key as Tab;
            const isActive = tab === resolvedKey;
            return (
              <button
                key={key}
                onClick={() => onTab(resolvedKey)}
                title={c ? lbl : undefined}
                className={`nav__item${isActive ? " nav__item--active" : ""}`}
              >
                <i className={`fa-solid ${icon} nav__item-icon`} />
                {!c && lbl}
                {resolvedKey === "open" && (openOrdersCount ?? 0) > 0 && (
                  <span className={`nav__badge${c ? " nav__badge--dot" : ""}`}>
                    {c ? "" : openOrdersCount}
                  </span>
                )}
              </button>
            );
          })}
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

      <button
        className="nav__item nav__theme-toggle"
        onClick={toggleDarkMode}
        title={c ? (darkMode ? "Mode clar" : "Mode fosc") : undefined}
      >
        <i className={`fa-solid ${darkMode ? "fa-sun" : "fa-moon"} nav__item-icon`} />
        {!c && (darkMode ? "Mode clar" : "Mode fosc")}
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
    </nav>
  );
}
