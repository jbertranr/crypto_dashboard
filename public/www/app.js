/* Bot Dashboard — Mobile view */

const REFRESH_INTERVAL = 30;
const STABLES = new Set(["USDT","USDC","BUSD","TUSD","DAI","FDUSD"]);
let countdown    = REFRESH_INTERVAL;
let refreshTimer = null;
let isFetching   = false;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n) {
  if (n == null) return "—";
  return (n >= 0 ? "+" : "") + n.toFixed(2);
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString("ca-ES", { hour: "2-digit", minute: "2-digit" });
}

function timeAgo(ts) {
  if (!ts) return "mai";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5)  return "ara";
  if (s < 60) return `fa ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `fa ${m}m`;
  return `fa ${Math.floor(m / 60)}h`;
}

function fmtQty(n) {
  if (n >= 1000) return n.toLocaleString("ca-ES", { maximumFractionDigits: 2 });
  if (n >= 1)    return n.toLocaleString("ca-ES", { maximumSignificantDigits: 5 });
  return n.toLocaleString("ca-ES", { maximumSignificantDigits: 4 });
}

const el       = id => document.getElementById(id);
const esc      = s  => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const stripSym = s  => s.replace(/USDT$/, "");
const setHtml  = (id, html) => el(id).innerHTML = html;
const empty    = msg => `<div class="empty">${msg}</div>`;
const pnlClass = v  => v > 0 ? "pos" : v < 0 ? "neg" : "neu";

// avatarColor / coinColor / coinAvatar provided by common.js

// ── Auth ──────────────────────────────────────────────────────────────────────

async function fetchStatus() {
  try {
    const r = await fetch(API_BASE + "/api/status", { credentials: "include" });
    if (r.status === 401) return null;
    return r.json();
  } catch { return null; }
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

// ── P&L ───────────────────────────────────────────────────────────────────────

function renderPnl(pnl, portfolioTotal) {
  const totalHtml = portfolioTotal > 0
    ? `<span class="ph-portfolio">${fmtUSD(portfolioTotal)}</span>` : "";
  if (!pnl || pnl.code) {
    el("pnl-hero").innerHTML = `
      <div class="ph-top"><span class="ph-label">P&amp;L del bot</span>${totalHtml}</div>
      <div class="ph-value neu">—</div>
      <div class="ph-row"></div>`;
    return;
  }
  const v1  = pnl.d1 ?? 0;
  const cls = v1 > 0 ? "pos" : v1 < 0 ? "neg" : "neu";
  const periods = [["Avui", pnl.d1], ["7d", pnl.d7], ["30d", pnl.d30]];
  el("pnl-hero").innerHTML = `
    <div class="ph-top">
      <span class="ph-label">P&amp;L del bot</span>
      ${totalHtml}
    </div>
    <div class="ph-value ${cls}">${fmt(v1)} <span class="ph-unit">USDC</span></div>
    <div class="ph-row">
      ${periods.map(([label, v]) => {
        const val = v ?? 0;
        const c   = val > 0 ? "pos" : val < 0 ? "neg" : "neu";
        return `<div class="ph-stat">
          <div class="ph-stat-label">${label}</div>
          <div class="ph-stat-pill ${c}">${fmt(v)}</div>
        </div>`;
      }).join("")}
    </div>`;
}

// ── Orders ────────────────────────────────────────────────────────────────────

const ORDER_TYPE_LABEL = {
  LIMIT: "Límit", STOP_LOSS_LIMIT: "Stop-Loss",
  TAKE_PROFIT_LIMIT: "Take-Profit", LIMIT_MAKER: "Maker", MARKET: "Mercat",
};

function renderOrders(orders, priceMap) {
  el("orders-count").textContent = orders.length;
  if (!orders.length) { setHtml("orders-body", empty("Cap ordre oberta")); return; }

  // Group by symbol
  const bySymbol = new Map();
  for (const o of orders) {
    if (!bySymbol.has(o.symbol)) bySymbol.set(o.symbol, []);
    bySymbol.get(o.symbol).push(o);
  }

  let html = "";
  for (const [symbol, symOrders] of bySymbol) {
    const sym = stripSym(symbol);

    // Detect OCO groups
    const groups = new Map();
    for (const o of symOrders) {
      const key = o.orderListId !== -1 ? `oco-${o.orderListId}` : `solo-${o.orderId}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(o);
    }
    const isOco = g => g.length > 1 || g[0].orderListId !== -1;

    // Total USD value of position (qty × current market price)
    const marketPrice = priceMap[sym]?.price ?? 0;
    const totalQty    = symOrders.reduce((s, o) => {
      const rem = parseFloat(o.origQty) - parseFloat(o.executedQty);
      return s + rem;
    }, 0) / symOrders.length; // avg qty per side, approximate position size
    const posQty  = parseFloat(symOrders[0].origQty) - parseFloat(symOrders[0].executedQty);
    const posUSD  = posQty * (marketPrice || parseFloat(symOrders[0].price) || 0);

    // Symbol header
    html += `<div class="dash-order-group">
      <div class="dog-header">
        ${coinAvatar(sym, "avatar")}
        <div class="item-info">
          <div class="item-name">${sym}</div>
          <div class="item-meta"><span class="order-side-pill side-${symOrders[0].side.toLowerCase()}">${symOrders[0].side}</span></div>
        </div>
        <div class="item-end">
          <div class="item-amount">${posUSD > 0 ? fmtUSD(posUSD) : "—"}</div>
        </div>
      </div>`;

    for (const group of groups.values()) {
      const oco = isOco(group);
      if (oco) {
        html += `<div class="dog-oco">
          <div class="dog-oco-bar"></div>
          <div class="dog-oco-lines">
            ${group.map(o => {
              const price = parseFloat(o.stopPrice) > 0 ? o.stopPrice : o.price;
              const rem   = parseFloat(o.origQty) - parseFloat(o.executedQty);
              const type  = ORDER_TYPE_LABEL[o.type] ?? o.type;
              return `<div class="dog-line">
                <span class="dog-type">${esc(type)}</span>
                <span class="dog-price">${parseFloat(price).toLocaleString("ca-ES", { maximumFractionDigits: 4 })}</span>
                <span class="dog-qty">${fmtQty(rem)}</span>
              </div>`;
            }).join("")}
          </div>
        </div>`;
      } else {
        const o     = group[0];
        const price = parseFloat(o.stopPrice) > 0 ? o.stopPrice : o.price;
        const rem   = parseFloat(o.origQty) - parseFloat(o.executedQty);
        const type  = ORDER_TYPE_LABEL[o.type] ?? o.type;
        html += `<div class="dog-line solo">
          <span class="dog-type">${esc(type)}</span>
          <span class="dog-price">${parseFloat(price).toLocaleString("ca-ES", { maximumFractionDigits: 4 })}</span>
          <span class="dog-qty">${fmtQty(rem)}</span>
        </div>`;
      }
    }

    html += `</div>`;
  }

  setHtml("orders-body", html);
}

// ── Balance ───────────────────────────────────────────────────────────────────


function renderBalance(assets, priceMap) {
  if (!assets?.length) { setHtml("balance-body", empty("Sense balanç")); return; }

  const rows = assets
    .map(a => {
      const free   = parseFloat(a.free);
      const locked = parseFloat(a.locked);
      const qty    = free + locked;
      const isStable = STABLES.has(a.asset);
      const price  = isStable ? 1 : (priceMap[a.asset]?.price ?? 0);
      const value  = qty * price;
      return { asset: a.asset, free, locked, qty, value, isStable };
    })
    .filter(a => a.value > 10)
    .sort((a, b) => {
      if (a.isStable !== b.isStable) return a.isStable ? 1 : -1;
      return b.value - a.value;
    });

  if (!rows.length) { setHtml("balance-body", empty("Sense balanç")); return; }

  let html = "";
  let stableHeaderAdded = false;

  for (const a of rows) {
    if (a.isStable && !stableHeaderAdded) {
      html += `<div class="balance-section-label">Stablecoins</div>`;
      stableHeaderAdded = true;
    }
    const lockedBadge = a.locked > 0
      ? `<i class="fa-solid fa-lock" style="font-size:0.5rem;opacity:0.45"></i> ${fmtQty(a.locked)} bloq.` : "";
    html += `<div class="item-row">
      ${coinAvatar(a.asset)}
      <div class="item-info">
        <div class="item-name">${esc(a.asset)}</div>
        <div class="item-meta">${lockedBadge || fmtQty(a.free)}</div>
      </div>
      <div class="item-end">
        <div class="item-amount">${fmtUSD(a.value)}</div>
        <div class="item-sub">${fmtQty(a.qty)}</div>
      </div>
    </div>`;
  }

  setHtml("balance-body", html);
}

// ── Errors ────────────────────────────────────────────────────────────────────

function renderErrors(data) {
  const errors  = data?.errors ?? [];
  const countEl = el("errors-count");
  countEl.textContent = errors.length;
  countEl.className   = errors.length > 0 ? "card-count err" : "card-count";
  if (!errors.length) { setHtml("errors-body", empty("Cap error recent ✓")); return; }

  const grouped = [];
  for (const e of errors) {
    const last = grouped[grouped.length - 1];
    if (last && last.message === e.message && last.module === e.module) {
      last.count++;
    } else {
      if (grouped.length >= 5) break;
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
        <div class="item-meta">${fmtTime(e.ts)}${e.module ? " · " + esc(e.module) : ""}</div>
      </div>
    </div>`;
  }).join(""));
}

// ── Fetch all ─────────────────────────────────────────────────────────────────

async function fetchAll(cachedStatus = null) {
  if (isFetching) return;
  isFetching = true;
  el("refresh-btn").classList.add("spinning");

  try {
    const [status, pnl, orders, errors, balance, market] = await Promise.all([
      cachedStatus ? Promise.resolve(cachedStatus)
        : fetch(API_BASE + "/api/status", { credentials: "include" }).then(r =>
            r.status === 401 ? { code: "AUTH" } : r.json()
          ).catch(() => null),
      fetch(API_BASE + "/api/pnl",      { credentials: "include" }).then(r => r.json()).catch(() => null),
      fetch(API_BASE + "/api/orders",   { credentials: "include" }).then(r => r.json()).catch(() => []),
      fetch(API_BASE + "/api/errors",   { credentials: "include" }).then(r => r.json()).catch(() => null),
      fetch(API_BASE + "/api/balance",  { credentials: "include" }).then(r => r.json()).catch(() => []),
      fetch(API_BASE + "/api/market",   { credentials: "include" }).then(r => r.json()).catch(() => []),
    ]);

    const priceMap = {};
    if (Array.isArray(market)) market.forEach(c => { priceMap[c.symbol] = c; });

    if (status?.code === "AUTH") { showLogin(); return; }

    if (status && !status.code) {
      el("sse-dot").className = "sse-dot ok";
    } else {
      el("sse-dot").className = "sse-dot";
    }

    const portfolioTotal = Array.isArray(balance) ? balance.reduce((sum, a) => {
      const qty = parseFloat(a.free) + parseFloat(a.locked);
      const price = STABLES.has(a.asset) ? 1 : (priceMap[a.asset]?.price ?? 0);
      return sum + qty * price;
    }, 0) : 0;

    renderPnl(pnl, portfolioTotal);
    renderOrders(Array.isArray(orders) ? orders : [], priceMap);
    renderErrors(errors);
    renderBalance(Array.isArray(balance) ? balance : [], priceMap);

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
    if (countdown <= 0) {
      countdown = REFRESH_INTERVAL;
      fetchAll();
    }
  }, 1000);
}

// ── Screens ───────────────────────────────────────────────────────────────────

function showLogin() {
  clearInterval(refreshTimer);
  el("login-screen").style.display = "flex";
  el("app-screen").style.display   = "none";
  el("loading-overlay")?.remove();
}

function showApp(statusData) {
  el("login-screen").style.display = "none";
  el("app-screen").style.display   = "flex";
  el("loading-overlay")?.remove();
  fetchAll(statusData);
  startCountdown();
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  const status = await fetchStatus();
  status ? showApp(status) : showLogin();

  el("login-form").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = el("login-btn");
    const err = el("login-err");
    btn.disabled = true;
    btn.textContent = "Entrant…";
    err.textContent = "";
    const ok = await doLogin(el("user-input").value, el("pw-input").value);
    if (ok) {
      storeLogin(el("user-input").value);
      showApp(null);
    } else {
      err.textContent = "Contrasenya incorrecta";
      btn.disabled = false;
      btn.textContent = "Entrar";
    }
  });

  el("refresh-btn").addEventListener("click", () => fetchAll());
});
