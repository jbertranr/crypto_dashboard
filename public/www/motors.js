/* Motors — Mobile view */

const REFRESH_INTERVAL = 30;
let countdown    = REFRESH_INTERVAL;
let refreshTimer = null;
let isFetching   = false;

// ── Helpers ───────────────────────────────────────────────────────────────────

const el      = id => document.getElementById(id);
const esc     = s  => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const setHtml = (id, html) => el(id).innerHTML = html;
const empty   = msg => `<div class="empty">${msg}</div>`;

function timeAgo(ts) {
  if (!ts) return "mai";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5)  return "ara";
  if (s < 60) return `fa ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `fa ${m}m`;
  return `fa ${Math.floor(m / 60)}h`;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async function doLogin(username, password) {
  const r = await fetch(API_BASE + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ username, password }),
  });
  return r.ok;
}

// ── Motors ────────────────────────────────────────────────────────────────────

function motorState(d) {
  if (!d || !d.started) return "offline";
  if (d.running) return "running";
  if (d.lastResult?.startsWith("error") || d.lastResult?.startsWith("crash")) return "error";
  return "ok";
}

const MOTOR_ICON = {
  autoTrader:   "fa-robot",
  orderMonitor: "fa-magnifying-glass",
  trailing:     "fa-shield-halved",
  crashMonitor: "fa-triangle-exclamation",
  scheduler:    "fa-clock",
};
const MOTOR_LABEL = {
  autoTrader:   "Auto-Trader",
  orderMonitor: "Order Monitor",
  trailing:     "Trailing Engine",
  crashMonitor: "Crash Monitor",
  scheduler:    "Scheduler",
};
const MOTOR_DESC = {
  autoTrader:   "Detecta oportunitats i obre posicions automàticament. Inclou reintent d'OCO fallides i vigilància de posicions sense stop-loss (correcció automàtica als 5 min).",
  orderMonitor: "Monitoritza les ordres obertes i gestiona fills",
  trailing:     "Gestiona trailing stops per protegir beneficis",
  crashMonitor: "Detecta caigudes brusques de preus i actua",
  scheduler:    "Executa tasques periòdiques i informes horaris",
};
const MOTOR_GRADIENT = {
  autoTrader:   "linear-gradient(145deg,#6366f1,#818cf8)",
  orderMonitor: "linear-gradient(145deg,#3b82f6,#60a5fa)",
  trailing:     "linear-gradient(145deg,#10b981,#34d399)",
  crashMonitor: "linear-gradient(145deg,#f59e0b,#fbbf24)",
  scheduler:    "linear-gradient(145deg,#06b6d4,#22d3ee)",
};
const STATUS_LABEL = { ok: "Actiu", running: "Executant", error: "Error", offline: "Offline" };

function renderMotorsHero(status) {
  const keys   = ["autoTrader","orderMonitor","trailing","crashMonitor","scheduler"];
  const states = keys.map(k => motorState(status[k]));
  const total   = keys.length;
  const errors  = states.filter(s => s === "error").length;
  const offline = states.filter(s => s === "offline").length;
  const active  = total - offline;

  el("motors-hero-value").textContent = `${active} / ${total}`;

  let sub, iconCls;
  if (errors > 0) {
    sub     = `${errors} error${errors > 1 ? "s" : ""} detectat${errors > 1 ? "s" : ""}`;
    iconCls = "fa-solid fa-triangle-exclamation pt-hero-icon";
  } else if (offline > 0) {
    sub     = `${offline} motor${offline > 1 ? "s" : ""} offline`;
    iconCls = "fa-solid fa-circle-xmark pt-hero-icon";
  } else {
    sub     = "Tots els motors operatius";
    iconCls = "fa-solid fa-circle-check pt-hero-icon";
  }
  el("motors-hero-icon").className = iconCls;
  el("motors-hero-sub").textContent = sub;
}

function renderMotors(status) {
  renderMotorsHero(status);
  const keys = ["autoTrader","orderMonitor","trailing","crashMonitor","scheduler"];
  setHtml("motors-body", keys.map(key => {
    const d     = status[key];
    const state = motorState(d);
    const ago   = d?.lastRun ? timeAgo(d.lastRun) : "—";
    const showResult = d?.lastResult && d.lastResult !== "ok" && d.lastResult !== "success";
    const lastResult = showResult ? `<div class="motor-result">${esc(d.lastResult)}</div>` : "";
    return `<div class="item-row motor-row">
      <div class="avatar" style="background:${MOTOR_GRADIENT[key]}">
        <i class="fa-solid ${MOTOR_ICON[key]}"></i>
      </div>
      <div class="item-info">
        <div class="item-name">${MOTOR_LABEL[key]}</div>
        <div class="item-meta">${esc(MOTOR_DESC[key])}</div>
        ${lastResult}
      </div>
      <div class="motor-status">
        <div class="status-dot ${state}"></div>
        <div class="motor-state-label ${state}">${STATUS_LABEL[state]}</div>
        <div class="motor-ago">${ago}</div>
      </div>
    </div>`;
  }).join(""));
}

// ── Operations ────────────────────────────────────────────────────────────────

const BADGE_CLASS = {
  fill: "badge-green", trailing: "badge-indigo", bot_buy: "badge-green",
  bot_scan: "badge-blue", warn: "badge-amber", error: "badge-red",
  system: "badge-grey", data: "badge-grey", scheduler: "badge-grey",
};
const ACT_GRADIENT = {
  fill:      "linear-gradient(145deg,#10b981,#34d399)",
  trailing:  "linear-gradient(145deg,#6366f1,#818cf8)",
  bot_buy:   "linear-gradient(145deg,#10b981,#34d399)",
  bot_scan:  "linear-gradient(145deg,#3b82f6,#60a5fa)",
  warn:      "linear-gradient(145deg,#f59e0b,#fbbf24)",
  error:     "linear-gradient(145deg,#ef4444,#fb7185)",
  system:    "linear-gradient(145deg,#94a3b8,#cbd5e1)",
  data:      "linear-gradient(145deg,#94a3b8,#cbd5e1)",
  scheduler: "linear-gradient(145deg,#06b6d4,#22d3ee)",
};

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString("ca-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function renderOperations(items) {
  if (!items?.length) { setHtml("ops-body", empty("Cap operació recent")); return; }

  // Accumulate identical operations (same label + badge)
  const grouped = [];
  for (const item of items) {
    const label = item.qtype || item.msg;
    const last  = grouped[grouped.length - 1];
    if (last && last.label === label && last.badge === item.badge) {
      last.count++;
      // keep earliest ts for detail, latest already set
    } else {
      grouped.push({ ...item, label, count: 1 });
    }
    if (grouped.length >= 20) break;
  }

  setHtml("ops-body", grouped.map(item => {
    const grad     = ACT_GRADIENT[item.kind] ?? "linear-gradient(145deg,#94a3b8,#cbd5e1)";
    const badgeCls = BADGE_CLASS[item.kind] ?? "badge-grey";
    const detail   = item.qtype && item.msg && item.qtype !== item.msg
      ? `<div class="motor-result">${esc(item.msg)}</div>` : "";
    const countBadge = item.count > 1
      ? ` <span class="ops-count">(${item.count})</span>` : "";
    return `<div class="item-row">
      <div class="avatar" style="background:${grad}">
        <i class="fa-solid fa-bolt"></i>
      </div>
      <div class="item-info">
        <div class="item-name">${esc(item.label)}${countBadge}</div>
        <div class="item-meta log-meta">
          <span class="act-badge ${badgeCls}">${esc(item.badge)}</span>
          ${fmtTime(item.ts)}
        </div>
        ${detail}
      </div>
    </div>`;
  }).join(""));
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function fetchAll() {
  if (isFetching) return;
  isFetching = true;
  el("refresh-btn").classList.add("spinning");

  try {
    const [status, activity] = await Promise.all([
      fetch(API_BASE + "/api/status",   { credentials: "include" }).then(r =>
        r.status === 401 ? { code: "AUTH" } : r.json()
      ).catch(() => null),
      fetch(API_BASE + "/api/activity", { credentials: "include" }).then(r => r.json()).catch(() => []),
    ]);

    if (status?.code === "AUTH") { showLogin(); return; }

    if (status && !status.code) {
      renderMotors(status);
      el("sse-dot").className = "sse-dot ok";
    } else {
      el("sse-dot").className = "sse-dot";
    }

    renderOperations(Array.isArray(activity) ? activity : []);
    el("updated-at").textContent = `Actualitzat: ${new Date().toLocaleTimeString("ca-ES")}`;
  } finally {
    isFetching = false;
    el("refresh-btn").classList.remove("spinning");
  }
}

// ── Countdown ─────────────────────────────────────────────────────────────────

function startCountdown() {
  countdown = REFRESH_INTERVAL;
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    countdown--;
    el("countdown").textContent = countdown + "s";
    if (countdown <= 0) { countdown = REFRESH_INTERVAL; fetchAll(); }
  }, 1000);
}

// ── Screens ───────────────────────────────────────────────────────────────────

function showLogin() {
  clearInterval(refreshTimer);
  el("login-screen").style.display = "flex";
  el("app-screen").style.display   = "none";
  el("loading-overlay")?.remove();
}

function showApp() {
  el("login-screen").style.display = "none";
  el("app-screen").style.display   = "flex";
  el("loading-overlay")?.remove();
  fetchAll();
  startCountdown();
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  const r = await fetch(API_BASE + "/api/status", { credentials: "include" }).catch(() => null);
  r && r.status !== 401 ? showApp() : showLogin();

  el("login-form").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = el("login-btn");
    const err = el("login-err");
    btn.disabled = true; btn.textContent = "Entrant…"; err.textContent = "";
    const ok = await doLogin(el("user-input").value, el("pw-input").value);
    if (ok) { storeLogin(el("user-input").value); showApp(); }
    else {
      err.textContent = "Contrasenya incorrecta";
      btn.disabled = false; btn.textContent = "Entrar";
    }
  });

  el("refresh-btn").addEventListener("click", () => fetchAll());
});
