export default function Nav() {
  const main = [
    { icon: "fa-gauge-high",     label: "Dashboard",  active: true  },
    { icon: "fa-chart-line",     label: "Markets",    active: false },
    { icon: "fa-briefcase",      label: "Portfolio",  active: false },
    { icon: "fa-arrow-right-arrow-left", label: "Trade", active: false },
    { icon: "fa-list-check",     label: "Orders",     active: false },
    { icon: "fa-chart-pie",      label: "Analytics",  active: false },
  ];

  const account = [
    { icon: "fa-gear",           label: "Settings",   active: false },
    { icon: "fa-circle-user",    label: "Account",    active: false },
  ];

  return (
    <nav className="nav">
      <div className="nav__brand">
        <div className="nav__logo">C</div>
        <div>
          <div className="nav__appname">CryptDesk</div>
          <div className="nav__tagline">Trading Dashboard</div>
        </div>
      </div>

      <span className="nav__section-label">Main</span>
      {main.map(({ icon, label, active }) => (
        <button key={label} className={`nav__item${active ? " nav__item--active" : ""}`}>
          <i className={`fa-solid ${icon} nav__item-icon`} />
          {label}
        </button>
      ))}

      <div className="nav__spacer" />

      <span className="nav__section-label">Account</span>
      {account.map(({ icon, label }) => (
        <button key={label} className="nav__item">
          <i className={`fa-solid ${icon} nav__item-icon`} />
          {label}
        </button>
      ))}

      <div className="nav__live">
        <div className="nav__live-dot" />
        <div>
          <div className="nav__live-text">Binance Demo</div>
          <div className="nav__live-sub">Connected · Live data</div>
        </div>
      </div>
    </nav>
  );
}
