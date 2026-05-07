/* Riscos — Mobile view */

const REFRESH_INTERVAL = 60;
const STABLES = new Set(["USDT","USDC","BUSD","TUSD","DAI","FDUSD"]);

let countdown    = REFRESH_INTERVAL;
let refreshTimer = null;
let isFetching   = false;

// ── Helpers ───────────────────────────────────────────────────────────────────

const el      = id => document.getElementById(id);
const esc     = s  => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const setHtml = (id, html) => el(id).innerHTML = html;
const empty   = msg => `<div class="empty">${msg}</div>`;
const stripSym = s => s.replace(/USDT$|BUSD$|USDC$|FDUSD$|TUSD$/, "");


function fmtPrice(n) {
  if (n >= 1000) return n.toLocaleString("ca-ES", { maximumFractionDigits: 2 });
  if (n >= 1)    return n.toLocaleString("ca-ES", { maximumSignificantDigits: 5 });
  return n.toLocaleString("ca-ES", { maximumSignificantDigits: 4 });
}

function fmtPct(n) {
  return (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
}

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

// ── Render trailing stops ─────────────────────────────────────────────────────

function renderTrailing(actives, priceMap) {
  const live = actives.filter(t => t.status === "active");
  el("trailing-count").textContent = live.length;
  if (!live.length) { setHtml("trailing-body", empty("Cap trailing stop actiu")); return; }

  let totalIfStop = 0;
  let totalIfNow  = 0;
  const rows = live.map(t => {
    const sym      = stripSym(t.symbol);
    const qty      = parseFloat(t.quantity);
    const price    = priceMap[sym]?.price ?? t.peakPrice ?? 0;
    const entry    = t.entryPrice > 0 ? t.entryPrice : null;
    // Escenari 1: si l'stop s'activa (entrada → stop)
    const lossStop  = entry ? (entry - t.currentSl) * qty : null;
    const pctStop   = entry > 0 ? ((t.currentSl - entry) / entry) * 100 : null;
    // Escenari 2: si sortim ara (entrada → preu actual)
    const pnlNow    = entry ? (price - entry) * qty : null;
    const pctNow    = entry > 0 ? ((price - entry) / entry) * 100 : null;
    if (lossStop != null) totalIfStop += lossStop;
    if (pnlNow   != null) totalIfNow  += pnlNow;
    const stopCls  = lossStop == null ? "neu" : lossStop > 0 ? "neg" : "pos";
    const nowCls   = pnlNow  == null ? "neu" : pnlNow  >= 0 ? "pos" : "neg";
    return { sym, price, sl: t.currentSl, entry, lossStop, pctStop, pnlNow, pctNow, stopCls, nowCls };
  }).sort((a, b) => (b.lossStop ?? 0) - (a.lossStop ?? 0));

  setHtml("trailing-body", rows.map(r => `
    <div class="trailing-item risk-item-double">
      ${coinAvatar(r.sym, "avatar")}
      <div class="risk-info">
        <div class="risk-sym">${esc(r.sym)}</div>
        <div class="risk-sl">Entrada: <span style="color:var(--text-1)">${r.entry ? fmtPrice(r.entry) : "—"}</span> · Stop: <span>${fmtPrice(r.sl)}</span></div>
        <div class="risk-sl" style="color:var(--text-3)">Actual: ${fmtPrice(r.price)}</div>
      </div>
      <div class="risk-scenarios">
        <div class="risk-scenario">
          <div class="risk-scenario-label">Si stop</div>
          <div class="risk-usd ${r.stopCls}">${r.lossStop != null ? fmtUSD(-r.lossStop) : "—"}</div>
          <div class="risk-dist neu">${r.pctStop != null ? fmtPct(r.pctStop) : ""}</div>
        </div>
        <div class="risk-scenario">
          <div class="risk-scenario-label">Si surt ara</div>
          <div class="risk-usd ${r.nowCls}">${r.pnlNow != null ? fmtUSD(r.pnlNow) : "—"}</div>
          <div class="risk-dist neu">${r.pctNow != null ? fmtPct(r.pctNow) : ""}</div>
        </div>
      </div>
    </div>`).join(""));

  return { stop: totalIfStop, now: totalIfNow };
}

// ── Render stop orders ────────────────────────────────────────────────────────

function renderStopOrders(orders, actives, priceMap) {
  // Collect slOrderIds from active trailing stops to exclude them
  const trailSlIds = new Set(actives.filter(t => t.status === "active").map(t => t.slOrderId));

  const stops = orders.filter(o =>
    (o.type === "STOP_LOSS_LIMIT" || o.type === "STOP_LOSS") &&
    o.side === "SELL" &&
    !trailSlIds.has(o.orderId)
  );

  el("stops-count").textContent = stops.length;
  if (!stops.length) { setHtml("stops-body", empty("Cap ordre stop sense trailing")); return; }

  let totalRisk = 0;
  const rows = stops.map(o => {
    const sym     = stripSym(o.symbol);
    const price   = priceMap[sym]?.price ?? 0;
    const sl      = parseFloat(o.stopPrice);
    const qty     = parseFloat(o.origQty) - parseFloat(o.executedQty);
    const riskUsd = price > 0 && sl > 0 ? (price - sl) * qty : 0;
    const distPct = price > 0 && sl > 0 ? ((price - sl) / price) * 100 : 0;
    totalRisk    += Math.max(0, riskUsd);
    const riskCls = riskUsd > 200 ? "neg" : riskUsd > 50 ? "amber" : "neu";
    return { sym, price, sl, qty, riskUsd, distPct, riskCls };
  }).sort((a, b) => b.riskUsd - a.riskUsd);

  setHtml("stops-body", rows.map(r => `
    <div class="trailing-item">
      ${coinAvatar(r.sym, "avatar")}
      <div class="risk-info">
        <div class="risk-sym">${esc(r.sym)}</div>
        <div class="risk-sl">Stop: <span>${fmtPrice(r.sl)}</span> · Actual: ${fmtPrice(r.price)}</div>
      </div>
      <div class="risk-end">
        <div class="risk-usd ${r.riskCls}">${fmtUSD(r.riskUsd)}</div>
        <div class="risk-dist">${fmtPct(-r.distPct)}</div>
      </div>
    </div>`).join(""));

  return totalRisk;
}

// ── Render concentration ──────────────────────────────────────────────────────

function renderConcentration(balance, priceMap) {
  const assets = balance.map(b => {
    const qty      = parseFloat(b.free) + parseFloat(b.locked);
    const isStable = STABLES.has(b.asset);
    const price    = isStable ? 1 : (priceMap[b.asset]?.price ?? 0);
    const value    = qty * price;
    return { asset: b.asset, value, isStable };
  }).filter(a => a.value >= 10).sort((a, b) => {
    if (a.isStable !== b.isStable) return a.isStable ? 1 : -1;
    return b.value - a.value;
  });

  const total = assets.reduce((s, a) => s + a.value, 0);
  if (!total) { setHtml("conc-body", empty("Sense dades")); return; }

  setHtml("conc-body", assets.map(a => {
    const pct    = (a.value / total) * 100;
    const cls    = pct > 50 ? "conc-red" : pct > 30 ? "conc-amber" : "";
    const barPct = Math.min(pct, 100);
    return `<div class="conc-item">
      ${coinAvatar(a.asset, "avatar")}
      <div class="risk-info">
        <div class="risk-sym">${esc(a.asset)}</div>
        <div class="conc-bar-wrap">
          <div class="conc-bar ${cls}" style="width:${barPct.toFixed(1)}%"></div>
        </div>
      </div>
      <div class="risk-end">
        <div class="risk-usd">${fmtUSD(a.value)}</div>
        <div class="risk-dist ${cls || "neu"}">${pct.toFixed(1)}%</div>
      </div>
    </div>`;
  }).join(""));

  return { total, cryptoValue: assets.filter(a => !a.isStable).reduce((s, a) => s + a.value, 0) };
}

// ── Fetch all ─────────────────────────────────────────────────────────────────

async function fetchAll() {
  if (isFetching) return;
  isFetching = true;
  el("refresh-btn").classList.add("spinning");

  try {
    const [market, balance, orders, trailing] = await Promise.all([
      fetch(API_BASE + "/api/market",                   { credentials: "include" }).then(r => r.json()).catch(() => []),
      fetch(API_BASE + "/api/balance" + modeParam(),   { credentials: "include" }).then(r => r.json()).catch(() => []),
      fetch(API_BASE + "/api/orders"  + modeParam(),   { credentials: "include" }).then(r => r.json()).catch(() => []),
      fetch(API_BASE + "/api/orders/trailing", { credentials: "include" }).then(r => r.json()).catch(() => ({})),
    ]);

    if (!Array.isArray(balance)) { showLogin(); return; }

    // priceMap indexed by base asset symbol ("BTC", "ETH"…)
    const priceMap = {};
    if (Array.isArray(market)) market.forEach(c => { priceMap[c.symbol] = c; });

    const actives = Array.isArray(trailing?.active) ? trailing.active : [];

    const trailRisk = renderTrailing(actives, priceMap) ?? { now: 0, stop: 0 };
    const stopRisk  = renderStopOrders(Array.isArray(orders) ? orders : [], actives, priceMap) ?? 0;
    const concData  = renderConcentration(balance, priceMap);

    // Hero: total risk
    const lossIfStop  = -(trailRisk.stop ?? 0) + stopRisk;
    const pnlIfNow    =  (trailRisk.now  ?? 0);
    const totalValue  = concData?.total ?? 0;
    const cryptoValue = concData?.cryptoValue ?? 0;
    const exposurePct = totalValue > 0 ? (cryptoValue / totalValue) * 100 : 0;
    const trailSlIds  = new Set(actives.filter(t => t.status === "active").map(t => t.slOrderId));
    const activeCount = actives.filter(t => t.status === "active").length +
                        (Array.isArray(orders) ? orders.filter(o =>
                          (o.type === "STOP_LOSS_LIMIT" || o.type === "STOP_LOSS") &&
                          o.side === "SELL" && !trailSlIds.has(o.orderId)
                        ).length : 0);

    const nowCls = pnlIfNow >= 0 ? "pos" : "neg";
    el("risk-total").textContent     = fmtUSD(lossIfStop);
    el("risk-now").textContent       = fmtUSD(pnlIfNow);
    el("risk-now").style.color       = pnlIfNow >= 0 ? "rgba(167,243,208,0.95)" : "rgba(252,165,165,0.95)";
    el("risk-positions").textContent = `${activeCount} posicions · ${exposurePct.toFixed(0)}% exposat`;

    el("sse-dot").className   = "sse-dot ok";
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
});
