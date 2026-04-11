"use client";
import { useEffect, useState, useCallback } from "react";

interface Settings {
  tg_on_new_order:          string;
  tg_on_order_close:        string;
  tg_on_sl_modify:          string;
  tg_on_trailing_activate:  string;
  tg_on_market_scan:        string;
  tg_on_motor_anomaly:      string;
  motor_anomaly_multiplier: string;
  entry_type:               string;
  // Global trailing mode (not per-TF/type)
  trailing_sl_mode:         string;
  trailing_pivot_tf:        string;
  trailing_pivot_offset_pct: string;
  // Capital management
  capital_mode:             string;   // "FIXED" | "PCT_PORTFOLIO"
  capital_fixed_usdt:       string;
  capital_pct_portfolio:    string;
  capital_max_open:         string;
  // Pair priority
  priority_pairs:           string;   // comma-separated enabled pairs
  // Risk management
  cancel_auto_sell:            string;
  sl_sell_remaining:           string;
  // Auto-trading master switch only (per-bot config is in the bots table)
  auto_trade_enabled:          string;
  [key: string]:            string;
}

interface SavedConfig {
  id: string;
  name: string;
  pnlPct?: number;
  config: {
    symbols: string[];
    interval: string;
    tpAtr: number;
    slAtr: number;
    trailActivateAtr: number;
    trailDistanceAtr: number;
    capitalMode: string;
    capitalFixed?: number;
    capitalPct?: number;
    amBasePct?: number;
  };
  effectiveConfig?: { minProbability?: number; maxOpen?: number };
}

interface Bot {
  id:             string;
  name:           string;
  simId:          string;
  enabled:        boolean;
  budgetUsdt:     number;
  maxDaily:       number;
  hoursFrom:      number;
  hoursTo:        number;
  requireMultiTf: boolean;
  minProbability: number | null;
  maxOpen:        number | null;
  mode:           "paper" | "real";
  createdAt:      number;
  simConfig:      SavedConfig | null;
}

type TgSettings = Pick<Settings,
  "tg_on_new_order" | "tg_on_order_close" | "tg_on_sl_modify" | "tg_on_trailing_activate" | "tg_on_market_scan" | "tg_on_motor_anomaly"
>;

const CFG_INTERVALS = ["5m", "1h", "4h"] as const;
type CfgInterval  = (typeof CFG_INTERVALS)[number];
type CfgOrderType = "LIMIT" | "MARKET";

/**
 * Calibrated per-TF defaults.
 *
 * Philosophy:
 *  - 5m (scalping)  : ATR typically 0.05-0.20% of price. Tight stops, quick TP,
 *                     R:R = 1.5/0.75 = 2.0:1. Trailing activates at 1×ATR.
 *  - 1h (intraday)  : ATR typically 0.30-0.80%. Balanced parameters,
 *                     R:R = 2.5/1.0 = 2.5:1. Best for trend confirmation.
 *  - 4h (swing)     : ATR typically 1.0-3.0%. Wide stops needed to survive
 *                     retracements, R:R = 3.0/1.5 = 2.0:1.
 *
 * SL-limit offset is set wider on higher TFs to absorb spread slippage.
 * Trailing activates only after the move has proven itself (≥ 1×ATR gain).
 */
const TF_PRESETS: Record<CfgInterval, Record<CfgOrderType, Record<string, string>>> = {
  "5m": {
    //                  entry offset  TP ×ATR  SL ×ATR  SL-limit off  trail act  trail dist
    LIMIT:  { entry_limit_offset_pct: "0.05", oco_tp_atr: "1.5", oco_sl_atr: "0.75", oco_sl_limit_offset_pct: "0.10", trailing_activate_atr: "1.0", trailing_distance_atr: "0.6" },
    MARKET: {                                  oco_tp_atr: "1.5", oco_sl_atr: "0.75",                                   trailing_activate_atr: "1.0", trailing_distance_atr: "0.6" },
  },
  "1h": {
    LIMIT:  { entry_limit_offset_pct: "0.15", oco_tp_atr: "2.5", oco_sl_atr: "1.0",  oco_sl_limit_offset_pct: "0.20", trailing_activate_atr: "1.5", trailing_distance_atr: "1.0" },
    MARKET: {                                  oco_tp_atr: "2.5", oco_sl_atr: "1.0",                                   trailing_activate_atr: "1.5", trailing_distance_atr: "1.0" },
  },
  "4h": {
    LIMIT:  { entry_limit_offset_pct: "0.25", oco_tp_atr: "3.0", oco_sl_atr: "1.5",  oco_sl_limit_offset_pct: "0.35", trailing_activate_atr: "2.0", trailing_distance_atr: "1.5" },
    MARKET: {                                  oco_tp_atr: "3.0", oco_sl_atr: "1.5",                                   trailing_activate_atr: "2.0", trailing_distance_atr: "1.5" },
  },
};

function presetKey(param: string, type: CfgOrderType, tf: CfgInterval): string {
  return `${param}__${type}__${tf}`;
}

const DEFAULTS = {
  tg_on_new_order: "1", tg_on_order_close: "1",
  tg_on_sl_modify: "1", tg_on_trailing_activate: "1",
  tg_on_market_scan: "0",
  entry_type: "LIMIT",
  trailing_sl_mode: "ATR",
  trailing_pivot_tf: "1h",
  trailing_pivot_offset_pct: "0.1",
  capital_mode: "FIXED",
  capital_fixed_usdt: "100",
  capital_pct_portfolio: "5",
  capital_max_open: "3",
  priority_pairs: "BTCUSDT,ETHUSDT,BNBUSDT,SOLUSDT,XRPUSDT",
  auto_trade_enabled: "0",
  cancel_auto_sell:   "0",
  sl_sell_remaining:  "0",
  tg_on_motor_anomaly:      "1",
  motor_anomaly_multiplier: "3",
};

const ALL_PAIRS = [
  { symbol: "BTC", pair: "BTCUSDT",  color: "#F7931A", iconCls: "fa-solid fa-bitcoin-sign" },
  { symbol: "ETH", pair: "ETHUSDT",  color: "#627EEA", iconCls: "fa-brands fa-ethereum" },
  { symbol: "BNB", pair: "BNBUSDT",  color: "#F3BA2F", iconCls: "fa-solid fa-coins" },
  { symbol: "SOL", pair: "SOLUSDT",  color: "#00FFA3", iconCls: "fa-solid fa-sun" },
  { symbol: "XRP", pair: "XRPUSDT",  color: "#00AAE4", iconCls: "fa-solid fa-droplet" },
] as const;

const NOTIFICATIONS: {
  key: keyof TgSettings;
  icon: string;
  title: string;
  desc: string;
}[] = [
  {
    key:   "tg_on_new_order",
    icon:  "fa-cart-shopping",
    title: "Nova ordre col\u00b7locada",
    desc:  "Notifica quan es fa una compra (Buy & Exit) o es col\u00b7loca un OCO directament.",
  },
  {
    key:   "tg_on_order_close",
    icon:  "fa-money-bill-transfer",
    title: "Venda a mercat",
    desc:  "Notifica quan es ven un actiu a mercat \u2192 USDT.",
  },
  {
    key:   "tg_on_sl_modify",
    icon:  "fa-shield-halved",
    title: "Stop Loss modificat",
    desc:  "Notifica quan es modifica o es substitueix un Stop Loss (OCO, ordre individual o trailing).",
  },
  {
    key:   "tg_on_trailing_activate",
    icon:  "fa-route",
    title: "Trailing Stop activat",
    desc:  "Notifica quan un trailing stop s'activa (el preu supera el nivell d'activaci\u00f3 i l'OCO es converteix en trailing SL).",
  },
  {
    key:   "tg_on_market_scan" as keyof TgSettings,
    icon:  "fa-magnifying-glass-chart",
    title: "Escaneig de mercat",
    desc:  "Envia un resum a Telegram cada vegada que un bot avalua el mercat: s\u00edmbol, puntuaci\u00f3, veredicte i decisi\u00f3 (compra executada, sense senyal, multi-TF no confirmat, trailing actiu o om\u00e8s per pressupost/horari).",
  },
  {
    key:   "tg_on_motor_anomaly" as keyof TgSettings,
    icon:  "fa-triangle-exclamation",
    title: "Anomalia de motor",
    desc:  "Alerta si un motor no ha corregut en el temps esperat o ha retornat un error. M\u00e0xim 1 alerta cada 30 min per motor.",
  },
];

export default function SettingsTab() {
  const [settings,       setSettings]       = useState<Settings | null>(null);
  const [botStatus,      setBotStatus]      = useState<"unknown" | "ok" | "missing">("unknown");
  const [testState,      setTestState]      = useState<"idle" | "sending" | "ok" | "err">("idle");
  const [testErr,        setTestErr]        = useState("");
  const [saving,         setSaving]         = useState<string | null>(null);
  const [editTf,         setEditTf]         = useState<CfgInterval>("1h");
  const [editType,       setEditType]       = useState<CfgOrderType>("LIMIT");
  const [simConfigs,     setSimConfigs]     = useState<SavedConfig[]>([]);
  // Multi-bot state
  const [bots,           setBots]           = useState<Bot[]>([]);
  const [expandedBot,    setExpandedBot]    = useState<string | null>(null);
  const [showNewBotForm, setShowNewBotForm] = useState(false);
  const [newBotName,     setNewBotName]     = useState("");
  const [newBotSimId,    setNewBotSimId]    = useState("");
  const [newBotBudget,   setNewBotBudget]   = useState("500");
  const [newBotMaxDaily, setNewBotMaxDaily] = useState("3");
  const [newBotHoursFrom,   setNewBotHoursFrom]    = useState("8");
  const [newBotHoursTo,     setNewBotHoursTo]      = useState("22");
  const [newBotMultiTf,     setNewBotMultiTf]      = useState(false);
  const [newBotMinProb,     setNewBotMinProb]      = useState("");
  const [newBotMode,        setNewBotMode]         = useState<"paper" | "real">("paper");
  const [savingBot,      setSavingBot]      = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [sRes, statusRes] = await Promise.all([
        fetch("/api/settings", signal ? { signal } : {}),
        fetch("/api/settings/status", signal ? { signal } : {}),
      ]);
      if (sRes.ok)     setSettings(await sRes.json());
      if (statusRes.ok) {
        const s = await statusRes.json() as { configured: boolean };
        setBotStatus(s.configured ? "ok" : "missing");
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError")
        console.warn("[SettingsTab] load settings:", (err as Error).message);
    }
    if (signal?.aborted) return;
    fetch("/api/simulation/configs", signal ? { signal } : {})
      .then(r => r.json())
      .then((d: { configs?: SavedConfig[] }) => setSimConfigs(d.configs ?? []))
      .catch(err => { if ((err as Error).name !== "AbortError") console.warn("[SettingsTab] simulation/configs:", (err as Error).message); });
    fetch("/api/bots", signal ? { signal } : {})
      .then(r => r.json())
      .then((d: { bots?: Bot[] }) => setBots(d.bots ?? []))
      .catch(err => { if ((err as Error).name !== "AbortError") console.warn("[SettingsTab] bots:", (err as Error).message); });
  }, []);

  // D6: abort in-flight fetches when component unmounts
  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const setSetting = async (key: string, value: string) => {
    if (!settings) return;
    setSaving(key);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
      setSettings(prev => prev ? { ...prev, [key]: value } : prev);
    } finally { setSaving(null); }
  };

  const toggle = async (key: keyof TgSettings) => {
    if (!settings) return;
    const newVal = settings[key] === "1" ? "0" : "1";
    setSaving(key);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value: newVal }),
      });
      setSettings(prev => prev ? { ...prev, [key]: newVal } : prev);
    } finally { setSaving(null); }
  };

  const sendTest = async () => {
    setTestState("sending");
    setTestErr("");
    try {
      const res  = await fetch("/api/settings/telegram-test", { method: "POST" });
      const data = await res.json() as { ok: boolean; error?: string };
      if (data.ok) { setTestState("ok"); setTimeout(() => setTestState("idle"), 3000); }
      else         { setTestState("err"); setTestErr(data.error ?? "Error desconegut"); }
    } catch (e) { setTestState("err"); setTestErr(String(e)); }
  };

  const activeCount = settings
    ? NOTIFICATIONS.filter(n => settings[n.key] === "1").length
    : 0;

  /** Get a per-TF/type preset value, falling back to built-in default */
  const getPreset = (param: string, type?: CfgOrderType, tf?: CfgInterval): string => {
    const t  = type ?? editType;
    const i  = tf   ?? editTf;
    const k  = presetKey(param, t, i);
    return settings?.[k] ?? TF_PRESETS[i]?.[t]?.[param] ?? "";
  };

  const setPreset = (param: string, value: string) =>
    setSetting(presetKey(param, editType, editTf), value);

  /** Delete all saved keys for current TF+type so built-in defaults take over */
  const resetPreset = async () => {
    if (!settings) return;
    const params = ["entry_limit_offset_pct", "oco_tp_atr", "oco_sl_atr",
                    "oco_sl_limit_offset_pct", "trailing_activate_atr", "trailing_distance_atr"];
    for (const p of params) {
      const k = presetKey(p, editType, editTf);
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: k, value: TF_PRESETS[editTf][editType][p] ?? "" }),
      });
    }
    await load();
  };

  const tp  = parseFloat(getPreset("oco_tp_atr"));
  const sl  = parseFloat(getPreset("oco_sl_atr"));
  const rrRatio = sl > 0 ? (tp / sl).toFixed(2) : "—";
  const rrColor = sl > 0 && tp / sl >= 2 ? "var(--green)" : sl > 0 && tp / sl >= 1.5 ? "#d97706" : "var(--red)";

  /* ── Bot helpers ─────────────────────────────────────────────── */

  const reloadBots = () =>
    fetch("/api/bots")
      .then(r => r.json())
      .then((d: { bots?: Bot[] }) => setBots(d.bots ?? []))
      .catch(err => console.warn("[SettingsTab] reloadBots:", (err as Error).message));

  const createBot = async () => {
    if (!newBotName.trim() || !newBotSimId) return;
    setSavingBot("new");
    try {
      await fetch("/api/bots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:           newBotName.trim(),
          simId:          newBotSimId,
          budgetUsdt:     parseFloat(newBotBudget) || 500,
          maxDaily:       parseInt(newBotMaxDaily)  || 3,
          hoursFrom:      parseInt(newBotHoursFrom) || 8,
          hoursTo:        parseInt(newBotHoursTo)   || 22,
          requireMultiTf: newBotMultiTf,
          minProbability: newBotMinProb.trim() !== "" ? parseInt(newBotMinProb) : null,
          mode: newBotMode,
        }),
      });
      setNewBotName(""); setNewBotSimId(""); setNewBotBudget("500");
      setNewBotMaxDaily("3"); setNewBotHoursFrom("8"); setNewBotHoursTo("22");
      setNewBotMultiTf(false); setNewBotMode("paper"); setShowNewBotForm(false);
      await reloadBots();
    } finally { setSavingBot(null); }
  };

  const toggleBot = async (botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot) return;
    setSavingBot(botId);
    try {
      await fetch("/api/bots", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: botId, enabled: !bot.enabled }),
      });
      await reloadBots();
    } finally { setSavingBot(null); }
  };

  const deleteBot = async (botId: string) => {
    setSavingBot(botId);
    try {
      await fetch(`/api/bots?id=${botId}`, { method: "DELETE" });
      await reloadBots();
    } finally { setSavingBot(null); }
  };

  const patchBot = async (botId: string, patch: Record<string, unknown>) => {
    setSavingBot(botId);
    try {
      await fetch("/api/bots", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: botId, ...patch }),
      });
      await reloadBots();
    } finally { setSavingBot(null); }
  };

  return (
    <div className="settings-tab">

      {/* \u2500\u2500 3 stat cards \u2500\u2500 */}
      <div className="portfolio__cards">
        <div className={`portfolio__card portfolio__card--${
          botStatus === "ok" ? "blue" : botStatus === "missing" ? "red" : "neutral"
        }`}>
          <span className="portfolio__card-label">
            <i className="fa-brands fa-telegram" /> Telegram Bot
          </span>
          <span className="portfolio__card-value" style={{ fontSize: "1.1rem" }}>
            {botStatus === "ok" ? "Connectat" : botStatus === "missing" ? "No configurat" : "Comprovant\u2026"}
          </span>
          <span className="portfolio__card-sub">
            {botStatus === "ok"
              ? <span className="signal signal--green"><span className="signal__dot" /> Bot actiu i operatiu</span>
              : botStatus === "missing"
              ? <span className="signal signal--red"><span className="signal__dot" /> Token o Chat ID absents</span>
              : <span className="signal signal--grey"><span className="signal__dot" /> Carregant\u2026</span>
            }
          </span>
        </div>

        <div className={`portfolio__card portfolio__card--${activeCount > 0 ? "green" : "neutral"}`}>
          <span className="portfolio__card-label">
            <i className="fa-solid fa-bell" /> Notificacions
          </span>
          <span className="portfolio__card-value">{settings ? activeCount : "\u2014"}</span>
          <span className="portfolio__card-sub">
            {settings ? `de ${NOTIFICATIONS.length} activades` : "Carregant\u2026"}
          </span>
        </div>

        <div className={`portfolio__card portfolio__card--${settings?.entry_type === "MARKET" ? "neutral" : "blue"}`}>
          <span className="portfolio__card-label">
            <i className="fa-solid fa-piggy-bank" /> Capital per operació
          </span>
          <span className="portfolio__card-value" style={{ fontSize: "1.1rem" }}>
            {!settings
              ? "—"
              : (settings.capital_mode ?? "FIXED") === "FIXED"
              ? <><span className="mono">{settings.capital_fixed_usdt ?? "100"}</span>{" USDT"}</>
              : <><span className="mono">{settings.capital_pct_portfolio ?? "5"}</span>{"% portf."}</>}
          </span>
          <span className="portfolio__card-sub">
            Màx {settings?.capital_max_open ?? "3"} posicions obertes
          </span>
        </div>

        <div className={`portfolio__card portfolio__card--${bots.filter(b => b.enabled).length > 0 ? "green" : "neutral"}`}>
          <span className="portfolio__card-label">
            <i className="fa-solid fa-robot" /> Bots actius
          </span>
          <span className="portfolio__card-value portfolio__card-value--count">
            {bots.filter(b => b.enabled).length}
          </span>
          <span className="portfolio__card-sub">de {bots.length} configurats</span>
        </div>

        <div className="portfolio__card portfolio__card--neutral">
          <span className="portfolio__card-label">
            <i className="fa-solid fa-bolt" /> Tipus entrada
          </span>
          <span className="portfolio__card-value" style={{ fontSize: "1.1rem" }}>
            {settings?.entry_type ?? "LIMIT"}
          </span>
          <span className="portfolio__card-sub">mode d'execució d'ordres</span>
        </div>
      </div>

      {/* \u2500\u2500 Telegram section \u2500\u2500 */}
      <div className="analysis-section">
        <div className="portfolio__section-title">
          <i className="fa-brands fa-telegram" /> Telegram
        </div>

        {/* Bot status block */}
        <div className={`cfg-status cfg-status--${
          botStatus === "ok" ? "ok" : botStatus === "missing" ? "err" : "neutral"
        }`}>
          <div className="cfg-status__row">
            <span className={`signal signal--${
              botStatus === "ok" ? "green" : botStatus === "missing" ? "red" : "grey"
            }`}>
              <span className="signal__dot" />
              {botStatus === "ok"      ? "Bot configurat" :
               botStatus === "missing" ? "Bot no configurat" : "Comprovant configuraci\u00f3\u2026"}
            </span>
            {botStatus === "ok" && (
              <button
                className={`cfg-test-btn${
                  testState === "ok"  ? " cfg-test-btn--ok" :
                  testState === "err" ? " cfg-test-btn--err" : ""
                }`}
                onClick={sendTest}
                disabled={testState === "sending"}
              >
                {testState === "idle"    && <><i className="fa-solid fa-paper-plane" /> Enviar prova</>}
                {testState === "sending" && <><i className="fa-solid fa-spinner fa-spin" /> Enviant\u2026</>}
                {testState === "ok"      && <><i className="fa-solid fa-check" /> Enviat!</>}
                {testState === "err"     && <><i className="fa-solid fa-xmark" /> Error</>}
              </button>
            )}
          </div>
          {botStatus === "ok" && (
            <p className="cfg-status__desc">
              <code>TELEGRAM_BOT_TOKEN</code> i <code>TELEGRAM_CHAT_ID</code> presents al servidor.
            </p>
          )}
          {botStatus === "missing" && (
            <p className="cfg-status__desc">
              Afegeix <code>TELEGRAM_BOT_TOKEN</code> i <code>TELEGRAM_CHAT_ID</code> al fitxer{" "}
              <code>.env.local</code> (o a les variables d&apos;entorn de Vercel) i reinicia el servidor.
            </p>
          )}
          {testState === "err" && testErr && (
            <p className="cfg-status__error">{testErr}</p>
          )}
        </div>

        {/* Notification toggles */}
        <div className="cfg-toggles">
          {NOTIFICATIONS.map(({ key, icon, title, desc }) => {
            const enabled  = settings ? settings[key] === "1" : false;
            const isSaving = saving === key;
            return (
              <div key={key} className={`cfg-toggle-row${!enabled ? " cfg-toggle-row--off" : ""}`}>
                <i className={`fa-solid ${icon} cfg-toggle-row__icon`} />
                <div className="cfg-toggle-row__body">
                  <div className="cfg-toggle-row__title">{title}</div>
                  <div className="cfg-toggle-row__desc">{desc}</div>
                </div>
                <button
                  className={`cfg-switch${enabled ? " cfg-switch--on" : ""}`}
                  onClick={() => toggle(key)}
                  disabled={isSaving || !settings}
                  aria-label={enabled ? "Desactivar" : "Activar"}
                >
                  <span className="cfg-switch__thumb" />
                </button>
              </div>
            );
          })}

          {/* Multiplicador anomalia motor */}
          {settings?.tg_on_motor_anomaly === "1" && (
          <div className="cfg-toggle-row">
            <i className="fa-solid fa-clock cfg-toggle-row__icon" />
            <div className="cfg-toggle-row__body">
              <div className="cfg-toggle-row__title">Multiplicador de temps</div>
              <div className="cfg-toggle-row__desc">
                Alerta si el motor no ha corregut en <strong>N × interval</strong> esperat.
              </div>
            </div>
            <input
              type="number" min="1" max="20" step="1"
              className="cfg-num-input"
              value={settings?.motor_anomaly_multiplier ?? "3"}
              onChange={e => setSetting("motor_anomaly_multiplier", e.target.value)}
              style={{ width: "4rem" }}
            />
          </div>
          )}
        </div>
      </div>

      {/* ── Accions automàtiques ── */}
      <div className="analysis-section">
        <div className="portfolio__section-title">
          <i className="fa-solid fa-robot" /> Accions automàtiques
        </div>
        <div className="cfg-toggle-row">
          <i className="fa-solid fa-arrow-down-to-line cfg-toggle-row__icon" style={{ color: "var(--red)" }} />
          <div className="cfg-toggle-row__body">
            <div className="cfg-toggle-row__title">Vendre automàticament si el Stop Loss es cancel·la</div>
            <div className="cfg-toggle-row__desc">
              Si un Stop Loss (trailing o independent) s&apos;elimina externament sense executar-se,
              el sistema fa una venda a mercat automàtica per evitar deixar la posició sense protecció.
            </div>
          </div>
          <button
            className={`cfg-switch${settings?.cancel_auto_sell === "1" ? " cfg-switch--on" : ""}`}
            onClick={() => setSetting("cancel_auto_sell", settings?.cancel_auto_sell === "1" ? "0" : "1")}
            disabled={!settings || saving !== null}
            aria-label={settings?.cancel_auto_sell === "1" ? "Desactivar" : "Activar"}
          >
            <span className="cfg-switch__thumb" />
          </button>
        </div>

        {/* sl_sell_remaining */}
        <div className="cfg-toggle-row">
          <i className="fa-solid fa-shield-halved cfg-toggle-row__icon" style={{ color: "var(--red)" }} />
          <div className="cfg-toggle-row__body">
            <div className="cfg-toggle-row__title">Liquidar posició completa quan s&apos;executa el Stop Loss</div>
            <div className="cfg-toggle-row__desc">
              Després de qualsevol SL executat (estàndard o trailing), el sistema verifica el saldo lliure
              de la crypto i ven la resta a mercat automàticament. Garanteix que cap fragment quedi sense
              protecció.
            </div>
          </div>
          <button
            className={`cfg-switch${settings?.sl_sell_remaining === "1" ? " cfg-switch--on" : ""}`}
            onClick={() => setSetting("sl_sell_remaining", settings?.sl_sell_remaining === "1" ? "0" : "1")}
            disabled={!settings || saving !== null}
            aria-label={settings?.sl_sell_remaining === "1" ? "Desactivar" : "Activar"}
          >
            <span className="cfg-switch__thumb" />
          </button>
        </div>
      </div>

      {/* ── Entrada al mercat ── */}
      <div className="analysis-section">
        <div className="portfolio__section-title">
          <i className="fa-solid fa-arrow-right-to-bracket" /> Entrada al mercat
        </div>

        {/* Global default order type */}
        <div className="cfg-field-row">
          <i className="fa-solid fa-list-check cfg-toggle-row__icon" />
          <div className="cfg-toggle-row__body">
            <div className="cfg-toggle-row__title">Tipus d&apos;ordre per defecte</div>
            <div className="cfg-toggle-row__desc">Ordre usada quan fas una entrada. LIMIT col·loca per sota del preu; MARKET entra immediatament.</div>
          </div>
          <div className="cfg-seg">
            {(["LIMIT", "MARKET"] as const).map(t => (
              <button key={t}
                className={`cfg-seg__btn${settings?.entry_type === t ? " cfg-seg__btn--active" : ""}`}
                onClick={() => setSetting("entry_type", t)}
                disabled={!settings || saving !== null}
              >{t}</button>
            ))}
          </div>
        </div>

        {/* TF × type preset selector */}
        <div className="cfg-preset-header">
          <span className="cfg-preset-header__label">Paràmetres per time frame i tipus d&apos;ordre</span>
          <div className="cfg-preset-selectors">
            <div className="cfg-seg">
              {CFG_INTERVALS.map(tf => (
                <button key={tf}
                  className={`cfg-seg__btn${editTf === tf ? " cfg-seg__btn--active" : ""}`}
                  onClick={() => setEditTf(tf)}
                >{tf}</button>
              ))}
            </div>
            <div className="cfg-seg">
              {(["LIMIT", "MARKET"] as const).map(t => (
                <button key={t}
                  className={`cfg-seg__btn${editType === t ? " cfg-seg__btn--active" : ""}`}
                  onClick={() => setEditType(t)}
                >{t}</button>
              ))}
            </div>
            <button
              className="cfg-reset-btn"
              onClick={resetPreset}
              disabled={!settings || saving !== null}
              title="Restaurar valors per defecte per a aquest TF i tipus"
            >
              <i className="fa-solid fa-rotate-left" /> Reset
            </button>
          </div>
        </div>

        {/* Offset entrada (LIMIT only) */}
        {editType === "LIMIT" && (
          <div className="cfg-field-row">
            <i className="fa-solid fa-percent cfg-toggle-row__icon" />
            <div className="cfg-toggle-row__body">
              <div className="cfg-toggle-row__desc">Descompte sobre el preu actual per col·locar l&apos;ordre LIMIT (ex: 0.10 = −0.10%).</div>
            </div>
            <input type="number" step="0.01" min="0" max="5"
              className="cfg-num-input"
              value={getPreset("entry_limit_offset_pct")}
              disabled={!settings || saving !== null}
              onChange={e => setPreset("entry_limit_offset_pct", e.target.value)}
            />
          </div>
        )}

        {/* TP ATR */}
        <div className="cfg-field-row">
          <i className="fa-solid fa-arrow-trend-up cfg-toggle-row__icon" />
          <div className="cfg-toggle-row__body">
            <div className="cfg-toggle-row__title">Take Profit (× ATR)</div>
            <div className="cfg-toggle-row__desc">Distància del TP des del preu d&apos;entrada en múltiples d&apos;ATR.</div>
          </div>
          <input type="number" step="0.1" min="0.5" max="10"
            className="cfg-num-input"
            value={getPreset("oco_tp_atr")}
            disabled={!settings || saving !== null}
            onChange={e => setPreset("oco_tp_atr", e.target.value)}
          />
        </div>

        {/* SL ATR */}
        <div className="cfg-field-row">
          <i className="fa-solid fa-shield-halved cfg-toggle-row__icon" />
          <div className="cfg-toggle-row__body">
            <div className="cfg-toggle-row__title">Stop Loss (× ATR)</div>
            <div className="cfg-toggle-row__desc">Distància del SL des del preu d&apos;entrada en múltiples d&apos;ATR.</div>
          </div>
          <input type="number" step="0.1" min="0.2" max="5"
            className="cfg-num-input"
            value={getPreset("oco_sl_atr")}
            disabled={!settings || saving !== null}
            onChange={e => setPreset("oco_sl_atr", e.target.value)}
          />
        </div>

        {/* Live R:R badge */}
        <div className="cfg-rr-row">
          <span className="cfg-rr-row__label">Relació risc/benefici implícita</span>
          <span className="cfg-rr-row__value" style={{ color: rrColor }}>
            {rrRatio}<span className="cfg-rr-row__unit">:1</span>
            {sl > 0 && tp / sl >= 2   && <> &middot; <i className="fa-solid fa-check" /> Excel·lent</>}
            {sl > 0 && tp / sl >= 1.5 && tp / sl < 2 && <> &middot; <i className="fa-solid fa-triangle-exclamation" /> Acceptable</>}
            {sl > 0 && tp / sl < 1.5  && <> &middot; <i className="fa-solid fa-xmark" /> Massa baix</>}
          </span>
        </div>

        {/* SL limit offset (LIMIT only) */}
        {editType === "LIMIT" && (
          <div className="cfg-field-row">
            <i className="fa-solid fa-sliders cfg-toggle-row__icon" />
            <div className="cfg-toggle-row__body">
              <div className="cfg-toggle-row__title">Offset SL límit (%)</div>
              <div className="cfg-toggle-row__desc">Diferència entre Stop Price i Limit Price del SL de l&apos;OCO.</div>
            </div>
            <input type="number" step="0.01" min="0" max="2"
              className="cfg-num-input"
              value={getPreset("oco_sl_limit_offset_pct")}
              disabled={!settings || saving !== null}
              onChange={e => setPreset("oco_sl_limit_offset_pct", e.target.value)}
            />
          </div>
        )}

        {/* ── Trailing stop sub-section ── */}
        <div className="cfg-preset-header">
          <span className="cfg-preset-header__label"><i className="fa-solid fa-route" /> Trailing Stop</span>
          <div className="cfg-preset-selectors">
            <div className="cfg-seg">
              {(["ATR", "PIVOT_LOW"] as const).map(m => (
                <button key={m}
                  className={`cfg-seg__btn${(settings?.trailing_sl_mode ?? "ATR") === m ? " cfg-seg__btn--active" : ""}`}
                  onClick={() => setSetting("trailing_sl_mode", m)}
                  disabled={!settings || saving !== null}
                  title={m === "ATR" ? "Distància fixa en ATRs des del màxim" : "SL ancores al últim pivot low del gràfic"}
                >{m === "PIVOT_LOW" ? "Pivot Low" : "ATR"}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Trailing: activate (always shown) */}
        <div className="cfg-field-row">
          <i className="fa-solid fa-bolt cfg-toggle-row__icon" />
          <div className="cfg-toggle-row__body">
            <div className="cfg-toggle-row__title">Activar trailing (× ATR)</div>
            <div className="cfg-toggle-row__desc">Guany mínim des de l&apos;entrada per convertir el SL en trailing stop (vàlid per als dos modes).</div>
          </div>
          <input type="number" step="0.1" min="0.5" max="10"
            className="cfg-num-input"
            value={getPreset("trailing_activate_atr")}
            disabled={!settings || saving !== null}
            onChange={e => setPreset("trailing_activate_atr", e.target.value)}
          />
        </div>

        {/* Trailing ATR: distance (ATR mode only) */}
        {(settings?.trailing_sl_mode ?? "ATR") === "ATR" && (
          <div className="cfg-field-row">
            <i className="fa-solid fa-arrows-left-right cfg-toggle-row__icon" />
            <div className="cfg-toggle-row__body">
              <div className="cfg-toggle-row__title">Distància trailing (× ATR)</div>
              <div className="cfg-toggle-row__desc">Retrocés permès des del màxim assolit abans de moure el SL.</div>
            </div>
            <input type="number" step="0.1" min="0.2" max="5"
              className="cfg-num-input"
              value={getPreset("trailing_distance_atr")}
              disabled={!settings || saving !== null}
              onChange={e => setPreset("trailing_distance_atr", e.target.value)}
            />
          </div>
        )}

        {/* Pivot Low mode: TF selector + offset */}
        {(settings?.trailing_sl_mode ?? "ATR") === "PIVOT_LOW" && (<>
          <div className="cfg-field-row">
            <i className="fa-solid fa-clock cfg-toggle-row__icon" />
            <div className="cfg-toggle-row__body">
              <div className="cfg-toggle-row__title">Time frame pels pivots</div>
              <div className="cfg-toggle-row__desc">
                El motor detectarà el swing low més recent en aquest time frame i hi ancorarà el SL.
                Usa el mateix TF que el teu anàlisi principal.
              </div>
            </div>
            <div className="cfg-seg">
              {CFG_INTERVALS.map(tf => (
                <button key={tf}
                  className={`cfg-seg__btn${(settings?.trailing_pivot_tf ?? "1h") === tf ? " cfg-seg__btn--active" : ""}`}
                  onClick={() => setSetting("trailing_pivot_tf", tf)}
                  disabled={!settings || saving !== null}
                >{tf}</button>
              ))}
            </div>
          </div>
          <div className="cfg-field-row">
            <i className="fa-solid fa-down-long cfg-toggle-row__icon" />
            <div className="cfg-toggle-row__body">
              <div className="cfg-toggle-row__title">Marge sota el pivot (%)</div>
              <div className="cfg-toggle-row__desc">
                Petit biaix per sota del pivot low per evitar que el SL estigi al preu exacte
                (ex: 0.1 = −0.1% del pivot).
              </div>
            </div>
            <input type="number" step="0.05" min="0" max="2"
              className="cfg-num-input"
              value={settings?.trailing_pivot_offset_pct ?? DEFAULTS.trailing_pivot_offset_pct}
              disabled={!settings || saving !== null}
              onChange={e => setSetting("trailing_pivot_offset_pct", e.target.value)}
            />
          </div>
          <div className="cfg-rr-row" style={{ justifyContent: "flex-start", gap: "0.5rem" }}>
            <i className="fa-solid fa-circle-info" style={{ color: "var(--accent)", fontSize: "0.7rem" }} />
            <span className="cfg-rr-row__label" style={{ textTransform: "none", letterSpacing: 0 }}>
              El motor moure el SL amunt cada vegada que es forma un nou pivot low
              per sobre del SL actual — no cal un nou màxim de preu.
            </span>
          </div>
        </> )}
      </div>

      {/* ── Capital i prioritats ── */}
      <div className="analysis-section">
        <div className="portfolio__section-title">
          <i className="fa-solid fa-piggy-bank" /> Capital i prioritats
        </div>

        {/* Capital mode */}
        <div className="cfg-field-row">
          <i className="fa-solid fa-wallet cfg-toggle-row__icon" />
          <div className="cfg-toggle-row__body">
            <div className="cfg-toggle-row__title">Mode de capital</div>
            <div className="cfg-toggle-row__desc">FIXED usa un import fix en USDT per operació; PCT calcula el % del saldo disponible en el moment de l&apos;entrada.</div>
          </div>
          <div className="cfg-seg">
            {(["FIXED", "PCT"] as const).map(m => (
              <button key={m}
                className={`cfg-seg__btn${(settings?.capital_mode ?? "FIXED") === (m === "PCT" ? "PCT_PORTFOLIO" : "FIXED") ? " cfg-seg__btn--active" : ""}`}
                onClick={() => setSetting("capital_mode", m === "PCT" ? "PCT_PORTFOLIO" : "FIXED")}
                disabled={!settings || saving !== null}
              >{m}</button>
            ))}
          </div>
        </div>

        {/* Fixed USDT */}
        {(settings?.capital_mode ?? "FIXED") === "FIXED" && (
          <div className="cfg-field-row">
            <i className="fa-solid fa-dollar-sign cfg-toggle-row__icon" />
            <div className="cfg-toggle-row__body">
              <div className="cfg-toggle-row__title">Import per operació (USDT)</div>
              <div className="cfg-toggle-row__desc">Quantitat fixa en USDT que s&apos;invertirà a cada entrada (ex: 100 = 100 USDT per trade).</div>
            </div>
            <input type="number" step="10" min="1" max="100000"
              className="cfg-num-input" style={{ width: "88px" }}
              value={settings?.capital_fixed_usdt ?? DEFAULTS.capital_fixed_usdt}
              disabled={!settings || saving !== null}
              onChange={e => setSetting("capital_fixed_usdt", e.target.value)}
            />
          </div>
        )}

        {/* PCT portfolio */}
        {(settings?.capital_mode ?? "FIXED") === "PCT_PORTFOLIO" && (
          <div className="cfg-field-row">
            <i className="fa-solid fa-chart-pie cfg-toggle-row__icon" />
            <div className="cfg-toggle-row__body">
              <div className="cfg-toggle-row__title">% del portafoli per operació</div>
              <div className="cfg-toggle-row__desc">Percentatge del saldo USDT disponible destinat a cada entrada (ex: 5 = 5% del saldo lliure).</div>
            </div>
            <input type="number" step="0.5" min="0.5" max="100"
              className="cfg-num-input"
              value={settings?.capital_pct_portfolio ?? DEFAULTS.capital_pct_portfolio}
              disabled={!settings || saving !== null}
              onChange={e => setSetting("capital_pct_portfolio", e.target.value)}
            />
          </div>
        )}

        {/* Max open positions */}
        <div className="cfg-field-row">
          <i className="fa-solid fa-layer-group cfg-toggle-row__icon" />
          <div className="cfg-toggle-row__body">
            <div className="cfg-toggle-row__title">Màxim posicions obertes</div>
            <div className="cfg-toggle-row__desc">Nombre màxim de trades oberts simultàniament. El sistema blocquejarà noves entrades quan s&apos;arribi al límit.</div>
          </div>
          <input type="number" step="1" min="1" max="20"
            className="cfg-num-input" style={{ width: "56px" }}
            value={settings?.capital_max_open ?? DEFAULTS.capital_max_open}
            disabled={!settings || saving !== null}
            onChange={e => setSetting("capital_max_open", e.target.value)}
          />
        </div>

        {/* Pair priority toggles */}
        <div className="cfg-preset-header">
          <span className="cfg-preset-header__label"><i className="fa-solid fa-star" /> Cryptos actives</span>
          <span className="cfg-rr-row__label" style={{ marginLeft: "auto", letterSpacing: 0, textTransform: "none" }}>
            {settings
              ? (() => { const en = (settings.priority_pairs ?? DEFAULTS.priority_pairs).split(",").filter(Boolean); return `${en.length} de ${ALL_PAIRS.length} activades`; })()
              : "Carregant…"}
          </span>
        </div>
        <div className="cfg-toggles">
          {ALL_PAIRS.map(({ symbol, pair, color, iconCls }) => {
            const enabled = settings
              ? (settings.priority_pairs ?? DEFAULTS.priority_pairs).split(",").includes(pair)
              : true;
            const isSaving = saving === `priority_${pair}`;
            const toggle = async () => {
              if (!settings) return;
              const current = (settings.priority_pairs ?? DEFAULTS.priority_pairs).split(",").filter(Boolean);
              const next = enabled
                ? current.filter(p => p !== pair)
                : [...current, pair];
              // Keep at least 1 pair active
              if (next.length === 0) return;
              setSaving(`priority_${pair}`);
              try {
                await fetch("/api/settings", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ key: "priority_pairs", value: next.join(",") }),
                });
                setSettings(prev => prev ? { ...prev, priority_pairs: next.join(",") } : prev);
              } finally { setSaving(null); }
            };
            return (
              <div key={pair} className={`cfg-toggle-row${!enabled ? " cfg-toggle-row--off" : ""}`}>
                <i
                  className={`${iconCls} cfg-toggle-row__icon`}
                  style={{ color: enabled ? color : undefined }}
                />
                <div className="cfg-toggle-row__body">
                  <div className="cfg-toggle-row__title">{symbol}</div>
                  <div className="cfg-toggle-row__desc">{pair} · {enabled ? <span style={{ color: "var(--green)", fontWeight: 700 }}>Activa</span> : <span style={{ color: "var(--text-3)" }}>Inactiva — ignorada en l&apos;anàlisi</span>}</div>
                </div>
                <button
                  className={`cfg-switch${enabled ? " cfg-switch--on" : ""}`}
                  onClick={toggle}
                  disabled={isSaving || !settings}
                  aria-label={enabled ? "Desactivar" : "Activar"}
                >
                  <span className="cfg-switch__thumb" />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Bots de trading automàtic ── */}
      <div className="analysis-section">
        <div className="portfolio__section-title" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span><i className="fa-solid fa-robot" /> Bots de trading automàtic</span>
          <button
            className="btn-secondary"
            style={{ fontSize: "0.72rem", padding: "0.25rem 0.7rem", height: "26px" }}
            onClick={() => setShowNewBotForm(v => !v)}
          >
            {showNewBotForm ? <><i className="fa-solid fa-xmark" /> Cancel·lar</> : <><i className="fa-solid fa-plus" /> Nou</>}
          </button>
        </div>

        {/* Master switch */}
        <div className="cfg-toggle-row">
          <i className="fa-solid fa-bolt cfg-toggle-row__icon"
            style={{ color: settings?.auto_trade_enabled === "1" ? "var(--green)" : undefined }} />
          <div className="cfg-toggle-row__body">
            <div className="cfg-toggle-row__title">Master switch — tots els bots</div>
            <div className="cfg-toggle-row__desc">Quan està desactivat, cap bot opera, independentment de la seva configuració individual.</div>
          </div>
          <button
            className={`cfg-switch${settings?.auto_trade_enabled === "1" ? " cfg-switch--on" : ""}`}
            onClick={() => setSetting("auto_trade_enabled", settings?.auto_trade_enabled === "1" ? "0" : "1")}
            disabled={!settings || saving !== null}
            aria-label="Master switch bots"
          >
            <span className="cfg-switch__thumb" />
          </button>
        </div>

        {/* Active warning */}
        {settings?.auto_trade_enabled === "1" && bots.some(b => b.enabled) && (
          <div className="cfg-auto-warning">
            <i className="fa-solid fa-triangle-exclamation" />
            {" "}{bots.filter(b => b.enabled).length} bot{bots.filter(b => b.enabled).length !== 1 ? "s" : ""} actiu{bots.filter(b => b.enabled).length !== 1 ? "s" : ""}. El sistema executarà compres automàticament.
          </div>
        )}

        {/* New bot form */}
        {showNewBotForm && (
          <div className="bot-form">
            <div className="bot-form__title"><i className="fa-solid fa-plus-circle" /> Nou bot</div>
            <div className="bot-form__row">
              <label className="bot-form__label">Nom</label>
              <input
                type="text" className="bot-form__text-input" placeholder="Ex: BTC 1h Golden Cross"
                value={newBotName} onChange={e => setNewBotName(e.target.value)}
              />
            </div>
            <div className="bot-form__row">
              <label className="bot-form__label">Simulació</label>
              <select
                className="cfg-method-select" style={{ flex: 1 }}
                value={newBotSimId} onChange={e => setNewBotSimId(e.target.value)}
              >
                <option value="">(Selecciona una simulació)</option>
                {simConfigs.map(sc => (
                  <option key={sc.id} value={sc.id}>
                    {sc.name}{sc.pnlPct !== undefined ? ` · ${sc.pnlPct >= 0 ? "+" : ""}${sc.pnlPct.toFixed(1)}%` : ""}
                  </option>
                ))}
              </select>
            </div>
            {/* Preview sim params */}
            {newBotSimId && (() => {
              const sc = simConfigs.find(c => c.id === newBotSimId);
              if (!sc) return null;
              return (
                <div className="bot-form__sim-preview">
                  <span><i className="fa-solid fa-clock" /> {sc.config.interval}</span>
                  <span><i className="fa-solid fa-coins" /> {sc.config.symbols.map(s => s.replace("USDT","")).join(", ")}</span>
                  <span>TP {sc.config.tpAtr}× · SL {sc.config.slAtr}×</span>
                  <span>Trail {sc.config.trailActivateAtr}×/{sc.config.trailDistanceAtr}×</span>
                  <span>Score ≥ {sc.effectiveConfig?.minProbability ?? 80}%</span>
                  <span>
                    {sc.config.capitalMode === "FIXED"
                      ? `${sc.config.capitalFixed ?? 100} USDT/op`
                      : sc.config.capitalMode === "PCT"
                      ? `${sc.config.capitalPct ?? 10}% portf./op`
                      : `${sc.config.amBasePct ?? 60}% (Anti-M.)/op`}
                  </span>
                </div>
              );
            })()}
            <div className="bot-form__row">
              <label className="bot-form__label">Pressupost (USDT)</label>
              <input type="number" step="50" min="10" max="100000" className="cfg-num-input" style={{ width: "80px" }}
                value={newBotBudget} onChange={e => setNewBotBudget(e.target.value)} />
            </div>
            <div className="bot-form__row">
              <label className="bot-form__label">Màx/dia</label>
              <input type="number" step="1" min="1" max="20" className="cfg-num-input" style={{ width: "60px" }}
                value={newBotMaxDaily} onChange={e => setNewBotMaxDaily(e.target.value)} />
            </div>
            <div className="bot-form__row">
              <label className="bot-form__label">Finestra (UTC)</label>
              <div className="cfg-auto-hours">
                <input type="number" step="1" min="0" max="23" className="cfg-num-input" style={{ width: "52px" }}
                  value={newBotHoursFrom} onChange={e => setNewBotHoursFrom(e.target.value)} />
                <span className="cfg-auto-hours__sep">–</span>
                <input type="number" step="1" min="1" max="24" className="cfg-num-input" style={{ width: "52px" }}
                  value={newBotHoursTo} onChange={e => setNewBotHoursTo(e.target.value)} />
                <span className="cfg-auto-hours__sep">h</span>
              </div>
            </div>
            <div className="bot-form__row">
              <label className="bot-form__label">Score mínim (%)</label>
              <input type="number" step="5" min="50" max="95" className="cfg-num-input" style={{ width: "60px" }}
                placeholder="sim" value={newBotMinProb} onChange={e => setNewBotMinProb(e.target.value)} />
            </div>
            <div className="bot-form__row">
              <label className="bot-form__label">Multi-TF</label>
              <button
                className={`cfg-switch${newBotMultiTf ? " cfg-switch--on" : ""}`}
                onClick={() => setNewBotMultiTf(v => !v)}
                aria-label="Multi-TF"
              >
                <span className="cfg-switch__thumb" />
              </button>
            </div>
            <div className="bot-form__row">
              <label className="bot-form__label">Mode</label>
              <div style={{ display: "flex", gap: "6px" }}>
                <button
                  className={`cfg-mode-btn${newBotMode === "paper" ? " cfg-mode-btn--active" : ""}`}
                  onClick={() => setNewBotMode("paper")}
                >PAPER</button>
                <button
                  className={`cfg-mode-btn cfg-mode-btn--real${newBotMode === "real" ? " cfg-mode-btn--active" : ""}`}
                  onClick={() => setNewBotMode("real")}
                  title="Trading real (Binance Mainnet) — assegura't de tenir les claus reals configurades"
                >REAL</button>
              </div>
            </div>
            <div className="bot-form__actions">
              <button
                className="btn-primary"
                onClick={createBot}
                disabled={!newBotName.trim() || !newBotSimId || savingBot === "new"}
              >
                {savingBot === "new"
                  ? <><i className="fa-solid fa-spinner fa-spin" /> Creant…</>
                  : <><i className="fa-solid fa-check" /> Crear bot</>}
              </button>
            </div>
          </div>
        )}

        {/* Bot list */}
        {bots.length === 0 && !showNewBotForm && (
          <div className="bot-empty">
            <i className="fa-solid fa-robot" style={{ fontSize: "1.5rem", opacity: 0.3 }} />
            <span>Cap bot configurat. Crea el primer bot per automatitzar el trading.</span>
          </div>
        )}

        {bots.map(bot => {
          const isExpanded = expandedBot === bot.id;
          const sc = bot.simConfig;
          const masterOn = settings?.auto_trade_enabled === "1";
          return (
            <div key={bot.id} className={`bot-card${!bot.enabled || !masterOn ? " bot-card--disabled" : ""}`}>
              <div className="bot-card__header">
                <button
                  className={`cfg-switch${bot.enabled ? " cfg-switch--on" : ""}`}
                  onClick={() => toggleBot(bot.id)}
                  disabled={savingBot === bot.id}
                  aria-label={`Toggle ${bot.name}`}
                  style={{ flexShrink: 0 }}
                >
                  <span className="cfg-switch__thumb" />
                </button>
                <button
                  className="bot-card__name"
                  onClick={() => setExpandedBot(isExpanded ? null : bot.id)}
                >
                  {bot.name}
                  {sc && <span className="bot-card__badge">{sc.config.interval} · {sc.config.symbols.length} parells</span>}
                  <span className={`bot-card__mode-badge${bot.mode === "real" ? " bot-card__mode-badge--real" : ""}`}>{bot.mode === "real" ? "REAL" : "PAPER"}</span>
                </button>
                <div className="bot-card__actions">
                  <button
                    className="bot-card__expand-btn"
                    onClick={() => setExpandedBot(isExpanded ? null : bot.id)}
                    title={isExpanded ? "Plegar" : "Expandir"}
                  >
                    <i className={`fa-solid fa-chevron-${isExpanded ? "up" : "down"}`} />
                  </button>
                  <button
                    className="bot-card__delete-btn"
                    onClick={() => { if (confirm(`Eliminar bot "${bot.name}"?`)) deleteBot(bot.id); }}
                    disabled={savingBot === bot.id}
                    title="Eliminar bot"
                  >
                    <i className="fa-solid fa-trash-can" />
                  </button>
                </div>
              </div>

              {isExpanded && (
                <div className="bot-card__body">
                  {/* Read-only sim params */}
                  {sc ? (
                    <div className="bot-card__params">
                      <div className="bot-card__param-group-title">Paràmetres de simulació (read-only)</div>
                      <div className="bot-card__param-grid">
                        <div className="bot-card__param"><span className="bot-card__param-label">Interval</span><span className="bot-card__param-value">{sc.config.interval}</span></div>
                        <div className="bot-card__param"><span className="bot-card__param-label">Parells</span><span className="bot-card__param-value">{sc.config.symbols.map(s => s.replace("USDT","")).join(", ")}</span></div>
                        <div className="bot-card__param"><span className="bot-card__param-label">TP</span><span className="bot-card__param-value">{sc.config.tpAtr}× ATR</span></div>
                        <div className="bot-card__param"><span className="bot-card__param-label">SL</span><span className="bot-card__param-value">{sc.config.slAtr}× ATR</span></div>
                        <div className="bot-card__param"><span className="bot-card__param-label">Trail act.</span><span className="bot-card__param-value">{sc.config.trailActivateAtr}× ATR</span></div>
                        <div className="bot-card__param"><span className="bot-card__param-label">Trail dist.</span><span className="bot-card__param-value">{sc.config.trailDistanceAtr}× ATR</span></div>
                        <div className="bot-card__param"><span className="bot-card__param-label">Score mín.</span><span className="bot-card__param-value">{bot.minProbability ?? sc.effectiveConfig?.minProbability ?? 80}%</span></div>
                        <div className="bot-card__param"><span className="bot-card__param-label">Capital/op.</span><span className="bot-card__param-value">
                          {sc.config.capitalMode === "FIXED"
                            ? `${sc.config.capitalFixed ?? 100} USDT`
                            : sc.config.capitalMode === "PCT"
                            ? `${sc.config.capitalPct ?? 10}% portf.`
                            : `${sc.config.amBasePct ?? 60}% (Anti-M.)`}
                        </span></div>
                      </div>
                    </div>
                  ) : (
                    <div className="bot-card__param-group-title" style={{ color: "var(--red)" }}>
                      <i className="fa-solid fa-triangle-exclamation" /> Simulació no trobada (ID: {bot.simId})
                    </div>
                  )}

                  {/* Editable operational params */}
                  <div className="bot-card__param-group-title" style={{ marginTop: "0.75rem" }}>Paràmetres operatius</div>

                  <div className="cfg-field-row" style={{ borderBottom: "none" }}>
                    <i className="fa-solid fa-wallet cfg-toggle-row__icon" />
                    <div className="cfg-toggle-row__body">
                      <div className="cfg-toggle-row__title">Pressupost (USDT)</div>
                      <div className="cfg-toggle-row__desc">Capital màxim compromès simultàniament.</div>
                    </div>
                    <input type="number" step="50" min="10" max="100000" className="cfg-num-input" style={{ width: "80px" }}
                      defaultValue={bot.budgetUsdt}
                      onBlur={e => patchBot(bot.id, { budgetUsdt: parseFloat(e.target.value) || bot.budgetUsdt })}
                      disabled={savingBot === bot.id}
                    />
                  </div>

                  <div className="cfg-field-row" style={{ borderBottom: "none" }}>
                    <i className="fa-solid fa-list-ol cfg-toggle-row__icon" />
                    <div className="cfg-toggle-row__body">
                      <div className="cfg-toggle-row__title">Màx. operacions/dia</div>
                      <div className="cfg-toggle-row__desc">Límit diari de compres automàtiques.</div>
                    </div>
                    <input type="number" step="1" min="1" max="20" className="cfg-num-input" style={{ width: "60px" }}
                      defaultValue={bot.maxDaily}
                      onBlur={e => patchBot(bot.id, { maxDaily: parseInt(e.target.value) || bot.maxDaily })}
                      disabled={savingBot === bot.id}
                    />
                  </div>

                  <div className="cfg-field-row" style={{ borderBottom: "none" }}>
                    <i className="fa-solid fa-hourglass-half cfg-toggle-row__icon" />
                    <div className="cfg-toggle-row__body">
                      <div className="cfg-toggle-row__title">Finestra horària (UTC)</div>
                    </div>
                    <div className="cfg-auto-hours">
                      <input type="number" step="1" min="0" max="23" className="cfg-num-input" style={{ width: "52px" }}
                        defaultValue={bot.hoursFrom}
                        onBlur={e => patchBot(bot.id, { hoursFrom: parseInt(e.target.value) })}
                        disabled={savingBot === bot.id}
                      />
                      <span className="cfg-auto-hours__sep">–</span>
                      <input type="number" step="1" min="1" max="24" className="cfg-num-input" style={{ width: "52px" }}
                        defaultValue={bot.hoursTo}
                        onBlur={e => patchBot(bot.id, { hoursTo: parseInt(e.target.value) })}
                        disabled={savingBot === bot.id}
                      />
                      <span className="cfg-auto-hours__sep">h</span>
                    </div>
                  </div>

                  <div className={`cfg-toggle-row${!bot.requireMultiTf ? " cfg-toggle-row--off" : ""}`} style={{ border: "none", paddingTop: "0.5rem" }}>
                    <i className="fa-solid fa-layer-group cfg-toggle-row__icon" />
                    <div className="cfg-toggle-row__body">
                      <div className="cfg-toggle-row__title">Requerir confirmació multi-TF</div>
                      <div className="cfg-toggle-row__desc">Confirma el senyal en el TF superior abans de comprar.</div>
                    </div>
                    <button
                      className={`cfg-switch${bot.requireMultiTf ? " cfg-switch--on" : ""}`}
                      onClick={() => patchBot(bot.id, { requireMultiTf: !bot.requireMultiTf })}
                      disabled={savingBot === bot.id}
                      aria-label="Multi-TF"
                    >
                      <span className="cfg-switch__thumb" />
                    </button>
                  </div>

                  <div className="cfg-field-row" style={{ borderBottom: "none" }}>
                    <i className="fa-solid fa-percent cfg-toggle-row__icon" />
                    <div className="cfg-toggle-row__body">
                      <div className="cfg-toggle-row__title">Score mínim (%)</div>
                      <div className="cfg-toggle-row__desc">Buit = usa el de la simulació ({sc?.effectiveConfig?.minProbability ?? 80}%).</div>
                    </div>
                    <input type="number" step="5" min="50" max="95" className="cfg-num-input" style={{ width: "60px" }}
                      defaultValue={bot.minProbability ?? ""}
                      placeholder={String(sc?.effectiveConfig?.minProbability ?? 80)}
                      onBlur={e => {
                        const v = e.target.value.trim();
                        patchBot(bot.id, { minProbability: v !== "" ? parseInt(v) : null });
                      }}
                      disabled={savingBot === bot.id}
                    />
                  </div>

                  <div className="cfg-field-row" style={{ borderBottom: "none" }}>
                    <i className="fa-solid fa-cubes cfg-toggle-row__icon" />
                    <div className="cfg-toggle-row__body">
                      <div className="cfg-toggle-row__title">Màx. posicions simultànies</div>
                      <div className="cfg-toggle-row__desc">Buit = sense límit de posicions obertes.</div>
                    </div>
                    <input type="number" step="1" min="1" max="20" className="cfg-num-input" style={{ width: "60px" }}
                      defaultValue={bot.maxOpen ?? ""}
                      placeholder="—"
                      onBlur={e => {
                        const v = e.target.value.trim();
                        patchBot(bot.id, { maxOpen: v !== "" ? parseInt(v) : null });
                      }}
                      disabled={savingBot === bot.id}
                    />
                  </div>

                  <div className="cfg-field-row" style={{ borderBottom: "none" }}>
                    <i className="fa-solid fa-toggle-on cfg-toggle-row__icon" />
                    <div className="cfg-toggle-row__body">
                      <div className="cfg-toggle-row__title">Mode</div>
                      <div className="cfg-toggle-row__desc">Paper = Testnet · Real = Mainnet Binance.</div>
                    </div>
                    <div style={{ display: "flex", gap: "4px" }}>
                      <button
                        className={`cfg-mode-btn${bot.mode !== "real" ? " cfg-mode-btn--active" : ""}`}
                        onClick={() => patchBot(bot.id, { mode: "paper" })}
                        disabled={savingBot === bot.id}
                      >PAPER</button>
                      <button
                        className={`cfg-mode-btn cfg-mode-btn--real${bot.mode === "real" ? " cfg-mode-btn--active" : ""}`}
                        onClick={() => {
                          if (!confirm(`Canviar el bot "${bot.name}" a mode REAL? Les seves ordres aniran a Binance Mainnet.`)) return;
                          patchBot(bot.id, { mode: "real" });
                        }}
                        disabled={savingBot === bot.id}
                      >REAL</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

    </div>
  );
}
