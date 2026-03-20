"use client";
import { useState, useEffect } from "react";
import Nav from "./Nav";
import OrdersPanel from "./OrdersPanel";
import CoinSidebar from "./CoinSidebar";
import { CoinRow } from "../lib/types";
import { Tab } from "./OrdersPanel";

const MARKET_REFRESH_MS = 30_000;

export default function DashboardShell({ coins: initialCoins }: { coins: CoinRow[] }) {
  const [tab, setTab] = useState<Tab>("portfolio");
  const [openOrdersCount, setOpenOrdersCount] = useState(0);
  const [coins, setCoins] = useState<CoinRow[]>(initialCoins);

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
    <div className="app__body">
      <Nav tab={tab} onTab={setTab} openOrdersCount={openOrdersCount} />
      <div className="content">
        <div className="orders-area">
          <OrdersPanel coins={coins} tab={tab} onTab={setTab} onOrdersCount={setOpenOrdersCount} />
        </div>
        <CoinSidebar coins={coins} />
      </div>
    </div>
  );
}
