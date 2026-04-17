"use client";
import { useState, useEffect } from "react";
import Nav from "./Nav";
import OrdersPanel from "./OrdersPanel";
import CoinSidebar from "./CoinSidebar";
import TopbarTicker from "./TopbarTicker";
import { CoinRow } from "../lib/types";
import { Tab } from "./OrdersPanel";
import { TradingModeProvider, useTradingMode } from "../contexts/TradingModeContext";

const MARKET_REFRESH_MS = 30_000;

// Tabs que son variants PAPER de tabs mode-dependent (no tenen sufix però sí equivalent -real)
const PAPER_MODE_TABS = new Set(["portfolio", "balance", "open", "history", "journal", "bot"]);

interface MarketSummary {
  btcPrice: number;
  totalVolumeUSDT: number;
  topGainer: { symbol: string; pct: number };
  topLoser:  { symbol: string; pct: number };
}

function DashboardContent({
  coins: initialCoins, username, summary,
}: {
  coins: CoinRow[];
  username?: string;
  summary: MarketSummary;
}) {
  const [tab, setTab] = useState<Tab>("portfolio");
  const [openOrdersCount, setOpenOrdersCount] = useState(0);
  const [coins, setCoins] = useState<CoinRow[]>(initialCoins);
  const [publicIp, setPublicIp] = useState<string | null>(null);
  const [navMode, setNavMode] = useState<"paper" | "real">("paper");
  const { setViewModeSilent } = useTradingMode();

  // Actualitza navMode quan canvia la tab — síncron, sense useEffect
  const handleTabChange = (newTab: Tab) => {
    if (newTab.endsWith("-real")) setNavMode("real");
    else if (PAPER_MODE_TABS.has(newTab)) setNavMode("paper");
    // else: tab comuna (convert, simulation, analysis…) — manté navMode
    setTab(newTab);
  };

  const isReal = navMode === "real";

  // Sync trading mode context
  useEffect(() => {
    setViewModeSilent(isReal ? "real" : "paper");
  }, [isReal, setViewModeSilent]);

  useEffect(() => {
    fetch("https://api.ipify.org?format=json")
      .then(r => r.json())
      .then((d: { ip: string }) => setPublicIp(d.ip))
      .catch(() => setPublicIp(null));
  }, []);

  useEffect(() => {
    const refresh = () => {
      fetch("/api/market")
        .then(r => r.json())
        .then(d => { if (Array.isArray(d)) setCoins(d); })
        .catch(err => console.warn("[DashboardShell] market refresh:", (err as Error).message));
    };
    const id = setInterval(refresh, MARKET_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className={`app__real-wrapper${isReal ? " app--real" : ""}`}>
      <header className="topbar">
        {/* Logo */}
        <div className="topbar__brand">
          <div className="topbar__logo">
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <path d="M11 2L19.5 7V15L11 20L2.5 15V7L11 2Z" fill="url(#tg)" stroke="none"/>
              <path d="M7.5 11.5L10 14L14.5 9" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              <defs>
                <linearGradient id="tg" x1="2.5" y1="2" x2="19.5" y2="20" gradientUnits="userSpaceOnUse">
                  {isReal ? (
                    <>
                      <stop stopColor="#ea580c"/>
                      <stop offset="1" stopColor="#ea580c"/>
                    </>
                  ) : (
                    <>
                      <stop stopColor="#6366f1"/>
                      <stop offset="1" stopColor="#8b5cf6"/>
                    </>
                  )}
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
          {isReal && (
            <div className="real-mode-badge">
              <i className="fa-solid fa-bolt" />
              Real
            </div>
          )}
          <div className="topbar__live">
            <span className="topbar__live-dot" />
            <span className="topbar__live-label">Live</span>
          </div>
          {(username || publicIp) && (
            <div className="topbar__user-info">
              {username && (
                <span className="topbar__username">
                  <i className="fa-solid fa-circle-user" />
                  {username}
                </span>
              )}
              {publicIp && (
                <span className="topbar__ip" title="IP pública de sortida">
                  <i className="fa-solid fa-network-wired" />
                  {publicIp}
                </span>
              )}
            </div>
          )}
        </div>
      </header>

      {isReal && (
        <div className="real-mode-banner">
          <i className="fa-solid fa-triangle-exclamation" />
          Entorn Real · Binance Mainnet · Les operacions mouen diners reals
          <i className="fa-solid fa-triangle-exclamation" />
        </div>
      )}

      <div className="app__body">
        <Nav tab={tab} onTab={handleTabChange} openOrdersCount={openOrdersCount} username={username} />
        <div className="content">
          <div className="orders-area">
            <OrdersPanel coins={coins} tab={tab} onTab={handleTabChange} onOrdersCount={setOpenOrdersCount} />
          </div>
          <CoinSidebar coins={coins} />
        </div>
      </div>
    </div>
  );
}

export default function DashboardShell({
  coins, username, summary,
}: {
  coins: CoinRow[];
  username?: string;
  summary: MarketSummary;
}) {
  return (
    <TradingModeProvider>
      <DashboardContent coins={coins} username={username} summary={summary} />
    </TradingModeProvider>
  );
}
