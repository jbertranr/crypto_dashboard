"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useServerEvents } from "../hooks/useServerEvents";
import { useFetchInterval }  from "../hooks/useFetchInterval";
import type { EngineStatus } from "../api/status/route";

// ── Types ──────────────────────────────────────────────────────────────────────
type FeedKind = "fill" | "trailing" | "bot_buy" | "bot_scan" | "warn" | "error" | "system" | "data" | "scheduler";

interface FeedItem {
  id:      string;
  ts:      number;
  kind:    FeedKind;
  badge:   string;
  icon:    string;
  msg:     string;
  detail?: string;
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
  if (d.running)                              return "running";
  if (d.lastResult?.startsWith("error") || d.lastResult?.startsWith("crash")) return "error";
  return "ok";
}

const STATE_LABEL: Record<EngineState, string> = {
  ok:      "OK",
  running: "Executant",
  error:   "Error",
  offline: "Offline",
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

const FEED_MAX = 150;

// ── Main component ─────────────────────────────────────────────────────────────
export default function StatusTab() {
  const [status, setStatus]       = useState<EngineStatus | null>(null);
  const [feed,   setFeed]         = useState<FeedItem[]>([]);
  const [now,    setNow]          = useState(Date.now());
  const heartbeatRef              = useRef<number>(0);

  // Clock — tick every second
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  // Poll engine status every 15s
  useFetchInterval<EngineStatus>("/api/status", 15_000, setStatus);

  // Prepend a feed item (capped at FEED_MAX)
  const push = useCallback((item: Omit<FeedItem, "id">) => {
    setFeed(prev => [{ ...item, id: makeFeedId() }, ...prev].slice(0, FEED_MAX));
  }, []);

  // SSE handlers
  const { connected } = useServerEvents({
    heartbeat: () => {
      heartbeatRef.current = Date.now();
    },
    "order:fill": (p: { symbol: string; side: string; execPrice: number }) => {
      push({ ts: Date.now(), kind: "fill", badge: "FILL", icon: "fa-arrow-right-arrow-left",
        msg: `${p.side} ${p.symbol} @ ${p.execPrice}` });
    },
    "trailing:activated": (p: { symbol: string }) => {
      push({ ts: Date.now(), kind: "trailing", badge: "TRAIL", icon: "fa-shield-halved",
        msg: `Trailing activat: ${p.symbol}` });
    },
    "trailing:sl_moved": (p: { symbol: string; newSl: number }) => {
      push({ ts: Date.now(), kind: "trailing", badge: "SL", icon: "fa-shield-halved",
        msg: `SL mogut: ${p.symbol} → ${p.newSl}` });
    },
    "log:new": (p: { ts: number; level: number; module?: string; msg: string }) => {
      const mod = p.module ?? "";
      if (p.level >= 50) {
        push({ ts: p.ts, kind: "error", badge: "ERR", icon: "fa-circle-exclamation",
          msg: p.msg, detail: mod || undefined });
        return;
      }
      if (p.level >= 40) {
        push({ ts: p.ts, kind: "warn", badge: "WARN", icon: "fa-triangle-exclamation",
          msg: p.msg, detail: mod || undefined });
        return;
      }
      if (mod === "auto-trader" || mod === "auto") {
        const isBuy = /compra|buy|executat|order/i.test(p.msg);
        push({ ts: p.ts, kind: isBuy ? "bot_buy" : "bot_scan", badge: "BOT", icon: isBuy ? "fa-cart-shopping" : "fa-magnifying-glass",
          msg: p.msg });
        return;
      }
      if (mod === "binance" || mod === "cache") {
        push({ ts: p.ts, kind: "data", badge: "DATA", icon: "fa-database", msg: p.msg });
        return;
      }
      if (mod === "telegram" || mod === "scheduler") {
        push({ ts: p.ts, kind: "scheduler", badge: "SCHED", icon: "fa-clock", msg: p.msg });
        return;
      }
      if (mod === "trailing") {
        push({ ts: p.ts, kind: "trailing", badge: "TRAIL", icon: "fa-shield-halved", msg: p.msg });
        return;
      }
      if (mod === "monitor") {
        push({ ts: p.ts, kind: "system", badge: "MON", icon: "fa-eye", msg: p.msg });
        return;
      }
    },
    snapshot: (p: { recentLogs?: { ts: number; level: number; module?: string; msg: string }[] }) => {
      // Hydrate feed from snapshot on connect
      if (!p.recentLogs) return;
      const items: FeedItem[] = p.recentLogs.slice(0, 50).map(log => {
        const mod = log.module ?? "";
        let kind: FeedKind = "system";
        let badge = "SYS";
        let icon  = "fa-gear";
        if (log.level >= 50)                   { kind = "error";     badge = "ERR";   icon = "fa-circle-exclamation"; }
        else if (log.level >= 40)              { kind = "warn";      badge = "WARN";  icon = "fa-triangle-exclamation"; }
        else if (mod === "auto-trader" || mod === "auto") {
          const isBuy = /compra|buy|executat|order/i.test(log.msg);
          kind = isBuy ? "bot_buy" : "bot_scan"; badge = "BOT"; icon = isBuy ? "fa-cart-shopping" : "fa-magnifying-glass";
        }
        else if (mod === "trailing")           { kind = "trailing";  badge = "TRAIL"; icon = "fa-shield-halved"; }
        else if (mod === "binance" || mod === "cache") { kind = "data"; badge = "DATA"; icon = "fa-database"; }
        else if (mod === "telegram" || mod === "scheduler") { kind = "scheduler"; badge = "SCHED"; icon = "fa-clock"; }
        else if (mod === "monitor")            { kind = "system";    badge = "MON";   icon = "fa-eye"; }
        return { id: makeFeedId(), ts: log.ts, kind, badge, icon, msg: log.msg, detail: mod || undefined };
      });
      setFeed(items);
    },
  });

  // ── Engine card definitions ──
  const engines = [
    { key: "autoTrader",   label: "Auto-Trader",    icon: "fa-robot",                pollMs: 60_000,
      data: status?.autoTrader   ? { ...status.autoTrader,   running: status.autoTrader.running   } : undefined,
      detail: status?.autoTrader?.started ? "bot actiu" : "no iniciat" },
    { key: "orderMonitor", label: "Order Monitor",  icon: "fa-magnifying-glass",     pollMs: 35_000,
      data: status?.orderMonitor ? { ...status.orderMonitor, running: status.orderMonitor.running } : undefined,
      detail: status?.orderMonitor ? `${status.orderMonitor.knownOrderCount} ordres` : "—" },
    { key: "trailing",     label: "Trailing",       icon: "fa-shield-halved",        pollMs: 30_000,
      data: status?.trailing     ? { ...status.trailing,     running: false           } : undefined,
      detail: status?.trailing ? `${status.trailing.activeCount} actius · ${status.trailing.pendingCount} pendents` : "—" },
    { key: "crashMonitor", label: "Crash Monitor",  icon: "fa-triangle-exclamation", pollMs: 60_000,
      data: status?.crashMonitor ? { ...status.crashMonitor, running: false           } : undefined,
      detail: status?.crashMonitor ? `${status.crashMonitor.historyPoints} punts BTC` : "—" },
    { key: "scheduler",    label: "Scheduler",      icon: "fa-clock",                pollMs: 15 * 60_000,
      data: status?.scheduler    ? { started: status.scheduler.started, running: false, lastResult: null,
        lastRun: status.scheduler.lastSnapshot } : undefined,
      detail: status?.scheduler?.lastHourly ? `horari: ${timeAgo(status.scheduler.lastHourly, now)}` : "—" },
  ] as const;

  const hbAgo = heartbeatRef.current
    ? Math.floor((now - heartbeatRef.current) / 1000)
    : null;

  const serverNow = status ? status.serverTime + (now - now) : now;

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
              <div className="engine-card__time">
                {timeAgo(eng.data?.lastRun ?? null, now)}
              </div>
              <div className="engine-card__next dim">
                proper: {nextIn(eng.data?.lastRun ?? null, eng.pollMs, now)}
              </div>
              {eng.detail && <div className="engine-card__detail dim">{eng.detail}</div>}
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

      {/* ── Activity feed ── */}
      <div className="section-title"><i className="fa-solid fa-tower-broadcast" /> Activitat en temps real</div>
      <div className="activity-feed">
        {feed.length === 0
          ? <div className="activity-feed__empty dim">Esperant esdeveniments…</div>
          : feed.map(item => (
            <div key={item.id} className="activity-feed__row">
              <span className="activity-feed__time">{fmtTime(item.ts)}</span>
              <i className={`fa-solid ${item.icon} activity-feed__icon`} />
              <span className={`activity-feed__badge ${BADGE_COLORS[item.kind]}`}>{item.badge}</span>
              <span className="activity-feed__msg">{item.msg}</span>
              {item.detail && <span className="activity-feed__detail dim">{item.detail}</span>}
            </div>
          ))
        }
      </div>

    </div>
  );
}
