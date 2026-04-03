"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useServerEvents } from "../hooks/useServerEvents";
import { useFetchInterval }  from "../hooks/useFetchInterval";
import type { EngineStatus } from "../api/status/route";

// ── Types ──────────────────────────────────────────────────────────────────────
type MotorKey = "trailing" | "monitor" | "autotrader" | "crash" | "scheduler" | "system";

type FeedKind = "fill" | "trailing" | "bot_buy" | "bot_scan" | "warn" | "error" | "system" | "data" | "scheduler";

interface FeedItem {
  id:      string;
  ts:      number;
  kind:    FeedKind;
  motor:   MotorKey;
  badge:   string;
  icon:    string;
  qtype:   string;
  msg:     string;
  detail?: string;
}

// ── Motor definitions ──────────────────────────────────────────────────────────
const MOTORS: { key: MotorKey; label: string; icon: string; mods: string[] }[] = [
  { key: "trailing",   label: "Trailing Engine", icon: "fa-shield-halved",        mods: ["trailing", "trailing-engine"] },
  { key: "monitor",    label: "Order Monitor",   icon: "fa-magnifying-glass",     mods: ["monitor",  "order-monitor"]   },
  { key: "autotrader", label: "Auto-Trader",     icon: "fa-robot",                mods: ["auto-trader", "auto"]         },
  { key: "crash",      label: "Crash Monitor",   icon: "fa-triangle-exclamation", mods: ["crash",    "crash-monitor"]   },
  { key: "scheduler",  label: "Scheduler",       icon: "fa-clock",                mods: ["telegram", "scheduler"]       },
  { key: "system",     label: "Sistema",         icon: "fa-server",               mods: []                              },
];

function modToMotor(mod: string, msg = ""): MotorKey {
  for (const m of MOTORS) {
    if (m.mods.some(s => mod.includes(s))) return m.key;
  }
  if (mod === "binance" || mod === "orders") {
    if (/trades|order.hist|open.order|fill|execut/i.test(msg))  return "monitor";
    if (/scanner|klines|candle|score|buy.signal/i.test(msg))    return "autotrader";
    if (/btc.*price|crash|drop/i.test(msg))                     return "crash";
    if (/balance|budget/i.test(msg))                            return "autotrader";
  }
  return "system";
}

// ── Helpers ────────────────────────────────────────────────────────────────────
let _feedCounter = 0;
function makeFeedId() { return `f-${Date.now()}-${_feedCounter++}`; }

function timeAgo(ts: number | null, now: number): string {
  if (!ts) return "mai";
  const s = Math.floor((now - ts) / 1000);
  if (s < 5)  return "ara mateix";
  if (s < 60) return `fa ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `fa ${m}min`;
  const h = Math.floor(m / 60);
  return `fa ${h}h`;
}

function nextIn(lastRun: number | null, pollMs: number, now: number): string {
  if (!lastRun) return "—";
  const diff = (lastRun + pollMs) - now;
  if (diff <= 0) return "pendent";
  const s = Math.ceil(diff / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.ceil(s / 60)}min`;
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("ca-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

type EngineState = "ok" | "running" | "error" | "offline";
function engineState(d: { started: boolean; running?: boolean; lastResult: string | null } | undefined): EngineState {
  if (!d || !d.started) return "offline";
  if (d.running)        return "running";
  if (d.lastResult?.startsWith("error") || d.lastResult?.startsWith("crash")) return "error";
  return "ok";
}

const STATE_LABEL: Record<EngineState, string> = {
  ok: "OK", running: "Executant", error: "Error", offline: "Offline",
};

const BADGE_COLORS: Record<FeedKind, string> = {
  fill:      "activity-feed__badge--green",
  trailing:  "activity-feed__badge--indigo",
  bot_buy:   "activity-feed__badge--green",
  bot_scan:  "activity-feed__badge--blue",
  warn:      "activity-feed__badge--amber",
  error:     "activity-feed__badge--red",
  system:    "activity-feed__badge--grey",
  data:      "activity-feed__badge--grey",
  scheduler: "activity-feed__badge--grey",
};

function classifyLog(mod: string, msg: string, level: number): Pick<FeedItem, "kind" | "badge" | "icon" | "motor"> {
  if (level >= 50) return { motor: modToMotor(mod, msg), kind: "error",    badge: "ERR",   icon: "fa-circle-exclamation" };
  if (level >= 40) return { motor: modToMotor(mod, msg), kind: "warn",     badge: "WARN",  icon: "fa-triangle-exclamation" };
  const motor = modToMotor(mod, msg);
  if (motor === "autotrader") {
    const isBuy = /compra|buy|executat|order/i.test(msg);
    return { motor, kind: isBuy ? "bot_buy" : "bot_scan", badge: "BOT", icon: isBuy ? "fa-cart-shopping" : "fa-magnifying-glass" };
  }
  if (motor === "trailing")   return { motor, kind: "trailing",  badge: "TRAIL", icon: "fa-shield-halved" };
  if (motor === "monitor")    return { motor, kind: "system",    badge: "MON",   icon: "fa-eye" };
  if (motor === "crash")      return { motor, kind: "warn",      badge: "CRASH", icon: "fa-triangle-exclamation" };
  if (motor === "scheduler")  return { motor, kind: "scheduler", badge: "SCHED", icon: "fa-clock" };
  return { motor: "system", kind: "data", badge: "SYS", icon: "fa-gear" };
}

// ── qtype classification (mirrors activity-logger.ts) ─────────────────────────
const TRAILING_QTYPES: [RegExp, string][] = [
  [/activ/i,                             "Activa trailing"],
  [/cancel/i,                            "Cancel·la ordre SL"],
  [/col·loc|place|new.*order|sl.*order/i,"Col·loca ordre SL"],
  [/mov|updat.*sl|sl.*updat/i,           "Actualitza SL"],
  [/consult|fetch|check|get.*order/i,    "Consulta ordre SL"],
  [/cicle|tick|poll|loop|scan/i,         "Cicle trailing"],
  [/pic|peak/i,                          "Nou pic detectat"],
  [/error|fail/i,                        "Error Binance"],
];
const MONITOR_QTYPES: [RegExp, string][] = [
  [/fill|execut|complet/i,               "Execució detectada"],
  [/journal/i,                           "Escriu journal"],
  [/cancel/i,                            "Cancel·la ordre"],
  [/consult|fetch|open.*order|get.*order/i,"Consulta ordres obertes"],
  [/poll|cicle|tick/i,                   "Cicle monitor"],
];
const AUTOTRADER_QTYPES: [RegExp, string][] = [
  [/compra|buy.*exec|market.*buy/i,      "Executa compra"],
  [/oco|place.*oco/i,                    "Col·loca OCO"],
  [/klines|veles|candle/i,               "Obté veles"],
  [/anàlisi|analiz|score|scan/i,         "Escaneig símbol"],
  [/bot.*activ|start.*bot/i,             "Bot activat"],
  [/cicle|poll|tick/i,                   "Cicle auto-trader"],
  [/limit|budget|pressupost/i,           "Comprova pressupost"],
];
const CRASH_QTYPES: [RegExp, string][] = [
  [/crash|alerta|alert|trigger/i,        "Alerta crash BTC"],
  [/cancel/i,                            "Cancel·la ordres"],
  [/preu|price|btc/i,                    "Consulta preu BTC"],
  [/cicle|poll|tick/i,                   "Cicle crash monitor"],
];
const SCHEDULER_QTYPES: [RegExp, string][] = [
  [/diari|daily|7.30|7:30/i,             "Informe diari"],
  [/horar|hourly|hora/i,                 "Informe horari"],
  [/snapshot|portfolio/i,                "Snapshot portfolio"],
  [/telegram|missatge|send/i,            "Envia Telegram"],
];

function matchQtype(patterns: [RegExp, string][], msg: string): string | null {
  for (const [re, label] of patterns) { if (re.test(msg)) return label; }
  return null;
}

function qtypeFromLog(motor: MotorKey, msg: string, level: number): string {
  if (level >= 50) return "Error sistema";
  if (level >= 40) return "Advertència";
  switch (motor) {
    case "trailing":   return matchQtype(TRAILING_QTYPES,   msg) ?? "Cicle trailing";
    case "monitor":    return matchQtype(MONITOR_QTYPES,    msg) ?? "Cicle monitor";
    case "autotrader": return matchQtype(AUTOTRADER_QTYPES, msg) ?? "Cicle auto-trader";
    case "crash":      return matchQtype(CRASH_QTYPES,      msg) ?? "Cicle crash monitor";
    case "scheduler":  return matchQtype(SCHEDULER_QTYPES,  msg) ?? "Tasca planificada";
    default:           return "Operació sistema";
  }
}

const FEED_MAX  = 300;
const MOTOR_MAX = 40;

// ── Main component ─────────────────────────────────────────────────────────────
export default function StatusTab() {
  const [status,  setStatus]  = useState<EngineStatus | null>(null);
  const [feed,    setFeed]    = useState<FeedItem[]>([]);
  const [loaded,  setLoaded]  = useState(false);
  const [now,     setNow]     = useState(Date.now());
  const heartbeatRef          = useRef<number>(0);
  const lastRunRef            = useRef<Record<string, number | null>>({});

  // Clock — tick every second
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  // Poll engine status every 15s
  useFetchInterval<EngineStatus>("/api/status", 15_000, setStatus);

  // Genera events sintètics de cicle quan el lastRun canvia (motors sense log propi)
  const CYCLE_DEFS: { key: MotorKey; getLastRun: (s: EngineStatus) => number | null;
    badge: string; icon: string; kind: FeedKind; qtype: string }[] = [
    { key: "trailing",   getLastRun: s => s.trailing?.lastRun   ?? null, badge: "TRAIL", icon: "fa-shield-halved",        kind: "trailing",  qtype: "Cicle trailing"      },
    { key: "monitor",    getLastRun: s => s.orderMonitor?.lastRun ?? null, badge: "MON",  icon: "fa-eye",                  kind: "system",    qtype: "Cicle monitor"       },
    { key: "crash",      getLastRun: s => s.crashMonitor?.lastRun ?? null, badge: "CRASH",icon: "fa-triangle-exclamation", kind: "warn",      qtype: "Cicle crash monitor" },
  ];
  useEffect(() => {
    if (!status) return;
    for (const def of CYCLE_DEFS) {
      const lr = def.getLastRun(status);
      if (lr && lr !== lastRunRef.current[def.key]) {
        lastRunRef.current[def.key] = lr;
        push({ ts: lr, motor: def.key, kind: def.kind, badge: def.badge,
          icon: def.icon, qtype: def.qtype, msg: def.qtype });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Load persisted feed from DB on mount
  useEffect(() => {
    fetch("/api/activity")
      .then(r => r.json())
      .then((rows: { id: number; ts: number; motor: string; kind: string; badge: string; icon: string; qtype: string; msg: string; detail?: string | null }[]) => {
        const items: FeedItem[] = rows.map(r => ({
          id:     `db-${r.id}`,
          ts:     r.ts,
          motor:  r.motor as MotorKey,
          kind:   r.kind as FeedKind,
          badge:  r.badge,
          icon:   r.icon,
          qtype:  r.qtype ?? "",
          msg:    r.msg,
          detail: r.detail ?? undefined,
        }));
        setFeed(items);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  // Prepend a feed item (capped at FEED_MAX)
  const push = useCallback((item: Omit<FeedItem, "id">) => {
    setFeed(prev => [{ ...item, id: makeFeedId() }, ...prev].slice(0, FEED_MAX));
  }, []);

  // SSE handlers
  const { connected } = useServerEvents({
    heartbeat: () => { heartbeatRef.current = Date.now(); },

    "order:fill": (p: { symbol: string; side: string; execPrice: number }) => {
      push({ ts: Date.now(), motor: "monitor", kind: "fill", badge: "FILL",
        icon: "fa-arrow-right-arrow-left", qtype: "Execució detectada",
        msg: `${p.side} ${p.symbol} @ ${p.execPrice}` });
    },
    "trailing:activated": (p: { symbol: string }) => {
      push({ ts: Date.now(), motor: "trailing", kind: "trailing", badge: "TRAIL",
        icon: "fa-shield-halved", qtype: "Activa trailing",
        msg: `Trailing activat: ${p.symbol}` });
    },
    "trailing:sl_moved": (p: { symbol: string; newSl: number }) => {
      push({ ts: Date.now(), motor: "trailing", kind: "trailing", badge: "SL",
        icon: "fa-shield-halved", qtype: "Actualitza SL",
        msg: `SL mogut: ${p.symbol} → ${p.newSl}` });
    },

    "log:new": (p: { ts: number; level: number; module?: string; msg: string }) => {
      const mod = p.module ?? "";
      const cls = classifyLog(mod, p.msg, p.level);
      const qtype = qtypeFromLog(cls.motor, p.msg, p.level);
      push({ ts: p.ts, ...cls, qtype, msg: p.msg, detail: mod || undefined });
    },

    snapshot: () => { /* feed ja carregat des de /api/activity */ },
  });

  // ── Engine card definitions ──
  const engines = [
    { key: "autotrader" as MotorKey, label: "Auto-Trader",    icon: "fa-robot",                pollMs: 60_000,
      desc: "Escaneig automàtic cada 60s. Detecta senyals de compra per als bots actius i executa mercat + OCO quan el score supera el llindar configurat.",
      data: status?.autoTrader   ? { ...status.autoTrader,   running: status.autoTrader.running   } : undefined,
      detail: status?.autoTrader?.started ? "bot actiu" : "no iniciat" },
    { key: "monitor" as MotorKey,    label: "Order Monitor",  icon: "fa-magnifying-glass",     pollMs: 35_000,
      desc: "Consulta l'estat de les ordres obertes cada 5s. Detecta execucions (TP/SL), actualitza el journal i notifica via Telegram quan una posició es tanca.",
      data: status?.orderMonitor ? { ...status.orderMonitor, running: status.orderMonitor.running } : undefined,
      detail: status?.orderMonitor ? `${status.orderMonitor.knownOrderCount} ordres` : "—" },
    { key: "trailing" as MotorKey,   label: "Trailing",       icon: "fa-shield-halved",        pollMs: 30_000,
      desc: "Gestiona els trailing stops actius cada 30s. Si el preu supera el pic, recalcula el nou SL (mode ATR o PIVOT_LOW), cancel·la l'ordre anterior i col·loca la nova.",
      data: status?.trailing     ? { ...status.trailing,     running: false           } : undefined,
      detail: status?.trailing ? `${status.trailing.activeCount} actius · ${status.trailing.pendingCount} pendents` : "—" },
    { key: "crash" as MotorKey,      label: "Crash Monitor",  icon: "fa-triangle-exclamation", pollMs: 60_000,
      desc: "Monitoritza el preu de BTC cada 60s i manté un historial de 60 min. Si detecta una caiguda brusca (> llindar configurat en 5m/15m/60m), cancel·la totes les ordres obertes.",
      data: status?.crashMonitor ? { ...status.crashMonitor, running: false           } : undefined,
      detail: status?.crashMonitor ? `${status.crashMonitor.historyPoints} punts BTC` : "—" },
    { key: "scheduler" as MotorKey,  label: "Scheduler",      icon: "fa-clock",                pollMs: 15 * 60_000,
      desc: "Planifica l'enviament d'informes periòdics via Telegram: resum de P&L cada hora en punt i resum diari a les 7:30. No opera al mercat.",
      data: status?.scheduler    ? { started: status.scheduler.started, running: false, lastResult: null,
        lastRun: status.scheduler.lastSnapshot } : undefined,
      detail: status?.scheduler?.lastHourly ? `horari: ${timeAgo(status.scheduler.lastHourly, now)}` : "—" },
  ] as const;

  const hbAgo     = heartbeatRef.current ? Math.floor((now - heartbeatRef.current) / 1000) : null;
  const serverNow = status ? status.serverTime + (now - now) : now;

  // ── Per-motor feed slices ──
  const motorFeed = (key: MotorKey) =>
    feed.filter(f => f.motor === key).slice(0, MOTOR_MAX);

  const engByKey = Object.fromEntries(engines.map(e => [e.key, e])) as Record<MotorKey, typeof engines[number] | undefined>;

  return (
    <div className="status-tab">

      {/* ── Vitals bar ── */}
      <div className="vitals-bar">
        <span className="vitals-bar__item">
          <span className={`vitals-bar__dot vitals-bar__dot--${connected ? "green" : "red"}`} />
          SSE: {connected ? "connectat" : "desconnectat"}
        </span>
        <span className="vitals-bar__item">
          <i className="fa-solid fa-signal" style={{ fontSize: "0.65rem", marginRight: 4, color: "var(--text-3)" }} />
          Heartbeat: {hbAgo !== null ? `fa ${hbAgo}s` : "—"}
        </span>
        <span className="vitals-bar__item">
          <i className="fa-solid fa-triangle-exclamation" style={{ fontSize: "0.65rem", marginRight: 4, color: status?.errorCount ? "var(--red)" : "var(--text-3)" }} />
          Errors 24h: {status?.errorCount ?? "—"}
        </span>
        <span className="vitals-bar__item" style={{ marginLeft: "auto", color: "var(--text-3)" }}>
          <i className="fa-solid fa-server" style={{ marginRight: 4 }} />
          {new Date(serverNow).toLocaleTimeString("ca-ES")}
        </span>
      </div>

      {/* ── Engine cards ── */}
      <div className="section-title"><i className="fa-solid fa-tower-control" /> Motors del sistema</div>
      <div className="engine-cards">
        {engines.map(eng => {
          const state = engineState(eng.data);
          return (
            <div key={eng.key} className={`engine-card engine-card--${state}`}>
              <div className="engine-card__header">
                <i className={`fa-solid ${eng.icon} engine-card__icon`} />
                <span className={`engine-card__pill engine-card__pill--${state}`}>{STATE_LABEL[state]}</span>
              </div>
              <div className="engine-card__label">{eng.label}</div>
              <div className="engine-card__time">{timeAgo(eng.data?.lastRun ?? null, now)}</div>
              <div className="engine-card__next dim">proper: {nextIn(eng.data?.lastRun ?? null, eng.pollMs, now)}</div>
              {eng.detail && <div className="engine-card__detail dim">{eng.detail}</div>}
              <div className="engine-card__desc">{eng.desc}</div>
              {eng.data?.lastResult?.startsWith("error") && (
                <div className="engine-card__error">{eng.data.lastResult}</div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Active operations (trailing) ── */}
      {status?.trailing && (status.trailing.activeCount > 0 || status.trailing.pendingCount > 0) && (
        <>
          <div className="section-title"><i className="fa-solid fa-shield-halved" /> Operacions actives</div>
          <div className="active-ops">
            <div className="active-ops__group">
              <div className="active-ops__group-label">
                <i className="fa-solid fa-circle-play" /> Trailing actiu
                <span className="nav__badge" style={{ marginLeft: "0.4rem" }}>{status.trailing.activeCount}</span>
              </div>
              <div className="active-ops__symbols">
                {status.trailing.activeSymbols.length === 0
                  ? <span className="dim" style={{ fontSize: "0.7rem" }}>Cap</span>
                  : status.trailing.activeSymbols.map((t, i) => (
                    <span key={`${t.symbol}-${i}`} className="active-ops__chip" title={`SL: ${t.currentSl} · Peak: ${t.peakPrice}`}>
                      {t.symbol.replace(/USDT$/, "")}
                      <span className="active-ops__chip-detail"> SL {t.currentSl}</span>
                    </span>
                  ))
                }
              </div>
            </div>
            <div className="active-ops__group">
              <div className="active-ops__group-label">
                <i className="fa-solid fa-hourglass-half" /> Pendents d&apos;activació
                <span className="nav__badge" style={{ marginLeft: "0.4rem" }}>{status.trailing.pendingCount}</span>
              </div>
              <div className="active-ops__symbols">
                {status.trailing.pendingSymbols.length === 0
                  ? <span className="dim" style={{ fontSize: "0.7rem" }}>Cap</span>
                  : status.trailing.pendingSymbols.map((sym, i) => (
                    <span key={`${sym}-${i}`} className="active-ops__chip">
                      {sym.replace(/USDT$/, "")}
                    </span>
                  ))
                }
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Per-motor activity grid ── */}
      <div className="section-title"><i className="fa-solid fa-tower-broadcast" /> Activitat per motor</div>
      {!loaded && (
        <div style={{ padding: "1.5rem", color: "var(--text-3)", fontSize: "0.75rem", textAlign: "center" }}>
          <i className="fa-solid fa-spinner fa-spin" style={{ marginRight: "0.4rem" }} />
          Carregant historial…
        </div>
      )}
      <div className="motor-grid">
        {MOTORS.map(motor => {
          const items   = motorFeed(motor.key);
          const eng     = engByKey[motor.key];
          const state   = eng ? engineState(eng.data) : "offline";
          const lastTs  = items[0]?.ts ?? null;

          return (
            <div key={motor.key} className={`motor-panel motor-panel--${state}`}>

              {/* Header */}
              <div className="motor-panel__header">
                <i className={`fa-solid ${motor.icon} motor-panel__icon`} />
                <span className="motor-panel__label">{motor.label}</span>
                <span className={`engine-card__pill engine-card__pill--${state}`} style={{ marginLeft: "auto" }}>
                  {STATE_LABEL[state]}
                </span>
              </div>

              {/* Meta info */}
              <div className="motor-panel__meta">
                {lastTs
                  ? <><i className="fa-solid fa-clock" style={{ marginRight: 3 }} />{timeAgo(lastTs, now)}</>
                  : <span className="dim">Sense activitat</span>
                }
                {items.length > 0 && (
                  <span style={{ marginLeft: "auto" }}>
                    {items.length} event{items.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>

              {/* Event rows */}
              <div className="motor-panel__feed">
                {items.length === 0
                  ? <div className="motor-panel__empty dim">Cap activitat recent</div>
                  : items.map(item => (
                    <div key={item.id} className={`motor-panel__row motor-panel__row--${item.kind}`}>
                      <span className="motor-panel__time">{fmtTime(item.ts)}</span>
                      <span className={`activity-feed__badge ${BADGE_COLORS[item.kind]}`} style={{ flexShrink: 0 }}>
                        {item.badge}
                      </span>
                      <span className="motor-panel__msg">{item.qtype || item.msg}</span>
                    </div>
                  ))
                }
              </div>

            </div>
          );
        })}
      </div>

    </div>
  );
}
