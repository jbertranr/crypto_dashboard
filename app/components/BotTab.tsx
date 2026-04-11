"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import {
  ResponsiveContainer, ComposedChart, Area,
  XAxis, YAxis, Tooltip, ReferenceDot, ReferenceLine,
} from "recharts";
import type { LogEntry } from "../api/logs/route";
import { useServerEvents } from "../hooks/useServerEvents";

// ── Types ─────────────────────────────────────────────────────────────────────

type Kind =
  | "scan" | "signal" | "buy" | "fill" | "trailing"
  | "error" | "warn" | "idle" | "skip" | "system" | "info";

interface ChatItem {
  id:      string;
  ts:      number;
  kind:    Kind;
  icon:    string;
  title:   string;
  detail?: string;
}

interface BotInfo {
  id:             string;
  code:           string;
  name:           string;
  simId:          string;
  enabled:        boolean;
  budgetUsdt:     number;
  maxDaily:       number;
  hoursFrom:      number;
  hoursTo:        number;
  requireMultiTf: boolean;
  entryDesc:      string;
  exitDesc:       string;
  minProbability: number | null;
  maxOpen:        number | null;
  mode:           "paper" | "real";
  simConfig: {
    name?: string;
    pnlPct?: number;
    config?: {
      interval?: string;
      symbols?: string[];
      tpAtr?: number;
      slAtr?: number;
      minProbability?: number;
      capitalMode?: string;
      capitalFixed?: number;
      capitalPct?: number;
      trailActivateAtr?: number;
      trailDistanceAtr?: number;
    };
  } | null;
}

interface TradeEntry {
  id:          number;
  type:        string;
  symbol:      string;
  price:       string;
  entryPrice:  string | null;
  pnlUsdt:     number | null;
  pnlPct:      number | null;
  exitReason:  string | null;
  tradeCode:   string | null;
  notes:       string | null;
  source:      string;
  executedAt:  number;
}

// ── Interval helpers ──────────────────────────────────────────────────────────

const INTERVAL_MS: Record<string, number> = {
  "1m": 60_000, "3m": 3*60_000, "5m": 5*60_000, "15m": 15*60_000,
  "30m": 30*60_000, "1h": 60*60_000, "2h": 2*60*60_000,
  "4h": 4*60*60_000, "6h": 6*60*60_000, "12h": 12*60*60_000,
  "1d": 24*60*60_000,
};

function nextClose(interval: string): string {
  const ms = INTERVAL_MS[interval];
  if (!ms) return "—";
  const diff = Math.ceil(Date.now() / ms) * ms - Date.now();
  const m    = Math.floor(diff / 60_000);
  const s    = Math.floor((diff % 60_000) / 1000);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function inWindow(hoursFrom: number, hoursTo: number): boolean {
  const h = new Date().getUTCHours();
  if (hoursTo >= 24) return h >= hoursFrom;
  return h >= hoursFrom && h < hoursTo;
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString("ca-ES", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

function fmtDateShort(ts: number): string {
  const d   = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString("ca-ES", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("ca-ES", { day: "2-digit", month: "2-digit" }) + " "
    + d.toLocaleTimeString("ca-ES", { hour: "2-digit", minute: "2-digit" });
}

const EXIT_REASONS: Record<string, string> = {
  TP_HIT: "TP", SL_HIT: "SL", TRAILING_STOP: "Trailing",
  MARKET_SELL: "Market", MANUAL: "Manual", CANCELED: "Cancel·lat",
};

// ── Bot detail panel ──────────────────────────────────────────────────────────

function BotDetailPanel({ bot, onBack, onUpdated }: { bot: BotInfo; onBack: () => void; onUpdated: (b: BotInfo) => void }) {
  const [entries,        setEntries]        = useState<TradeEntry[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [entryDesc,      setEntryDesc]      = useState(bot.entryDesc);
  const [exitDesc,       setExitDesc]       = useState(bot.exitDesc);
  const [minProb,        setMinProb]        = useState<string>(bot.minProbability != null ? String(bot.minProbability) : "");
  const [maxOpenVal,     setMaxOpenVal]     = useState<string>(bot.maxOpen        != null ? String(bot.maxOpen)        : "");
  const [hoursFrom,      setHoursFrom]      = useState<string>(String(bot.hoursFrom));
  const [hoursTo,        setHoursTo]        = useState<string>(String(bot.hoursTo));
  const allDay = hoursFrom === "0" && hoursTo === "24";
  const [saving,         setSaving]         = useState(false);
  const [saveOk,         setSaveOk]         = useState(false);

  useEffect(() => {
    setEntryDesc(bot.entryDesc);
    setExitDesc(bot.exitDesc);
    setMinProb(bot.minProbability != null ? String(bot.minProbability) : "");
    setMaxOpenVal(bot.maxOpen     != null ? String(bot.maxOpen)        : "");
    setHoursFrom(String(bot.hoursFrom));
    setHoursTo(String(bot.hoursTo));
  }, [bot.entryDesc, bot.exitDesc, bot.minProbability, bot.maxOpen, bot.hoursFrom, bot.hoursTo]);

  useEffect(() => {
    setLoading(true);
    fetch("/api/journal?limit=500")
      .then(r => r.json())
      .then((d: { entries: TradeEntry[] }) => {
        const botEntries = (d.entries ?? []).filter(
          e => e.source === "AUTO" && e.notes?.includes(`Bot: ${bot.name}`)
        );
        setEntries(botEntries);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [bot.name]);

  async function saveDescriptions() {
    setSaving(true);
    try {
      const minProbNum = minProb.trim() !== "" ? parseInt(minProb) : null;
      const maxOpenNum = maxOpenVal.trim() !== "" ? parseInt(maxOpenVal) : null;
      const r = await fetch("/api/bots", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: bot.id, entryDesc, exitDesc,
          minProbability: minProbNum, maxOpen: maxOpenNum,
          hoursFrom: parseInt(hoursFrom) || 0,
          hoursTo:   parseInt(hoursTo)   || 24,
        }),
      });
      if (r.ok) {
        const d = await r.json() as { bot: BotInfo };
        onUpdated(d.bot);
        setSaveOk(true);
        setTimeout(() => setSaveOk(false), 2000);
      }
    } finally {
      setSaving(false);
    }
  }

  // Closed trades sorted by time
  const exits = entries
    .filter(e => e.pnlUsdt !== null)
    .sort((a, b) => a.executedAt - b.executedAt);

  // Equity curve (cumulative P&L)
  let cumPnl = 0;
  const curve: { time: number; value: number; pnl: number }[] = [];
  // Add a zero-origin point before the first trade
  if (exits.length > 0) {
    curve.push({ time: exits[0].executedAt - 1, value: 0, pnl: 0 });
  }
  for (const e of exits) {
    cumPnl += e.pnlUsdt!;
    curve.push({ time: e.executedAt, value: cumPnl, pnl: e.pnlUsdt! });
  }

  // Stats
  const wins     = exits.filter(e => (e.pnlUsdt ?? 0) > 0);
  const losses   = exits.filter(e => (e.pnlUsdt ?? 0) < 0);
  const totalPnl = exits.reduce((s, e) => s + (e.pnlUsdt ?? 0), 0);
  const winRate  = exits.length > 0 ? wins.length / exits.length * 100 : 0;
  const avgWin   = wins.length   > 0 ? wins.reduce((s, e) => s + e.pnlUsdt!, 0) / wins.length : 0;
  const avgLoss  = losses.length > 0 ? Math.abs(losses.reduce((s, e) => s + e.pnlUsdt!, 0) / losses.length) : 0;
  const pf       = avgLoss > 0 ? (avgWin * wins.length) / (avgLoss * losses.length) : wins.length > 0 ? 99 : 0;

  const chartColor = totalPnl >= 0 ? "#059669" : "#dc2626";
  const gradId     = `bc-grad-${bot.id}`;

  const prices  = curve.map(d => d.value);
  const minV    = Math.min(0, ...prices);
  const maxV    = Math.max(0, ...prices);
  const pad     = (maxV - minV) * 0.12 || 1;
  const yDomain: [number, number] = [minV - pad, maxV + pad];

  return (
    <div className="bc-detail">

      {/* ── Header ── */}
      <div className="bc-detail__header">
        <button className="bc-detail__back" onClick={onBack}>
          <i className="fa-solid fa-arrow-left" />
          <span>Bots</span>
        </button>
        <span className="bc-detail__title">
          {bot.code && <span className="bc-code-badge">{bot.code}</span>}
          <i className="fa-solid fa-robot" /> {bot.name}
        </span>
        {exits.length > 0 && (
          <span className={`bc-detail__total-pnl${totalPnl >= 0 ? " bc-detail__total-pnl--up" : " bc-detail__total-pnl--down"}`}>
            {totalPnl >= 0 ? "+" : ""}{totalPnl.toFixed(2)} USDT
          </span>
        )}
      </div>

      {/* ── Strategy description ── */}
      <div className="bc-strategy">
        <div className="bc-strategy__col">
          <div className="bc-strategy__label">
            <i className="fa-solid fa-arrow-right-to-bracket" /> Condicions d'entrada
          </div>
          <textarea
            className="bc-strategy__textarea"
            value={entryDesc}
            onChange={e => setEntryDesc(e.target.value)}
            placeholder="Descriu quan el bot entra al mercat: indicadors, condicions de senyal, filtre de tendència, confirmació multi-TF…"
            rows={3}
          />
        </div>
        <div className="bc-strategy__col">
          <div className="bc-strategy__label">
            <i className="fa-solid fa-arrow-right-from-bracket" /> Condicions de sortida
          </div>
          <textarea
            className="bc-strategy__textarea"
            value={exitDesc}
            onChange={e => setExitDesc(e.target.value)}
            placeholder="Descriu com gestiona la sortida: TP/SL en ATR, trailing stop, sortida parcial, condicions especials…"
            rows={3}
          />
        </div>
        <div className="bc-strategy__params-row">
          <label className="bc-strategy__param-field">
            <span className="bc-strategy__param-label">
              <i className="fa-solid fa-percent" /> Prob. mínima entrada
              <span className="bc-strategy__param-hint">buit = usa la de la simulació</span>
            </span>
            <input
              type="number" min="50" max="95" step="5"
              className="bc-strategy__param-input"
              placeholder={`sim: ${bot.simConfig?.config?.minProbability ?? 70}`}
              value={minProb}
              onChange={e => setMinProb(e.target.value)}
            />
          </label>
          <label className="bc-strategy__param-field">
            <span className="bc-strategy__param-label">
              <i className="fa-solid fa-layer-group" /> Màx. posicions simultànies
              <span className="bc-strategy__param-hint">buit = sense límit de posicions</span>
            </span>
            <input
              type="number" min="1" max="20" step="1"
              className="bc-strategy__param-input"
              placeholder="cap límit"
              value={maxOpenVal}
              onChange={e => setMaxOpenVal(e.target.value)}
            />
          </label>
        </div>
        <div className="bc-strategy__params-row">
          <div className="bc-strategy__param-field bc-strategy__param-field--hours">
            <span className="bc-strategy__param-label">
              <i className="fa-solid fa-clock" /> Finestra horària (UTC)
            </span>
            <div className="bc-strategy__hours-row">
              <label className="bc-strategy__allday-check">
                <input
                  type="checkbox"
                  checked={allDay}
                  onChange={e => {
                    if (e.target.checked) { setHoursFrom("0"); setHoursTo("24"); }
                    else { setHoursFrom("8"); setHoursTo("22"); }
                  }}
                />
                Tot el dia (0–24 h)
              </label>
              <label className="bc-strategy__param-label" style={{ margin: 0 }}>De</label>
              <input
                type="number" min="0" max="23" step="1"
                className="bc-strategy__param-input bc-strategy__param-input--hour"
                value={hoursFrom}
                disabled={allDay}
                onChange={e => setHoursFrom(e.target.value)}
              />
              <label className="bc-strategy__param-label" style={{ margin: 0 }}>a</label>
              <input
                type="number" min="1" max="24" step="1"
                className="bc-strategy__param-input bc-strategy__param-input--hour"
                value={hoursTo}
                disabled={allDay}
                onChange={e => setHoursTo(e.target.value)}
              />
              <span className="bc-strategy__param-hint">h UTC</span>
            </div>
          </div>
        </div>
        <button
          className={`btn ${saveOk ? "btn-success" : "btn-primary"} btn-sm bc-strategy__save`}
          onClick={saveDescriptions}
          disabled={saving}>
          {saving
            ? <><i className="fa-solid fa-spinner fa-spin" /> Desant…</>
            : saveOk
              ? <><i className="fa-solid fa-check" /> Desat</>
              : <><i className="fa-solid fa-floppy-disk" /> Desar</>}
        </button>
      </div>

      {/* ── Stats row ── */}
      <div className="bc-detail__stats-row">
        <div className="bc-stat">
          <span className="bc-stat__lbl">Operacions</span>
          <span className="bc-stat__val">{exits.length}</span>
        </div>
        <div className="bc-stat">
          <span className="bc-stat__lbl">Victòries</span>
          <span className="bc-stat__val bc-stat__val--green">{wins.length}</span>
        </div>
        <div className="bc-stat">
          <span className="bc-stat__lbl">Pèrdues</span>
          <span className="bc-stat__val bc-stat__val--red">{losses.length}</span>
        </div>
        <div className="bc-stat">
          <span className="bc-stat__lbl">Win rate</span>
          <span className="bc-stat__val">{exits.length > 0 ? winRate.toFixed(1) : "—"}%</span>
        </div>
        <div className="bc-stat">
          <span className="bc-stat__lbl">Avg guany</span>
          <span className="bc-stat__val bc-stat__val--green">
            {wins.length > 0 ? `+${avgWin.toFixed(2)}` : "—"}
          </span>
        </div>
        <div className="bc-stat">
          <span className="bc-stat__lbl">Avg pèrdua</span>
          <span className="bc-stat__val bc-stat__val--red">
            {losses.length > 0 ? `-${avgLoss.toFixed(2)}` : "—"}
          </span>
        </div>
        <div className="bc-stat">
          <span className="bc-stat__lbl">Profit factor</span>
          <span className="bc-stat__val">{exits.length > 0 ? pf.toFixed(2) : "—"}</span>
        </div>
      </div>

      {loading && (
        <div className="bc-detail__loading">
          <i className="fa-solid fa-spinner fa-spin" /> Carregant operacions…
        </div>
      )}

      {!loading && exits.length === 0 && (
        <div className="bc-detail__empty">
          <i className="fa-solid fa-chart-line" />
          <span>Sense operacions registrades per aquest bot.</span>
        </div>
      )}

      {!loading && curve.length >= 2 && (
        <>
          {/* ── Equity chart ── */}
          <div className="bc-detail__chart">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={curve} margin={{ top: 8, right: 20, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={chartColor} stopOpacity={0.18} />
                    <stop offset="95%" stopColor={chartColor} stopOpacity={0}    />
                  </linearGradient>
                </defs>

                <XAxis dataKey="time" tickFormatter={fmtDateShort}
                  tick={{ fill: "#94a3b8", fontSize: 9 }} tickLine={false} axisLine={false}
                  interval="preserveStartEnd" />
                <YAxis domain={yDomain}
                  tickFormatter={v => `${(v as number) >= 0 ? "+" : ""}${(v as number).toFixed(1)}`}
                  tick={{ fill: "#94a3b8", fontSize: 9 }} tickLine={false} axisLine={false} width={54} />

                <Tooltip
                  contentStyle={{
                    background: "var(--bg-card)", border: "1px solid var(--border)",
                    borderRadius: 8, fontSize: 11,
                  }}
                  labelFormatter={v => fmtDateShort(v as number)}
                  formatter={(v, name) => {
                    if (name === "value") {
                      const val = v as number;
                      return [`${val >= 0 ? "+" : ""}${val.toFixed(2)} USDT`, "P&L acumulat"];
                    }
                    return [v, name];
                  }}
                />

                <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" strokeWidth={1} />

                <Area type="monotone" dataKey="value"
                  stroke={chartColor} strokeWidth={2}
                  fill={`url(#${gradId})`} dot={false} activeDot={{ r: 4 }} />

                {/* Trade dots — green = win, red = loss (skip origin point at index 0) */}
                {curve.slice(1).map((pt, i) => (
                  <ReferenceDot key={i} x={pt.time} y={pt.value}
                    r={4} fill={pt.pnl >= 0 ? "#059669" : "#dc2626"}
                    stroke="var(--bg-card)" strokeWidth={1.5} />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* ── Trades table ── */}
          <div className="bc-detail__table-wrap">
            <table className="data-table">
              <thead className="data-table__head">
                <tr>
                  <th>Data</th>
                  <th>Símbol</th>
                  <th className="r">Entrada</th>
                  <th className="r">Sortida</th>
                  <th className="r">P&amp;L USDT</th>
                  <th className="r">P&amp;L %</th>
                  <th>Raó</th>
                  <th>Codi</th>
                </tr>
              </thead>
              <tbody>
                {[...exits].reverse().map(e => {
                  const pnlUp = (e.pnlUsdt ?? 0) >= 0;
                  return (
                    <tr key={e.id} className="data-table__row">
                      <td className="data-table__cell dim">{fmtDate(e.executedAt)}</td>
                      <td className="data-table__cell bold">{e.symbol}</td>
                      <td className="data-table__cell mono r">
                        {e.entryPrice ? parseFloat(e.entryPrice).toFixed(4) : "—"}
                      </td>
                      <td className="data-table__cell mono r">
                        {parseFloat(e.price).toFixed(4)}
                      </td>
                      <td className="data-table__cell mono r"
                        style={{ color: pnlUp ? "var(--green)" : "var(--red)" }}>
                        {e.pnlUsdt !== null
                          ? `${pnlUp ? "+" : ""}${e.pnlUsdt.toFixed(2)}`
                          : "—"}
                      </td>
                      <td className="data-table__cell mono r"
                        style={{ color: pnlUp ? "var(--green)" : "var(--red)" }}>
                        {e.pnlPct !== null
                          ? `${pnlUp ? "+" : ""}${e.pnlPct.toFixed(2)}%`
                          : "—"}
                      </td>
                      <td className="data-table__cell dim">
                        {e.exitReason ? (EXIT_REASONS[e.exitReason] ?? e.exitReason) : "—"}
                      </td>
                      <td className="data-table__cell dim">
                        {e.tradeCode ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── Bot status table ──────────────────────────────────────────────────────────

function simTooltip(sim: BotInfo["simConfig"]): string {
  if (!sim) return "Simulació no trobada";
  const c = sim.config ?? {};
  const parts: string[] = [];
  if (sim.name)               parts.push(`"${sim.name}"`);
  if (c.interval)             parts.push(`Interval: ${c.interval}`);
  if (c.symbols?.length)      parts.push(`Parells: ${c.symbols.join(", ")}`);
  if (c.tpAtr != null)        parts.push(`TP: ${c.tpAtr}× ATR`);
  if (c.slAtr != null)        parts.push(`SL: ${c.slAtr}× ATR`);
  if (c.trailActivateAtr != null) parts.push(`Trail activa: ${c.trailActivateAtr}× ATR`);
  if (c.trailDistanceAtr != null) parts.push(`Trail dist: ${c.trailDistanceAtr}× ATR`);
  if (c.minProbability != null)   parts.push(`Score mínim: ${c.minProbability}`);
  if (c.capitalMode)          parts.push(`Capital: ${c.capitalMode}${c.capitalFixed ? ` (${c.capitalFixed} USDT)` : c.capitalPct ? ` (${c.capitalPct}%)` : ""}`);
  if (sim.pnlPct != null)     parts.push(`P&L sim: ${sim.pnlPct > 0 ? "+" : ""}${sim.pnlPct.toFixed(1)}%`);
  return parts.join(" · ") || "Sense paràmetres";
}

function BotTable({
  bots, selectedId, onSelect,
}: {
  bots: BotInfo[];
  selectedId: string | null;
  onSelect: (bot: BotInfo) => void;
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  void tick;

  return (
    <div className="bc-cards">
      {bots.map(bot => {
        const interval = bot.simConfig?.config?.interval ?? "—";
        const symbols  = bot.simConfig?.config?.symbols ?? [];
        const active   = bot.enabled && inWindow(bot.hoursFrom, bot.hoursTo);
        const selected = selectedId === bot.id;
        const statusCls = active ? "bc-status--active" : bot.enabled ? "bc-status--paused" : "bc-status--off";
        const statusLbl = !bot.enabled ? "Desactivat" : active ? "Actiu" : "Fora d'hores";

        return (
          <div key={bot.id}
            className={`bc-bot-card${selected ? " bc-bot-card--selected" : ""}`}
            onClick={() => onSelect(bot)}>

            {/* ── Identity ── */}
            <div className="bc-bot-card__identity">
              <div className="bc-bot-card__name-row">
                {bot.code && <span className="bc-code-badge">{bot.code}</span>}
                <span className="bc-bot-card__name">{bot.name}</span>
              </div>
              <span className="bc-sim-badge" data-tooltip={simTooltip(bot.simConfig)}>
                <i className="fa-solid fa-flask" />{bot.simConfig?.name ?? bot.simId}
              </span>
              <span className={`bc-status ${statusCls}`}>
                <span className="bc-status__dot" />{statusLbl}
              </span>
            </div>

            {/* ── Strategy descriptions ── */}
            <div className="bc-bot-card__strat">
              {bot.entryDesc
                ? <span className="bc-strat-preview__item" title={bot.entryDesc}>
                    <i className="fa-solid fa-arrow-right-to-bracket" />
                    {bot.entryDesc.length > 55 ? bot.entryDesc.slice(0, 55) + "…" : bot.entryDesc}
                  </span>
                : <span className="bc-strat-preview__empty">Sense descripció d'entrada</span>}
              {bot.exitDesc
                ? <span className="bc-strat-preview__item bc-strat-preview__item--exit" title={bot.exitDesc}>
                    <i className="fa-solid fa-arrow-right-from-bracket" />
                    {bot.exitDesc.length > 55 ? bot.exitDesc.slice(0, 55) + "…" : bot.exitDesc}
                  </span>
                : null}
            </div>

            {/* ── Params chips ── */}
            <div className="bc-bot-card__params">
              {interval !== "—" && (
                <span className="bc-param-chip"><i className="fa-solid fa-clock" />{interval}</span>
              )}
              {symbols.length > 0 && (
                <span className="bc-param-chip" title={symbols.join(", ")}>
                  <i className="fa-solid fa-coins" />{symbols.length} parells
                </span>
              )}
              <span className="bc-param-chip">
                <i className="fa-solid fa-wallet" />{bot.budgetUsdt} USDT
              </span>
              <span className="bc-param-chip">
                <i className="fa-solid fa-repeat" />màx {bot.maxDaily}/dia
              </span>
              <span className="bc-param-chip">
                <i className="fa-solid fa-hourglass" />
                {bot.hoursFrom === 0 && bot.hoursTo >= 24
                  ? "Tot el dia"
                  : `${bot.hoursFrom}:00–${bot.hoursTo}:00 UTC`}
              </span>
              {bot.minProbability != null && (
                <span className="bc-param-chip">
                  <i className="fa-solid fa-percent" />prob. ≥{bot.minProbability}
                </span>
              )}
              {bot.maxOpen != null && (
                <span className="bc-param-chip">
                  <i className="fa-solid fa-layer-group" />màx {bot.maxOpen} pos.
                </span>
              )}
              {bot.requireMultiTf && (
                <span className="bc-param-chip bc-param-chip--accent">
                  <i className="fa-solid fa-layer-group" />Multi-TF
                </span>
              )}
            </div>

            {/* ── Next scan countdown ── */}
            <div className="bc-bot-card__scan">
              {bot.enabled && interval !== "—"
                ? <><span className="bc-bot-card__scan-label">Proper scan</span>
                    <span className="bc-countdown">{nextClose(interval)}</span></>
                : <span className="dim">—</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Log → ChatItem ────────────────────────────────────────────────────────────

const BOT_MODULE = "auto-trader";

function formatLog(entry: LogEntry): ChatItem | null {
  const e   = entry as Record<string, unknown>;
  const msg = entry.msg;
  const ts  = entry.ts || (e.time as number) || Date.now();
  const id  = `log-${ts}-${msg}`;

  if (msg === "iniciant scan de bot") {
    return { id, ts, kind: "scan", icon: "fa-satellite-dish",
      title:  `Bot "${e.bot}" · ${e.symbols} símbols · ${e.interval}`,
      detail: `Score mínim: ${e.minScore}` };
  }
  if (msg === "senyal → comprant") {
    return { id, ts, kind: "signal", icon: "fa-bolt",
      title: `Senyal ${e.symbol} · score ${e.score} · ${e.interval}` };
  }
  if (msg === "auto-compra executada") {
    const fp = typeof e.fillPrice === "number"
      ? (e.fillPrice as number).toFixed(4) : e.fillPrice;
    return { id, ts, kind: "buy", icon: "fa-circle-check",
      title:  `Compra ${e.symbol} executada`,
      detail: `Qty: ${e.qty} · Preu: ${fp} · TP: ${e.tpPrice} · SL: ${e.slStopPrice}` };
  }
  if (msg === "bot fora de finestra horària") {
    return { id, ts, kind: "idle", icon: "fa-clock",
      title: `Bot "${e.bot}" · fora de la finestra horària (hora UTC: ${e.nowHour})` };
  }
  if (msg === "bot: màxim diari assolit") {
    return { id, ts, kind: "idle", icon: "fa-ban",
      title: `Bot "${e.bot}" · màxim diari assolit (${e.count}/${e.max})` };
  }
  if (msg === "bot: pressupost exhaurit") {
    return { id, ts, kind: "idle", icon: "fa-wallet",
      title:  `Bot "${e.bot}" · pressupost exhaurit`,
      detail: `Compromès: ${e.committed} USDT · Pressupost: ${e.budget} USDT` };
  }
  if (msg === "sense senyal") {
    return { id, ts, kind: "skip", icon: "fa-minus",
      title:  `${e.symbol} · sense senyal`,
      detail: `score: ${e.score} · ${e.verdict}` };
  }
  if (msg === "multi-TF no confirmat") {
    return { id, ts, kind: "skip", icon: "fa-xmark",
      title: `${e.symbol} · multi-TF no confirmat (${e.interval} / ${e.confirmTf})` };
  }
  if (msg === "bot: simulació no trobada, saltant") {
    return { id, ts, kind: "warn", icon: "fa-triangle-exclamation",
      title: `Bot "${e.bot}" · simulació no trobada (${e.simId})` };
  }
  if (msg.startsWith("error en bot scan") || msg.startsWith("error en globalPoll")) {
    return { id, ts, kind: "error", icon: "fa-circle-xmark",
      title:  `Error · ${[e.bot, e.symbol].filter(Boolean).join(" · ")}`,
      detail: String(e.err ?? "") };
  }
  if (msg === "auto-trader multi-bot iniciat (poll 60s)") {
    return { id, ts, kind: "system", icon: "fa-robot",
      title: "Auto-trader iniciat (poll 60s)" };
  }

  const kind: Kind = entry.level >= 50 ? "error" : entry.level >= 40 ? "warn" : "info";
  return { id, ts, kind, icon: "fa-circle-info", title: msg };
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("ca-ES", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function fmtDay(ts: number): string {
  return new Date(ts).toLocaleDateString("ca-ES", {
    weekday: "short", day: "numeric", month: "short",
  });
}

const MAX_ITEMS  = 500;
const SKIP_KINDS: Kind[] = ["skip", "idle"];

// ── Main component ────────────────────────────────────────────────────────────

export default function BotTab() {
  const [bots,          setBots]          = useState<BotInfo[]>([]);
  const [items,         setItems]         = useState<ChatItem[]>([]);
  const [live,          setLive]          = useState(true);
  const [showDebug,     setShowDebug]     = useState(false);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);

  const liveRef      = useRef(live);
  const showDebugRef = useRef(showDebug);
  useEffect(() => { liveRef.current = live; }, [live]);
  useEffect(() => { showDebugRef.current = showDebug; }, [showDebug]);

  useEffect(() => {
    if (!selectedBotId) anchorRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [items, selectedBotId]);

  const loadBots = useCallback(async () => {
    try {
      const r = await fetch("/api/bots");
      const d = await r.json() as { bots: BotInfo[] };
      setBots(d.bots ?? []);
    } catch { /* silenciat */ }
  }, []);

  const loadLogs = useCallback(async () => {
    try {
      const r = await fetch(`/api/logs?module=${BOT_MODULE}&level=debug&limit=300`);
      const d = await r.json() as { entries: LogEntry[] };
      const loaded: ChatItem[] = [];
      for (const entry of d.entries) {
        const item = formatLog(entry);
        if (item) loaded.push(item);
      }
      setItems(loaded);
    } catch { /* silenciat */ }
  }, []);

  useEffect(() => { loadBots(); loadLogs(); }, [loadBots, loadLogs]);
  useEffect(() => {
    const id = setInterval(loadBots, 30_000);
    return () => clearInterval(id);
  }, [loadBots]);

  useServerEvents({
    "log:new": (entry: LogEntry) => {
      if (!liveRef.current) return;
      if (entry.module !== BOT_MODULE) return;
      const item = formatLog(entry);
      if (!item) return;
      setItems(prev => [...prev, item].slice(-MAX_ITEMS));
    },
    "order:fill": (payload: { symbol: string; side: string; orderId: number; execPrice: number }) => {
      if (!liveRef.current) return;
      const ts = Date.now();
      const item: ChatItem = {
        id: `fill-${ts}-${payload.symbol}`, ts, kind: "fill",
        icon: "fa-arrow-right-arrow-left",
        title:  `Ordre ${payload.side} ${payload.symbol} completada`,
        detail: `Preu: ${payload.execPrice} · Order #${payload.orderId}`,
      };
      setItems(prev => [...prev, item].slice(-MAX_ITEMS));
    },
    "trailing:sl_moved": (payload: { symbol: string; newSl: number }) => {
      if (!liveRef.current) return;
      const ts = Date.now();
      const item: ChatItem = {
        id: `trail-sl-${ts}-${payload.symbol}`, ts, kind: "trailing",
        icon: "fa-shield-halved",
        title:  `Trailing SL mogut · ${payload.symbol}`,
        detail: `Nou SL: ${payload.newSl}`,
      };
      setItems(prev => [...prev, item].slice(-MAX_ITEMS));
    },
    "trailing:activated": (payload: { symbol: string }) => {
      if (!liveRef.current) return;
      const ts = Date.now();
      const item: ChatItem = {
        id: `trail-act-${ts}-${payload.symbol}`, ts, kind: "trailing",
        icon: "fa-shield-halved",
        title: `Trailing activat · ${payload.symbol}`,
      };
      setItems(prev => [...prev, item].slice(-MAX_ITEMS));
    },
    "snapshot": () => { loadBots(); loadLogs(); },
  });

  const activeBots   = bots.filter(b => b.enabled);
  const inactiveBots = bots.filter(b => !b.enabled);
  const allBots      = [...activeBots, ...inactiveBots];
  const selectedBot  = selectedBotId ? bots.find(b => b.id === selectedBotId) ?? null : null;

  const visible = showDebug ? items : items.filter(i => !SKIP_KINDS.includes(i.kind));
  type Row = ChatItem | { _day: true; label: string; key: string };
  const rows: Row[] = [];
  let lastDay = "";
  for (const item of visible) {
    const day = fmtDay(item.ts);
    if (day !== lastDay) {
      rows.push({ _day: true, label: day, key: `day-${day}` });
      lastDay = day;
    }
    rows.push(item);
  }

  const todayItems  = items.filter(i => new Date(i.ts).toDateString() === new Date().toDateString());
  const errorItems  = items.filter(i => i.kind === "error" || i.kind === "warn");

  return (
    <div className="bot-chat">

      {/* ── 5 KPIs ── */}
      <div className="section-title">
        <i className="fa-solid fa-robot" /> Bot
      </div>
      <div className="portfolio__cards">
        <div className={`portfolio__card portfolio__card--${activeBots.length > 0 ? "green" : "neutral"}`}>
          <span className="portfolio__card-label"><i className="fa-solid fa-circle-play" /> Bots actius</span>
          <span className="portfolio__card-value portfolio__card-value--count">{activeBots.length}</span>
          <span className="portfolio__card-sub">de {bots.length} configurats</span>
        </div>
        <div className="portfolio__card portfolio__card--neutral">
          <span className="portfolio__card-label"><i className="fa-solid fa-pause" /> En pausa</span>
          <span className="portfolio__card-value portfolio__card-value--count">{inactiveBots.length}</span>
          <span className="portfolio__card-sub">bots desactivats</span>
        </div>
        <div className="portfolio__card portfolio__card--blue">
          <span className="portfolio__card-label"><i className="fa-solid fa-message" /> Events avui</span>
          <span className="portfolio__card-value portfolio__card-value--count">{todayItems.length}</span>
          <span className="portfolio__card-sub">activitat del dia</span>
        </div>
        <div className={`portfolio__card portfolio__card--${errorItems.length > 0 ? "red" : "green"}`}>
          <span className="portfolio__card-label"><i className="fa-solid fa-triangle-exclamation" /> Incidents</span>
          <span className="portfolio__card-value portfolio__card-value--count">{errorItems.length}</span>
          <span className="portfolio__card-sub">errors i avisos</span>
        </div>
        <div className="portfolio__card portfolio__card--neutral">
          <span className="portfolio__card-label"><i className="fa-solid fa-clock" /> Últim event</span>
          <span className="portfolio__card-value" style={{ fontSize: "0.9rem" }}>
            {items.length > 0
              ? new Date(items[items.length - 1].ts).toLocaleTimeString("ca-ES", { hour: "2-digit", minute: "2-digit" })
              : "—"}
          </span>
          <span className="portfolio__card-sub">{items.length} events en memòria</span>
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div className="bot-chat__toolbar">
        <i className="fa-solid fa-robot bot-chat__hdr-icon" />
        <span className="bot-chat__title">Bot</span>
        <div className={`bot-chat__dot${live ? " bot-chat__dot--live" : ""}`} />

        <span className="bot-chat__spacer" />

        {!selectedBotId && <>
          <label className="bot-chat__toggle">
            <input type="checkbox" checked={showDebug}
              onChange={e => setShowDebug(e.target.checked)} />
            Mostrar tot
          </label>
          <label className="bot-chat__toggle">
            <input type="checkbox" checked={live}
              onChange={e => setLive(e.target.checked)} />
            Live
          </label>
          <button className="bot-chat__icon-btn"
            onClick={() => { loadBots(); loadLogs(); }} title="Refresca">
            <i className="fa-solid fa-rotate-right" />
          </button>
          <button className="bot-chat__icon-btn bot-chat__icon-btn--danger"
            onClick={() => setItems([])} title="Neteja">
            <i className="fa-solid fa-trash-can" />
          </button>
        </>}

        {selectedBotId && (
          <button className="bot-chat__icon-btn"
            onClick={() => setSelectedBotId(null)}>
            <i className="fa-solid fa-xmark" /> Tancar
          </button>
        )}
      </div>

      {/* ── Bot table ── */}
      {bots.length > 0
        ? <BotTable bots={allBots} selectedId={selectedBotId}
            onSelect={b => setSelectedBotId(prev => prev === b.id ? null : b.id)} />
        : (
          <div className="bc-no-bots">
            <i className="fa-solid fa-robot" />
            <span>Cap bot configurat.</span>
          </div>
        )
      }

      {/* ── Detail panel OR chat ── */}
      {selectedBot ? (
        <BotDetailPanel
          bot={selectedBot}
          onBack={() => setSelectedBotId(null)}
          onUpdated={updated => setBots(prev => prev.map(b => b.id === updated.id ? { ...b, ...updated } : b))}
        />
      ) : (
        visible.length === 0 ? (
          <div className="bot-chat__empty">
            <i className="fa-solid fa-satellite-dish" />
            <span>Sense activitat recent.</span>
            <span className="bot-chat__empty-sub">
              {activeBots.length > 0
                ? `${activeBots.length} bot${activeBots.length > 1 ? "s" : ""} actiu${activeBots.length > 1 ? "s" : ""}. El log apareixerà aquí quan es tanqui la propera candle.`
                : "Activa un bot per veure l'activitat en temps real."}
            </span>
          </div>
        ) : (
          <div className="bot-chat__messages">
            {rows.map(row => {
              if ("_day" in row) {
                return <div key={row.key} className="bot-chat__day-sep">{row.label}</div>;
              }
              const item = row as ChatItem;
              return (
                <div key={item.id} className={`bot-msg bot-msg--${item.kind}`}>
                  <div className={`bot-msg__avatar bot-msg__avatar--${item.kind}`}>
                    <i className={`fa-solid ${item.icon}`} />
                  </div>
                  <div className="bot-msg__body">
                    <div className="bot-msg__row1">
                      <span className="bot-msg__text">{item.title}</span>
                      <span className="bot-msg__time">{fmtTime(item.ts)}</span>
                    </div>
                    {item.detail && (
                      <div className="bot-msg__detail">{item.detail}</div>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={anchorRef} className="bot-chat__anchor" />
          </div>
        )
      )}
    </div>
  );
}
