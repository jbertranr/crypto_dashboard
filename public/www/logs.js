/* Logs — Mobile view */

const REFRESH_INTERVAL = 30;
let countdown    = REFRESH_INTERVAL;
let refreshTimer = null;
let isFetching   = false;

// ── Helpers ───────────────────────────────────────────────────────────────────

const el      = id => document.getElementById(id);
const esc     = s  => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const setHtml = (id, html) => el(id).innerHTML = html;
const empty   = msg => `<div class="empty">${msg}</div>`;

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString("ca-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtDate(ts) {
  return new Date(ts).toLocaleString("ca-ES", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
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

// ── Errors ────────────────────────────────────────────────────────────────────

function renderErrors(data) {
  const errors  = data?.errors ?? [];
  const countEl = el("errors-count");
  countEl.textContent = errors.length;
  countEl.className   = errors.length > 0 ? "card-count err" : "card-count";

  // Hero
  el("logs-hero-count").textContent = errors.length;
  if (!errors.length) {
    el("logs-hero-icon").className = "fa-solid fa-circle-check pt-hero-icon";
    el("logs-hero-sub").textContent = "Cap error registrat";
  } else {
    el("logs-hero-icon").className = "fa-solid fa-circle-exclamation pt-hero-icon";
    // Most frequent error
    const freq = {};
    for (const e of errors) freq[e.message] = (freq[e.message] ?? 0) + 1;
    const top = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
    el("logs-hero-sub").textContent = top[1] > 1
      ? `Més freqüent (${top[1]}×): ${top[0]}`
      : errors[0].message;
  }

  if (!errors.length) { setHtml("errors-body", empty("Cap error en les últimes 24h ✓")); return; }

  const grouped = [];
  for (const e of errors) {
    const last = grouped[grouped.length - 1];
    if (last && last.message === e.message && last.module === e.module) {
      last.count++;
    } else {
      grouped.push({ ...e, count: 1 });
    }
  }

  setHtml("errors-body", grouped.map(e => {
    const countBadge = e.count > 1 ? ` <span class="ops-count">(${e.count})</span>` : "";
    return `<div class="item-row">
      <div class="avatar" style="background:#ef4444">
        <i class="fa-solid fa-circle-exclamation"></i>
      </div>
      <div class="item-info">
        <div class="item-name">${esc(e.message)}${countBadge}</div>
        <div class="item-meta log-meta">
          ${e.module ? `<span class="act-badge badge-red">${esc(e.module)}</span>` : ""}
          ${fmtDate(e.ts)}
        </div>
        ${e.stack ? `<div class="log-stack">${esc(e.stack.split("\n").slice(0,3).join("\n"))}</div>` : ""}
      </div>
    </div>`;
  }).join(""));
}

// ── Activity ──────────────────────────────────────────────────────────────────

const BADGE_CLASS = {
  fill:      "badge-green",
  trailing:  "badge-indigo",
  bot_buy:   "badge-green",
  bot_scan:  "badge-blue",
  warn:      "badge-amber",
  error:     "badge-red",
  system:    "badge-grey",
  data:      "badge-grey",
  scheduler: "badge-grey",
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

function renderActivity(items) {
  if (!items?.length) { setHtml("activity-body", empty("Cap activitat recent")); return; }

  const grouped = [];
  for (const item of items) {
    const label = item.qtype || item.msg;
    const last  = grouped[grouped.length - 1];
    if (last && last.label === label && last.badge === item.badge) {
      last.count++;
    } else {
      grouped.push({ ...item, label, count: 1 });
    }
  }

  setHtml("activity-body", grouped.map(item => {
    const grad     = ACT_GRADIENT[item.kind] ?? "linear-gradient(145deg,#94a3b8,#cbd5e1)";
    const badgeCls = BADGE_CLASS[item.kind] ?? "badge-grey";
    const detail   = item.qtype && item.msg && item.qtype !== item.msg
      ? `<div class="motor-result">${esc(item.msg)}</div>` : "";
    const countBadge = item.count > 1 ? ` <span class="ops-count">(${item.count})</span>` : "";
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
    const [activity, errors] = await Promise.all([
      fetch(API_BASE + "/api/activity", { credentials: "include" }).then(r =>
        r.status === 401 ? null : r.json()
      ).catch(() => []),
      fetch(API_BASE + "/api/errors", { credentials: "include" }).then(r =>
        r.status === 401 ? null : r.json()
      ).catch(() => null),
    ]);

    if (activity === null) { showLogin(); return; }

    renderErrors(errors);
    renderActivity(Array.isArray(activity) ? activity : []);

    el("sse-dot").className = "sse-dot ok";
    el("updated-at").textContent = `Actualitzat: ${new Date().toLocaleTimeString("ca-ES")}`;
  } catch {
    el("sse-dot").className = "sse-dot";
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
