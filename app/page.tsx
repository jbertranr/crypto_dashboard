import { getMarketData } from "./lib/api";
import DashboardShell from "./components/DashboardShell";
import TopbarTicker from "./components/TopbarTicker";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { SessionData, getSessionOptions } from "./lib/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { coins, summary } = await getMarketData();
  const session = await getIronSession<SessionData>(await cookies(), getSessionOptions());
  const username = session.username ?? process.env.DASHBOARD_USERNAME ?? "";

  return (
    <div className="app">
      <header className="topbar">
        {/* Logo */}
        <div className="topbar__brand">
          <div className="topbar__logo">
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <path d="M11 2L19.5 7V15L11 20L2.5 15V7L11 2Z" fill="url(#tg)" stroke="none"/>
              <path d="M7.5 11.5L10 14L14.5 9" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              <defs>
                <linearGradient id="tg" x1="2.5" y1="2" x2="19.5" y2="20" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#6366f1"/>
                  <stop offset="1" stopColor="#8b5cf6"/>
                </linearGradient>
              </defs>
            </svg>
          </div>
          <div className="topbar__brand-text">
            <span className="topbar__appname">CryptDesk</span>
            <span className="topbar__tagline">Trading Dashboard</span>
          </div>
        </div>

        <div className="topbar__divider" />

        <TopbarTicker
          btcPrice={summary.btcPrice}
          totalVol={summary.totalVolumeUSDT}
          gainerSym={summary.topGainer.symbol}
          gainerPct={summary.topGainer.pct}
          loserSym={summary.topLoser.symbol}
          loserPct={summary.topLoser.pct}
        />

        {/* Right */}
        <div className="topbar__right">
          <div className="topbar__live">
            <span className="topbar__live-dot" />
            <span className="topbar__live-label">Live</span>
          </div>
          <span className="topbar__demo-badge">Demo Mode</span>
        </div>
      </header>

      <DashboardShell coins={coins} username={username} />
      {/* Bottom navigation — mobile only */}
      <nav className="mobile-nav">
        <div className="mobile-nav__list">
          <button className="mobile-nav__btn mobile-nav__btn--active">
            <i className="fa-solid fa-gauge-high" />
            Dashboard
          </button>
          <button className="mobile-nav__btn">
            <i className="fa-solid fa-chart-line" />
            Markets
          </button>
          <button className="mobile-nav__btn">
            <i className="fa-solid fa-list-check" />
            Orders
          </button>
          <button className="mobile-nav__btn">
            <i className="fa-solid fa-briefcase" />
            Portfolio
          </button>
        </div>
      </nav>
    </div>
  );
}
