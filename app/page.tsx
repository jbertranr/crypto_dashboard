import { getMarketData, formatCurrency } from "./lib/api";
import CoinSidebar from "./components/CoinSidebar";
import OrdersPanel from "./components/OrdersPanel";
import Nav from "./components/Nav";

export default async function Home() {
  const { coins, summary } = await getMarketData();

  return (
    <div className="app">
      <Nav />

      <div className="workspace">
        <header className="topbar">
          <span className="topbar__title">Dashboard</span>
          <span className="topbar__sep" />

          <div className="topbar__stats">
            <div className="topbar__stat">
              <span className="topbar__stat-label">BTC</span>
              <span className="topbar__stat-value">{formatCurrency(summary.btcPrice)}</span>
            </div>
            <div className="topbar__stat">
              <span className="topbar__stat-label">Vol 24h</span>
              <span className="topbar__stat-value">{formatCurrency(summary.totalVolumeUSDT)}</span>
            </div>
            <div className="topbar__stat">
              <span className="topbar__stat-label">Top Gainer</span>
              <span className="topbar__stat-value">{summary.topGainer.symbol}</span>
              <span className="topbar__stat-change topbar__stat-change--up">
                +{summary.topGainer.pct.toFixed(2)}%
              </span>
            </div>
            <div className="topbar__stat">
              <span className="topbar__stat-label">Top Loser</span>
              <span className="topbar__stat-value">{summary.topLoser.symbol}</span>
              <span className="topbar__stat-change topbar__stat-change--down">
                {summary.topLoser.pct.toFixed(2)}%
              </span>
            </div>
          </div>

          <div className="topbar__right">
            <span className="topbar__demo-badge">Demo Mode</span>
          </div>
        </header>

        <div className="content">
          <CoinSidebar coins={coins} />
          <div className="orders-area">
            <OrdersPanel coins={coins} />
          </div>
        </div>
      </div>
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
