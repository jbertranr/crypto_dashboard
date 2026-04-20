/* Orders — Mobile view */

const REFRESH_INTERVAL = 30;
let countdown      = REFRESH_INTERVAL;
let refreshTimer   = null;
let isFetching     = false;
let autoRefresh    = true;
let pausedAt       = null;     // timestamp when paused
let pauseNotifAt   = null;     // timestamp of last notification shown
const orderCharts  = {};
const chartMeta    = new Map(); // symbol → { startTime, refPrice, slPrice, tpPrice, orderEvents }
let   chartTfListenerReady = false;

// ── Helpers ───────────────────────────────────────────────────────────────────

const el      = id => document.getElementById(id);
const esc     = s  => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const setHtml = (id, html) => el(id).innerHTML = html;
const empty   = msg => `<div class="empty">${msg}</div>`;
const stripSym = s => s.replace(/USDT$/, "");

// avatarColor / coinColor / coinAvatar provided by common.js

function fmtPrice(p) {
  const n = parseFloat(p);
  if (!n) return "mercat";
  return n.toLocaleString("ca-ES", { maximumSignificantDigits: 5 });
}


function fmtDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  const dd = d.getDate().toString().padStart(2, "0");
  const mo = (d.getMonth() + 1).toString().padStart(2, "0");
  const yy = d.getFullYear();
  return `${hh}:${mm} ${dd}-${mo}-${yy}`;
}

function fmtQty(s) {
  const n = parseFloat(s);
  if (n >= 1000) return n.toLocaleString("ca-ES", { maximumFractionDigits: 2 });
  if (n >= 1)    return n.toLocaleString("ca-ES", { maximumSignificantDigits: 5 });
  return n.toLocaleString("ca-ES", { maximumSignificantDigits: 4 });
}

const TYPE_CONFIG = {
  STOP_LOSS_LIMIT:   { label: "Stop-Loss",   icon: "fa-shield-halved", cls: "ol-type-sl" },
  TAKE_PROFIT_LIMIT: { label: "Take-Profit", icon: "fa-circle-check",  cls: "ol-type-tp" },
  LIMIT:             { label: "Límit",       icon: "fa-equals",        cls: "" },
  LIMIT_MAKER:       { label: "Take-Profit", icon: "fa-circle-check",  cls: "ol-type-tp" },
  MARKET:            { label: "Mercat",      icon: "fa-bolt",          cls: "" },
};

function typeHtml(type, isTrailingSl = false) {
  if (isTrailingSl) return `<span class="ol-type ol-type-trail"><i class="fa-solid fa-chart-line"></i> Trailing SL</span>`;
  const cfg = TYPE_CONFIG[type] ?? { label: type, icon: "fa-circle", cls: "" };
  return `<span class="ol-type ${cfg.cls}"><i class="fa-solid ${cfg.icon}"></i> ${cfg.label}</span>`;
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

// ── Order chart helpers ────────────────────────────────────────────────────────

function buildAnnotations(refPrice, slPrice, tpPrice, lineColor, orderEvents = []) {
  // Collect candidate labels sorted by price ascending
  const candidates = [];
  if (slPrice  != null) candidates.push({ y: slPrice,  borderColor: "#ef4444", dashArray: 3, opacity: 0.7, text: "SL",    color: "#ef4444" });
  if (refPrice != null) candidates.push({ y: refPrice, borderColor: lineColor, dashArray: 4, opacity: 0.5, text: "INICI", color: lineColor });
  if (tpPrice  != null) candidates.push({ y: tpPrice,  borderColor: "#10b981", dashArray: 3, opacity: 0.7, text: "TP",    color: "#10b981" });
  candidates.sort((a, b) => a.y - b.y);

  // Compute offsetY to avoid overlaps (labels ~16px tall)
  const prices = candidates.map(c => c.y);
  const range  = prices.length > 1 ? prices[prices.length - 1] - prices[0] : prices[0] * 0.1;
  const thresh = range * 0.04; // 4% of visible range
  const offsets = candidates.map(() => 0);
  for (let i = 1; i < candidates.length; i++) {
    if (candidates[i].y - candidates[i - 1].y < thresh) {
      offsets[i - 1] =  8;
      offsets[i]     = -8;
    }
  }

  const chip = (text, color, offsetY) => ({
    text, position: "left", offsetX: 6, offsetY,
    borderColor: "transparent", borderWidth: 0,
    style: { fontSize: "9px", fontWeight: "700", color: "#fff", background: color, border: "none", padding: { top: 2, bottom: 2, left: 5, right: 5 } },
  });

  const yAxis = candidates.map((c, i) => ({
    y: c.y, borderColor: c.borderColor, borderWidth: 1.5, strokeDashArray: c.dashArray, opacity: c.opacity,
    label: chip(c.text, c.color, offsets[i]),
  }));
  const xAxis = orderEvents.map(ev => ({
    x: ev.time, borderColor: "#6366f1", borderWidth: 1.5, strokeDashArray: 4,
    label: {
      text: String(ev.label), position: "top", offsetY: 0, orientation: "horizontal",
      borderColor: "transparent", borderWidth: 0,
      style: { fontSize: "9px", fontWeight: "700", color: "#fff", background: "#6366f1", border: "none", padding: { top: 2, bottom: 2, left: 4, right: 4 } },
    },
  }));
  return { yaxis: yAxis, xaxis: xAxis };
}

function highlightOrder(symbol, moIdx) {
  const meta = chartMeta.get(symbol);
  if (!meta) return;
  const chartId = `ochart-${stripSym(symbol)}`;
  const chart   = orderCharts[chartId];
  if (!chart) return;

  const card = document.querySelector(`.master-order[data-sym="${symbol}"][data-mo="${moIdx}"]`);
  const isActive = card?.classList.contains("mo-active");

  document.querySelectorAll(`.master-order[data-sym="${symbol}"]`).forEach(c => c.classList.remove("mo-active"));

  const last  = meta.lastPrice ?? 0;
  const color = meta.refPrice == null || last >= meta.refPrice ? "#10b981" : "#ef4444";

  if (isActive) {
    // Deselect: restore full-symbol annotations, auto yaxis
    chart.updateOptions({ yaxis: { min: undefined, max: undefined, opposite: true, labels: { style: { colors: "#9ca3af", fontSize: "9px" }, formatter: v => v >= 1000 ? v.toLocaleString("ca-ES", { maximumFractionDigits: 0 }) : v.toLocaleString("ca-ES", { maximumFractionDigits: 4 }) } }, annotations: buildAnnotations(meta.refPrice, meta.slPrice, meta.tpPrice, color, meta.orderEvents) });
    return;
  }

  card?.classList.add("mo-active");
  const op = meta.orderPrices[moIdx] ?? {};
  const prices = [op.slPr, op.tpPr, meta.refPrice, last].filter(p => p != null && p > 0);
  const minY = prices.length ? Math.min(...prices) * 0.994 : undefined;
  const maxY = prices.length ? Math.max(...prices) * 1.006 : undefined;
  chart.updateOptions({
    yaxis: { min: minY, max: maxY, opposite: true, labels: { style: { colors: "#9ca3af", fontSize: "9px" }, formatter: v => v >= 1000 ? v.toLocaleString("ca-ES", { maximumFractionDigits: 0 }) : v.toLocaleString("ca-ES", { maximumFractionDigits: 4 }) } },
    annotations: buildAnnotations(meta.refPrice, op.slPr ?? null, op.tpPr ?? null, color, meta.orderEvents.filter(ev => ev.label === moIdx)),
  });
}

// ── Order chart (ApexCharts) ───────────────────────────────────────────────────

function renderOrderChart(id, klines, refPrice, slPrice, tpPrice, orderEvents = []) {
  const container = document.getElementById(id);
  if (!container) return;

  const last  = klines[klines.length - 1].close;
  const isPos = refPrice == null || last >= refPrice;
  const color = isPos ? "#10b981" : "#ef4444";

  const annotations = buildAnnotations(refPrice, slPrice, tpPrice, color, orderEvents);

  const chart = new ApexCharts(container, {
    chart: {
      type: "area", height: 194,
      toolbar: { show: false },
      zoom: { enabled: true, type: "x", autoScaleYaxis: true },
      pan: { enabled: true, type: "x" },
      animations: { enabled: false },
      fontFamily: "Inter, system-ui, sans-serif",
    },
    series: [{ data: klines.map(k => [k.time, k.close]) }],
    colors: [color],
    stroke: { curve: "smooth", width: 2 },
    fill: { type: "gradient", gradient: { opacityFrom: 0.22, opacityTo: 0 } },
    dataLabels: { enabled: false },
    markers: { size: 0 },
    annotations,
    xaxis: {
      type: "datetime",
      labels: {
        datetimeUTC: false, format: "dd/MM",
        style: { colors: "#9ca3af", fontSize: "9px" },
      },
      axisBorder: { show: false }, axisTicks: { show: false },
      tooltip: { enabled: false },
    },
    yaxis: {
      opposite: true,
      labels: {
        style: { colors: "#9ca3af", fontSize: "9px" },
        formatter: v => v >= 1000
          ? v.toLocaleString("ca-ES", { maximumFractionDigits: 0 })
          : v.toLocaleString("ca-ES", { maximumFractionDigits: 4 }),
      },
    },
    grid: {
      borderColor: "rgba(0,0,0,0.05)",
      padding: { left: 16, right: 0, top: 4, bottom: 0 },
    },
    tooltip: {
      x: { formatter: v => new Date(v).toLocaleString("ca-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) },
      y: { formatter: v => v.toLocaleString("ca-ES", { maximumFractionDigits: 6 }) },
      theme: "light",
    },
    legend: { show: false },
  });
  chart.render();
  return chart;
}

// ── Chart reload (timeframe change) ───────────────────────────────────────────

async function reloadChart(symbol, tf) {
  const meta = chartMeta.get(symbol);
  if (!meta) return;
  const url = tf === "auto"
    ? `${API_BASE}/api/klines-range?symbol=${symbol}&startTime=${meta.startTime}`
    : `${API_BASE}/api/klines-range?symbol=${symbol}&startTime=${meta.startTime}&window=${tf}`;
  const klines = await fetch(url, { credentials: "include" }).then(r => r.ok ? r.json() : []);
  const chartId = `ochart-${stripSym(symbol)}`;
  const inst = orderCharts[chartId];
  if (inst) { try { inst.destroy(); } catch {} delete orderCharts[chartId]; }
  if (klines.length >= 2) {
    const activeCard = document.querySelector(`.master-order.mo-active[data-sym="${symbol}"]`);
    const activeMo   = activeCard ? parseInt(activeCard.dataset.mo, 10) : null;
    const events     = activeMo != null ? meta.orderEvents.filter(ev => ev.label === activeMo) : meta.orderEvents;
    orderCharts[chartId] = renderOrderChart(chartId, klines, meta.refPrice, meta.slPrice, meta.tpPrice, events);
    if (activeMo != null) highlightOrder(symbol, activeMo);
  }
}

// ── Render orders ─────────────────────────────────────────────────────────────

async function renderOrders(orders, costBasis, priceMap) {
  el("orders-count").textContent = orders.length;
  if (!orders.length) { setHtml("orders-body", empty("Cap ordre oberta")); return; }

  const bySymbol = new Map();
  for (const o of orders) {
    if (!bySymbol.has(o.symbol)) bySymbol.set(o.symbol, []);
    bySymbol.get(o.symbol).push(o);
  }

  // Compute startTime per symbol
  const startTimeMap = {};
  for (const [symbol, symOrders] of bySymbol) {
    const cb = costBasis[stripSym(symbol)];
    startTimeMap[symbol] = cb?.firstBuyTime
      ?? Math.min(...symOrders.map(o => o.time ?? o.updateTime ?? Date.now()));
  }

  // Fetch klines for all symbols in parallel
  const klinesMap = {};
  await Promise.all([...bySymbol.keys()].map(async symbol => {
    try {
      const data = await fetch(
        `${API_BASE}/api/klines-range?symbol=${symbol}&startTime=${startTimeMap[symbol]}`,
        { credentials: "include" }
      ).then(r => r.ok ? r.json() : []);
      klinesMap[symbol] = Array.isArray(data) ? data : [];
    } catch { klinesMap[symbol] = []; }
  }));

  const chartConfigs = {};
  let html = "";
  let moIdx = 0;
  for (const [symbol, symOrders] of bySymbol) {
    const sym    = stripSym(symbol);
    const klines = klinesMap[symbol] ?? [];
    const cb     = costBasis[sym];

    // Groups (OCO detection)
    const groups = new Map();
    for (const o of symOrders) {
      const key = o.orderListId !== -1 ? `oco-${o.orderListId}` : `solo-${o.orderId}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(o);
    }
    const isOco = g => g.length > 1 || g[0].orderListId !== -1;

    // USD value: position qty × current market price
    const posQty    = parseFloat(symOrders[0].origQty) - parseFloat(symOrders[0].executedQty);
    const mktPrice  = priceMap[sym]?.price ?? 0;
    const posUSD    = posQty * (mktPrice || parseFloat(symOrders[0].price) || 0);

    // Reference price for chart & % change
    const refPrice  = cb?.avgCost > 0
      ? cb.avgCost
      : (() => {
          const pp = symOrders.map(o => parseFloat(o.stopPrice) > 0 ? parseFloat(o.stopPrice) : parseFloat(o.price)).filter(p => p > 0);
          return pp.length ? pp.reduce((a, b) => a + b) / pp.length : null;
        })();
    const lastPrice = klines.length ? klines[klines.length - 1].close : null;
    const pctChange = refPrice && lastPrice ? ((lastPrice - refPrice) / refPrice) * 100 : null;
    const pctHtml   = pctChange != null
      ? `<span class="og-pct ${pctChange >= 0 ? "pos" : "neg"}">${pctChange >= 0 ? "+" : ""}${pctChange.toFixed(2)}%</span>`
      : "";

    // Stop loss price (from STOP_LOSS_LIMIT order)
    const slOrder  = symOrders.find(o => o.type === "STOP_LOSS_LIMIT" && parseFloat(o.stopPrice) > 0);
    const slPrice  = slOrder ? parseFloat(slOrder.stopPrice) : null;

    // Take profit price (from TAKE_PROFIT_LIMIT order)
    const tpOrder  = symOrders.find(o => o.type === "TAKE_PROFIT_LIMIT" && parseFloat(o.price) > 0);
    const tpPrice  = tpOrder ? parseFloat(tpOrder.price) : null;

    const chartId     = `ochart-${sym}`;
    const orderEvents = [];
    const orderPrices = {}; // moIdx → { slPr, tpPr }

    // Render order groups (collect orderEvents per group)
    let groupsHtml = "";
    for (const group of groups.values()) {
      const oco = isOco(group);
      if (oco) {
        const slO         = group.find(o => o.type === "STOP_LOSS_LIMIT");
        const tpO         = group.find(o => o.type === "TAKE_PROFIT_LIMIT" || o.type === "LIMIT_MAKER");
        const base        = slO ?? tpO ?? group[0];
        const rem         = parseFloat(base.origQty) - parseFloat(base.executedQty);
        const slPr        = slO ? parseFloat(slO.stopPrice) || parseFloat(slO.price) : null;
        const tpPr        = tpO ? parseFloat(tpO.price) : null;
        const masterListId = group[0].orderListId;
        const botName      = group[0].botName;
        const groupUSD     = rem * mktPrice;
        const entryUSD     = refPrice ? refPrice * rem : null;
        ++moIdx;
        orderEvents.push({ time: base.time, label: moIdx });
        orderPrices[moIdx] = { slPr, tpPr };
        groupsHtml += `<div class="master-order oco-group" data-mo="${moIdx}" data-sym="${symbol}">
          <div class="master-order-header">
            <span class="mo-num">${moIdx}</span>
            <span class="oco-tag"><i class="fa-solid fa-link"></i> OCO</span>
            <span class="order-id-chip">#${masterListId}</span>
            <span class="mo-usd">${groupUSD > 0 ? fmtUSD(groupUSD) : "—"}</span>
          </div>
          <div class="master-order-lines">
            ${slPr != null ? `<div class="master-suborder">
              <span class="oco-sl"><i class="fa-solid fa-shield-halved"></i> SL <strong>${fmtPrice(slPr)}</strong></span>
              <span class="order-id-chip order-id-sub">#${slO.orderId}</span>
              <span class="mo-sub-usd mo-sub-usd-sl">${fmtUSD(slPr * rem)}</span>
            </div>` : ""}
            ${tpPr != null ? `<div class="master-suborder">
              <span class="oco-tp"><i class="fa-solid fa-circle-check"></i> TP <strong>${fmtPrice(tpPr)}</strong></span>
              <span class="order-id-chip order-id-sub">#${tpO.orderId}</span>
              <span class="mo-sub-usd mo-sub-usd-tp">${fmtUSD(tpPr * rem)}</span>
            </div>` : ""}
          </div>
          <div class="mo-topinfo">
            <span class="mo-meta-bot"><i class="fa-solid ${botName ? "fa-robot" : "fa-user"}"></i> ${botName ? esc(botName) : "Ordre manual"}</span>
            <div class="mo-meta-details">
              <span class="mo-date">${fmtDate(base.time)}</span>
              ${entryUSD ? `<span class="mo-entry-usd"><i class="fa-solid fa-arrow-right-to-bracket"></i> ${fmtUSD(entryUSD)}</span>` : ""}
            </div>
          </div>
        </div>`;
      } else {
        const o          = group[0];
        const rem       = parseFloat(o.origQty) - parseFloat(o.executedQty);
        const price     = parseFloat(o.stopPrice) > 0 ? o.stopPrice : o.price;
        const groupUSD  = rem * mktPrice;
        const entryUSD  = refPrice ? refPrice * rem : null;
        const slBadge   = o.isTrailingSl && o.slUpdateCount > 0
          ? `<span class="mo-sl-badge"><i class="fa-solid fa-rotate"></i> ${o.slUpdateCount} ajustos</span>`
          : "";
        const botLabel  = o.botName ? esc(o.botName) : "Ordre manual";
        const priceUSD  = parseFloat(price) * rem;
        // Master ID: originOcoListId si existeix, sinó orderId propi
        const masterId  = o.originOcoListId ?? o.orderId;
        ++moIdx;
        orderEvents.push({ time: o.time, label: moIdx });
        orderPrices[moIdx] = { slPr: o.isTrailingSl || o.type === "STOP_LOSS_LIMIT" ? parseFloat(price) : null, tpPr: null };
        const priceSpan = o.isTrailingSl
          ? `<span class="oco-sl"><i class="fa-solid fa-shield-halved"></i> SL <strong>${fmtPrice(price)}</strong></span>`
          : `<span class="ol-price">${fmtPrice(price)}</span>`;
        // Sub-ordre chip: mostra l'orderId real quan hi ha originOcoListId (igual que OCO)
        const subChip   = o.originOcoListId
          ? `<span class="order-id-chip order-id-sub">#${o.orderId}</span>`
          : "";
        groupsHtml += `<div class="master-order solo-line" data-mo="${moIdx}" data-sym="${symbol}">
          <div class="master-order-header">
            <span class="mo-num">${moIdx}</span>
            ${typeHtml(o.type, o.isTrailingSl)}
            <span class="order-id-chip">#${masterId}</span>
            <span class="mo-usd">${groupUSD > 0 ? fmtUSD(groupUSD) : "—"}</span>
          </div>
          <div class="master-order-lines">
            <div class="master-suborder">
              ${priceSpan}
              ${subChip}
              <span class="mo-sub-usd${o.isTrailingSl ? " mo-sub-usd-sl" : ""}">${priceUSD > 0 ? fmtUSD(priceUSD) : ""}</span>
            </div>
          </div>
          <div class="mo-topinfo">
            <div class="mo-meta-bot-row">
              <span class="mo-meta-bot"><i class="fa-solid ${o.botName ? "fa-robot" : "fa-user"}"></i> ${botLabel}</span>
              ${slBadge}
            </div>
            <div class="mo-meta-details">
              <span class="mo-date">${fmtDate(o.time)}</span>
              ${entryUSD ? `<span class="mo-entry-usd"><i class="fa-solid fa-arrow-right-to-bracket"></i> ${fmtUSD(entryUSD)}</span>` : ""}
            </div>
          </div>
        </div>`;
      }
    }

    const entryMeta = refPrice
      ? `<span class="item-meta-val">entrada ${fmtPrice(refPrice)}</span>`
      : "";

    // Chart + toolbar
    const startTime = startTimeMap[symbol];
    chartMeta.set(symbol, { startTime, refPrice, slPrice, tpPrice, orderEvents, orderPrices, lastPrice });
    const chartHtml = klines.length >= 2
      ? `<div class="order-chart-wrap" data-sym="${symbol}">
          <div class="order-chart-tf">
            <button class="otf-btn active" data-tf="auto">Auto</button>
            <button class="otf-btn" data-tf="1d">1d</button>
            <button class="otf-btn" data-tf="1w">1s</button>
            <button class="otf-btn" data-tf="1M">1M</button>
            <button class="otf-btn" data-tf="3m">3m</button>
          </div>
          <div class="order-chart"><div id="${chartId}"></div></div>
        </div>`
      : "";

    html += `<div class="order-group">
      <div class="order-group-header">
        ${coinAvatar(sym, "avatar")}
        <div class="item-info">
          <div class="item-name">${sym}<span class="og-slash">/USDC</span></div>
          <div class="item-meta">${entryMeta}</div>
        </div>
        <div class="item-end">
          <div class="item-amount">${posUSD > 0 ? fmtUSD(posUSD) : "—"}</div>
          ${pctHtml}
        </div>
      </div>
      ${chartHtml}
      <div class="order-lines">${groupsHtml}</div>
    </div>`;
  }

  for (const inst of Object.values(orderCharts)) { try { inst.destroy(); } catch {} }
  Object.keys(orderCharts).forEach(k => delete orderCharts[k]);

  setHtml("orders-body", html);

  // Render charts
  for (const [symbol, meta] of chartMeta) {
    const klines = klinesMap[symbol] ?? [];
    if (klines.length < 2) continue;
    const id = `ochart-${stripSym(symbol)}`;
    orderCharts[id] = renderOrderChart(id, klines, meta.refPrice, meta.slPrice, meta.tpPrice, meta.orderEvents);
  }

  // Event delegation (only once): timeframe buttons + master-order click
  if (!chartTfListenerReady) {
    chartTfListenerReady = true;
    el("orders-body").addEventListener("click", async e => {
      const btn = e.target.closest(".otf-btn");
      if (btn) {
        const wrap = btn.closest(".order-chart-wrap");
        if (!wrap) return;
        wrap.querySelectorAll(".otf-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        await reloadChart(wrap.dataset.sym, btn.dataset.tf);
        return;
      }
      const card = e.target.closest(".master-order");
      if (card?.dataset.mo) highlightOrder(card.dataset.sym, parseInt(card.dataset.mo, 10));
    });
  }
}

// ── Hero ──────────────────────────────────────────────────────────────────────

function renderOrdersHero(orders, priceMap, status) {
  const arr = Array.isArray(orders) ? orders : [];
  const syms = new Set(arr.map(o => o.symbol));
  const totalValue = [...syms].reduce((sum, symbol) => {
    const sym   = stripSym(symbol);
    const symOs = arr.filter(o => o.symbol === symbol);
    const qty   = parseFloat(symOs[0].origQty) - parseFloat(symOs[0].executedQty);
    const price = priceMap[sym]?.price ?? parseFloat(symOs[0].price) ?? 0;
    return sum + qty * price;
  }, 0);
  let masterCount = 0;
  for (const symbol of syms) {
    const symOs = arr.filter(o => o.symbol === symbol);
    const keys = new Set(symOs.map(o => o.orderListId !== -1 ? `oco-${o.orderListId}` : `solo-${o.orderId}`));
    masterCount += keys.size;
  }
  const subCount = arr.length;

  el("orders-hero-value").textContent = fmtUSD(totalValue);
  el("orders-hero-sub").textContent =
    `${masterCount} ordre${masterCount !== 1 ? "s" : ""} pare · ${subCount} subordre${subCount !== 1 ? "s" : ""}`;
}

// ── Fetch all ─────────────────────────────────────────────────────────────────

async function fetchAll() {
  if (isFetching) return;
  isFetching = true;
  el("refresh-btn").classList.add("spinning");

  try {
    const [orders, status, costBasis, market] = await Promise.all([
      fetch(API_BASE + "/api/orders",     { credentials: "include" }).then(r =>
        r.status === 401 ? null : r.json()
      ).catch(() => []),
      fetch(API_BASE + "/api/status",     { credentials: "include" }).then(r =>
        r.status === 401 ? { code: "AUTH" } : r.json()
      ).catch(() => null),
      fetch(API_BASE + "/api/cost-basis", { credentials: "include" }).then(r => r.json()).catch(() => ({})),
      fetch(API_BASE + "/api/market",     { credentials: "include" }).then(r => r.json()).catch(() => []),
    ]);
    const priceMap = {};
    if (Array.isArray(market)) market.forEach(c => { priceMap[c.symbol] = c; });

    if (orders === null || status?.code === "AUTH") { showLogin(); return; }

    renderOrdersHero(orders, priceMap, status);
    await renderOrders(Array.isArray(orders) ? orders : [], costBasis ?? {}, priceMap);

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

function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

function showPausePanel() {
  const panel = el("pause-panel");
  const elapsed = pausedAt ? fmtElapsed(Date.now() - pausedAt) : "";
  el("pause-panel-elapsed").textContent = `Sense refresc des de fa ${elapsed}`;
  panel.classList.add("show");
  setTimeout(() => panel.classList.remove("show"), 6000);
}

function startCountdown() {
  countdown = REFRESH_INTERVAL;
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (!autoRefresh) {
      // Show elapsed time in red
      const elapsed = pausedAt ? fmtElapsed(Date.now() - pausedAt) : "—";
      el("countdown").textContent = elapsed;
      // Notify every 2 minutes
      if (pausedAt && (!pauseNotifAt || Date.now() - pauseNotifAt >= 120_000)) {
        pauseNotifAt = Date.now();
        showPausePanel();
      }
      return;
    }
    countdown--;
    el("countdown").textContent = countdown + "s";
    if (countdown <= 0) { countdown = REFRESH_INTERVAL; fetchAll(); }
  }, 1000);
}

function setAutoRefresh(enabled) {
  autoRefresh = enabled;
  const btn    = el("refresh-btn");
  const status = el("header-status") ?? btn.closest(".header-status");
  const statusEl = document.querySelector(".header-status");
  if (enabled) {
    btn.classList.remove("ar-paused");
    if (statusEl) statusEl.classList.remove("paused");
    btn.title  = "Pausa el refresc";
    pausedAt   = null;
    pauseNotifAt = null;
    el("pause-panel").classList.remove("show");
    countdown  = REFRESH_INTERVAL;
    el("countdown").textContent = countdown + "s";
  } else {
    btn.classList.add("ar-paused");
    if (statusEl) statusEl.classList.add("paused");
    btn.title  = "Reprèn el refresc";
    pausedAt   = Date.now();
    pauseNotifAt = Date.now();
    showPausePanel();
  }
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

  el("refresh-btn").addEventListener("click", () => setAutoRefresh(!autoRefresh));
  el("pause-resume-btn").addEventListener("click", () => setAutoRefresh(true));
});
