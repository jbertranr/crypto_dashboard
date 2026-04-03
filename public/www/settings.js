/* Configuració — Font size */

const SIZES = [
  { key: "small",  label: "Petit",  px: "14px", icon: "fa-font",       desc: "Més contingut visible a la pantalla" },
  { key: "medium", label: "Mitjà",  px: "17px", icon: "fa-font",       desc: "Mida per defecte, equilibri entre espai i llegibilitat" },
  { key: "large",  label: "Gran",   px: "20px", icon: "fa-text-height", desc: "Ideal per a pantalles grans o visió reduïda" },
];

function renderOptions() {
  const current   = localStorage.getItem("cd_font_size") ?? "medium";
  const container = document.getElementById("font-size-options");

  container.innerHTML = SIZES.map(s => `
    <div class="nav-drawer-link${s.key === current ? " active" : ""}" data-key="${s.key}" style="cursor:pointer">
      <div class="nav-link-icon"><i class="fa-solid ${s.icon}" style="font-size:${s.px}"></i></div>
      <div class="nav-link-body">
        <div class="nav-link-label">${s.label} <span style="font-weight:400;color:var(--text-3);font-size:0.72rem">${s.px}</span></div>
        <div class="nav-link-desc">${s.desc}</div>
      </div>
      ${s.key === current ? `<i class="fa-solid fa-circle-check" style="color:var(--accent);font-size:0.85rem;margin-left:auto;flex-shrink:0"></i>` : ""}
    </div>`).join("");

  container.querySelectorAll(".nav-drawer-link").forEach(el => {
    el.addEventListener("click", () => {
      const key = el.dataset.key;
      localStorage.setItem("cd_font_size", key);
      applyFontSize(key);
      renderOptions();
    });
  });
}

document.addEventListener("DOMContentLoaded", renderOptions);
