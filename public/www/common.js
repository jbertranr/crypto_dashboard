/* Shared helpers — included before page scripts */

// ── API base URL ───────────────────────────────────────────────────────────────
// Definida a config.js (carregat abans d'aquest fitxer).
// localhost → http://localhost:3000 | extern → túnel Cloudflare port 3000
const API_BASE = window.API_BASE ?? "http://localhost:3000";

// ── Font size preference ───────────────────────────────────────────────────────

const FONT_SIZES = { small: "14px", medium: "17px", large: "20px" };

function applyFontSize(key) {
  const size = FONT_SIZES[key] ?? FONT_SIZES.medium;
  document.body ? document.body.style.fontSize = size
                : document.documentElement.style.fontSize = size;
}

(function () {
  applyFontSize(localStorage.getItem("cd_font_size") ?? "medium");
})();

// ── Coin colors & gradients ───────────────────────────────────────────────────

const COIN_GRADIENTS = {
  BTC:  ["#F7931A","#FFB347"], ETH:  ["#627EEA","#A78BFA"], BNB:  ["#F3BA2F","#FBBF24"],
  SOL:  ["#9945FF","#C084FC"], XRP:  ["#346AA9","#60A5FA"], ADA:  ["#0033AD","#3B82F6"],
  DOGE: ["#C2A633","#FCD34D"], AVAX: ["#E84142","#FB7185"], DOT:  ["#E6007A","#F472B6"],
  LINK: ["#2A5ADA","#60A5FA"], MATIC:["#8247E5","#A78BFA"], ATOM: ["#6F7390","#94A3B8"],
  LTC:  ["#345D9D","#60A5FA"], UNI:  ["#FF007A","#F472B6"], NEAR: ["#00C08B","#34D399"],
  APT:  ["#00C2CB","#22D3EE"], TRX:  ["#EB0029","#FB7185"], ETC:  ["#328332","#4ADE80"],
  XLM:  ["#14B6E7","#38BDF8"], SHIB: ["#FFA409","#FCD34D"], PEPE: ["#489C3F","#4ADE80"],
  ARB:  ["#12AAFF","#38BDF8"], OP:   ["#FF0420","#FB7185"], ALGO: ["#2A2A2A","#64748B"],
  USDT: ["#26A17B","#34D399"], USDC: ["#2775CA","#60A5FA"], BUSD: ["#F3BA2F","#FCD34D"],
  DAI:  ["#F5AC37","#FBBF24"], TUSD: ["#002868","#3B82F6"], FDUSD:["#346AA9","#60A5FA"],
};

const AVATAR_COLORS_FALLBACK = [
  "#6366f1","#3b82f6","#06b6d4","#10b981",
  "#f59e0b","#ef4444","#8b5cf6","#ec4899","#14b8a6","#f97316",
];

function avatarColor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return AVATAR_COLORS_FALLBACK[Math.abs(h) % AVATAR_COLORS_FALLBACK.length];
}

function coinGradient(symbol) {
  const pair = COIN_GRADIENTS[symbol];
  if (pair) return `linear-gradient(145deg, ${pair[0]}, ${pair[1]})`;
  const col = avatarColor(symbol);
  return `linear-gradient(145deg, ${col}, ${col}88)`;
}

function makeGradient(col1, col2) {
  return `linear-gradient(145deg, ${col1}, ${col2})`;
}

const ICON_BASE = "https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color";

function coinAvatar(symbol, cls = "avatar") {
  const grad = coinGradient(symbol);
  const init = symbol.slice(0, 3);
  const url  = `${ICON_BASE}/${symbol.toLowerCase()}.svg`;
  return `<div class="${cls}" style="background:#fff;box-shadow:0 0 0 1.5px rgba(0,0,0,0.07)" data-grad="${grad}">` +
    `<img class="coin-icon" src="${url}" alt="" onerror="coinImgErr(this)">` +
    `<span style="display:none">${init}</span>` +
    `</div>`;
}

function coinImgErr(img) {
  const wrap = img.parentElement;
  wrap.style.background = wrap.dataset.grad;
  wrap.style.boxShadow  = "none";
  img.style.display = "none";
  img.nextElementSibling.style.display = "";
}

// ── Hamburger nav drawer ──────────────────────────────────────────────────────

function fmtUSD(n) {
  if (n >= 10000) return n.toLocaleString("ca-ES", { maximumFractionDigits: 0 }) + " $";
  if (n >= 100)   return n.toLocaleString("ca-ES", { maximumFractionDigits: 1 }) + " $";
  return n.toLocaleString("ca-ES", { maximumFractionDigits: 2 }) + " $";
}

function storeLogin(username) { localStorage.setItem("cd_user", username); }
function clearLogin()          { localStorage.removeItem("cd_user"); }
function getStoredUser()       { return localStorage.getItem("cd_user") ?? ""; }

function initHamburger(activePage) {
  const PAGES = [
    {
      id: "dashboard", href: "index.html", icon: "fa-gauge", label: "Dashboard",
      desc: "Resum general: P&amp;L, balanç, ordres i activitat recent",
    },
    {
      id: "portfolio", href: "portfolio.html", icon: "fa-chart-pie", label: "Portfolio",
      desc: "Valor total, evolució temporal i actius en cartera amb PnL",
    },
    {
      id: "orders", href: "orders.html", icon: "fa-receipt", label: "Ordres",
      desc: "Ordres obertes agrupades per símbol i trailing stops actius",
    },
    {
      id: "risks", href: "risks.html", icon: "fa-shield-halved", label: "Riscos",
      desc: "Màxim a perdre si els stops s'activen, concentració i exposició",
    },
    {
      id: "motors", href: "motors.html", icon: "fa-gear", label: "Motors",
      desc: "Estat de cada motor del sistema amb descripció i resultat",
    },
    {
      id: "logs", href: "logs.html", icon: "fa-list-ul", label: "Logs",
      desc: "Errors de les últimes 24h i activitat recent del bot",
    },
    {
      id: "settings", href: "settings.html", icon: "fa-sliders", label: "Configuració",
      desc: "Mida de lletra i preferències de visualització",
    },
  ];

  const overlay = document.createElement("div");
  overlay.id = "nav-overlay";
  overlay.className = "nav-overlay";

  const drawer = document.createElement("div");
  drawer.id = "nav-drawer";
  drawer.className = "nav-drawer";
  drawer.innerHTML = `
    <div class="nav-drawer-header">
      <span class="nav-drawer-title"><i class="fa-solid fa-robot"></i> CryptDesk</span>
      <button class="nav-drawer-close" id="nav-close"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="nav-drawer-about">
      <p>Dashboard de monitoratge del bot de trading en temps real. Consulta l'estat dels motors, el portfolio i les ordres des del mòbil.</p>
    </div>
    <div class="nav-drawer-section-label">Pàgines</div>
    <div class="nav-drawer-links">
      ${PAGES.map(p => `
        <a href="${p.href}" class="nav-drawer-link${activePage === p.id ? " active" : ""}">
          <div class="nav-link-icon"><i class="fa-solid ${p.icon}"></i></div>
          <div class="nav-link-body">
            <div class="nav-link-label">${p.label}</div>
            <div class="nav-link-desc">${p.desc}</div>
          </div>
        </a>`).join("")}
    </div>
    <div class="nav-drawer-footer">
      <i class="fa-solid fa-circle-info"></i> Lectura en temps real · Actualització automàtica
    </div>
    <div class="nav-drawer-logout">
      <button id="logout-btn" class="logout-btn">
        <i class="fa-solid fa-right-from-bracket"></i> Tancar sessió
      </button>
    </div>`;

  document.body.appendChild(overlay);
  document.body.appendChild(drawer);

  const open  = () => { overlay.classList.add("open"); drawer.classList.add("open"); document.body.style.overflow = "hidden"; };
  const close = () => { overlay.classList.remove("open"); drawer.classList.remove("open"); document.body.style.overflow = ""; };

  // Mostra l'usuari a la capçalera
  const user = getStoredUser();
  if (user) {
    const flexSpacer = document.querySelector(".app-header > [style*='flex:1']");
    if (flexSpacer) {
      const chip = document.createElement("span");
      chip.className = "header-user";
      chip.innerHTML = `<i class="fa-solid fa-circle-user"></i> ${user}`;
      flexSpacer.insertAdjacentElement("afterend", chip);
    }
  }

  document.getElementById("hamburger-btn").addEventListener("click", open);
  overlay.addEventListener("click", close);
  document.getElementById("nav-close").addEventListener("click", close);

  document.getElementById("logout-btn").addEventListener("click", async () => {
    await fetch(API_BASE + "/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});
    clearLogin();
    window.location.reload();
  });
}
