import { getMarketData } from "./lib/api";
import DashboardShell from "./components/DashboardShell";
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
      <DashboardShell coins={coins} username={username} summary={summary} />
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
