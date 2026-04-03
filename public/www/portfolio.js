/* Portfolio — Mobile view */

const REFRESH_INTERVAL = 60;
const STABLES = new Set(["USDT","USDC","BUSD","TUSD","DAI","FDUSD"]);
const DUST_THRESHOLD = 1;

let countdown     = REFRESH_INTERVAL;
let refreshTimer  = null;
let isFetching    = false;
let chart         = null;
let currentTf     = "7d";
let allSnapshots  = [];

// ── Helpers ───────────────────────────────────────────────────────────────────

const el      = id => document.getElementById(id);
const esc     = s  => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const setHtml = (id, html) => el(id).innerHTML = html;
const empty   = msg => `<div class="empty">${msg}</div>`;

// avatarColor / coinColor / coinAvatar provided by common.js


function fmtQty(n) {
  if (n >= 1000) return n.toLocaleString("ca-ES", { maximumFractionDigits: 2 });
  if (n >= 1)    return n.toLocaleString("ca-ES", { maximumSignificantDigits: 5 });
  return n.toLocaleString("ca-ES", { maximumSignificantDigits: 4 });
}

function fmtPct(n) {
  return (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
}

function pctClass(n) { return n > 0 ? "pos" : n < 0 ? "neg" : "neu"; }

// ── Auth ──────────────────────────────────────────────────────────────────────

async function fetchCheck() {
  try {
    const r = await fetch(API_BASE + "/api/status", { credentials: "include" });
    return r.status !== 401;
  } catch { return false; }
}

async function doLogin(username, password) {
  const r = await fetch(API_BASE + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ username, password }),
  });
  return r.ok;
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderTotal(totalValue, change24hUSD, change24hPct) {
  el("pt-value").textContent = fmtUSD(totalValue);
  if (change24hUSD != null) {
    const cls = pctClass(change24hPct);
    el("pt-chip").textContent = fmtPct(change24hPct);
    el("pt-chip").className = `pt-chip ${cls === "neg" ? "neg" : ""}`;
    el("pt-sub").textContent = "24h vs ahir";
  } else {
    el("pt-chip").textContent = "—";
    el("pt-sub").textContent = "";
  }
}

function renderAssets(assets) {
  el("assets-count").textContent = assets.length;
  if (!assets.length) { setHtml("assets-body", empty("Cap actiu")); return; }
  setHtml("assets-body", assets.map(a => {
    const lockedBadge = a.locked > 0
      ? ` <i class="fa-solid fa-lock" style="font-size:0.55rem;opacity:0.5"></i>` : "";
    const unrlHtml = a.unrealizedPct != null
      ? `<div class="asset-unrl">${fmtPct(a.unrealizedPct)} cost</div>` : "";
    const chgCls = pctClass(a.change24h);
    return `<div class="item-row">
      ${coinAvatar(a.asset)}
      <div class="item-info">
        <div class="item-name">${esc(a.asset)}</div>
        <div class="item-meta">${fmtQty(a.qty)}${lockedBadge}</div>
      </div>
      <div class="item-end">
        <div class="item-amount">${fmtUSD(a.value)}</div>
        <div class="asset-change ${chgCls}">${fmtPct(a.change24h)}</div>
        ${unrlHtml}
      </div>
    </div>`;
  }).join(""));
}

function renderStables(stables, totalStable) {
  if (!stables.length) { setHtml("stables-body", empty("Cap stable")); return; }
  const rows = stables.map(a => `
    <div class="stable-row">
      ${coinAvatar(a.asset)}
      <span class="stable-name">${esc(a.asset)}</span>
      <span class="stable-val">${fmtUSD(a.value)}</span>
    </div>`).join("");
  const total = stables.length > 1
    ? `<div class="stable-row">
        <span class="stable-name" style="font-weight:800;padding-left:calc(44px + 0.6rem)">Total</span>
        <span class="stable-val stable-total">${fmtUSD(totalStable)}</span>
       </div>` : "";
  setHtml("stables-body", rows + total);
}

// ── Chart ─────────────────────────────────────────────────────────────────────

function filterSnapshots(tf) {
  if (!allSnapshots.length) return [];
  const now = Date.now();
  const cutoffs = { "24h": 86400000, "7d": 604800000, "30d": 2592000000 };
  if (tf === "all") return allSnapshots;
  return allSnapshots.filter(s => s.time >= now - cutoffs[tf]);
}

function renderChart(tf) {
  const data = filterSnapshots(tf);
  const chartDelta = el("chart-delta");

  if (data.length < 2) {
    chartDelta.textContent = "Sense dades";
    chartDelta.className = "chart-delta";
    if (chart) { chart.destroy(); chart = null; }
    return;
  }

  const first = data[0].value;
  const last  = data[data.length - 1].value;
  const delta = last - first;
  const pct   = first > 0 ? (delta / first) * 100 : 0;
  const isPos = delta >= 0;
  const color = isPos ? "#10b981" : "#ef4444";

  chartDelta.textContent = `${isPos ? "+" : ""}${fmtUSD(delta)} (${fmtPct(pct)})`;
  chartDelta.className   = "chart-delta " + (isPos ? "pos" : "neg");

  const series = [{ data: data.map(s => [s.time, parseFloat(s.value.toFixed(2))]) }];

  if (chart) {
    chart.updateOptions({ colors: [color], fill: { gradient: { colorStops: [[{ offset: 0, color, opacity: 0.28 }, { offset: 100, color, opacity: 0 }]] } } });
    chart.updateSeries(series);
    return;
  }

  chart = new ApexCharts(el("portfolio-chart"), {
    chart: {
      type: "area", height: 210,
      toolbar: { show: false }, zoom: { enabled: false },
      animations: { enabled: false },
      fontFamily: "Inter, system-ui, sans-serif",
      sparkline: { enabled: false },
    },
    series,
    colors: [color],
    stroke: { curve: "smooth", width: 2.5 },
    fill: {
      type: "gradient",
      gradient: {
        shadeIntensity: 1, opacityFrom: 0.28, opacityTo: 0, stops: [0, 100],
      },
    },
    dataLabels: { enabled: false },
    markers: { size: 0, hover: { size: 5 } },
    xaxis: {
      type: "datetime",
      labels: {
        datetimeUTC: false,
        format: "dd/MM",
        style: { colors: "#9ca3af", fontSize: "10px" },
      },
      axisBorder: { show: false },
      axisTicks: { show: false },
      tooltip: { enabled: false },
    },
    yaxis: {
      opposite: true,
      labels: {
        style: { colors: "#9ca3af", fontSize: "10px" },
        formatter: v => "$" + (v >= 1000 ? (v / 1000).toFixed(1) + "k" : v.toFixed(0)),
      },
    },
    grid: {
      borderColor: "rgba(0,0,0,0.05)",
      padding: { left: 16, right: 0, top: 0, bottom: 0 },
    },
    tooltip: {
      x: {
        formatter: v => new Date(v).toLocaleString("ca-ES", {
          day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
        }),
      },
      y: { formatter: v => fmtUSD(v) },
      theme: "light",
      style: { fontSize: "12px" },
    },
    legend: { show: false },
  });
  chart.render();
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function fetchAll() {
  if (isFetching) return;
  isFetching = true;
  el("refresh-btn").classList.add("spinning");

  try {
    const [market, balance, costBasis, snapshots] = await Promise.all([
      fetch(API_BASE + "/api/market",             { credentials: "include" }).then(r => r.json()).catch(() => []),
      fetch(API_BASE + "/api/balance",            { credentials: "include" }).then(r => r.json()).catch(() => []),
      fetch(API_BASE + "/api/cost-basis",         { credentials: "include" }).then(r => r.json()).catch(() => ({})),
      fetch(API_BASE + "/api/portfolio-snapshot", { credentials: "include" }).then(r => r.json()).catch(() => []),
    ]);

    if (!Array.isArray(balance)) { showLogin(); return; }

    const priceMap = {};
    if (Array.isArray(market)) market.forEach(c => { priceMap[c.symbol] = c; });

    const allAssets = balance.map(b => {
      const free     = parseFloat(b.free);
      const locked   = parseFloat(b.locked);
      const qty      = free + locked;
      const isStable = STABLES.has(b.asset);
      const coin     = priceMap[b.asset];
      const price    = isStable ? 1 : (coin?.price ?? 0);
      const value    = qty * price;
      const change24h = coin?.change24h ?? 0;
      const cb       = costBasis[b.asset];
      const unrealizedPct = (!isStable && cb?.avgCost > 0)
        ? ((price - cb.avgCost) / cb.avgCost) * 100 : null;
      return { asset: b.asset, qty, free, locked, value, price, change24h, unrealizedPct, isStable };
    }).filter(a => a.value >= DUST_THRESHOLD);

    const totalValue  = allAssets.reduce((s, a) => s + a.value, 0);
    const stableValue = allAssets.filter(a => a.isStable).reduce((s, a) => s + a.value, 0);

    const now = Date.now();
    const snap24h = Array.isArray(snapshots)
      ? snapshots.filter(s => s.time <= now - 82800000).pop() : null;
    const change24hUSD = snap24h ? totalValue - snap24h.value : null;
    const change24hPct = snap24h && snap24h.value > 0 ? (change24hUSD / snap24h.value) * 100 : null;

    const cryptoAssets = allAssets.filter(a => !a.isStable).sort((a, b) => b.value - a.value);
    const stableAssets = allAssets.filter(a => a.isStable).sort((a, b) => b.value - a.value);

    allSnapshots = Array.isArray(snapshots) ? snapshots : [];

    renderTotal(totalValue, change24hUSD, change24hPct);
    renderAssets(cryptoAssets);
    renderStables(stableAssets, stableValue);
    renderChart(currentTf);

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
  const ok = await fetchCheck();
  ok ? showApp() : showLogin();

  el("login-form").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = el("login-btn");
    const err = el("login-err");
    btn.disabled = true;
    btn.textContent = "Entrant…";
    err.textContent = "";
    const ok = await doLogin(el("user-input").value, el("pw-input").value);
    if (ok) { storeLogin(el("user-input").value); showApp(); }
    else {
      err.textContent = "Contrasenya incorrecta";
      btn.disabled = false;
      btn.textContent = "Entrar";
    }
  });

  el("refresh-btn").addEventListener("click", () => fetchAll());

  document.querySelectorAll(".tf-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tf-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentTf = btn.dataset.tf;
      renderChart(currentTf);
    });
  });
});
