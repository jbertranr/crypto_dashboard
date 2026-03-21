export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAutoTraderStatus }     from "../../lib/auto-trader";
import { getOrderMonitorStatus }   from "../../lib/order-monitor";
import { getTrailingEngineStatus } from "../../lib/trailing-engine";
import { getCrashMonitorStatus }   from "../../lib/crash-monitor";
import { getSchedulerStatus }      from "../../lib/scheduler";
import { countErrorsSince }        from "../../lib/error-store";

export type EngineStatus = {
  autoTrader:   ReturnType<typeof getAutoTraderStatus>;
  orderMonitor: ReturnType<typeof getOrderMonitorStatus>;
  trailing:     ReturnType<typeof getTrailingEngineStatus>;
  crashMonitor: ReturnType<typeof getCrashMonitorStatus>;
  scheduler:    ReturnType<typeof getSchedulerStatus>;
  errorCount:   number;
  serverTime:   number;
};

export async function GET() {
  const payload: EngineStatus = {
    autoTrader:   getAutoTraderStatus(),
    orderMonitor: getOrderMonitorStatus(),
    trailing:     getTrailingEngineStatus(),
    crashMonitor: getCrashMonitorStatus(),
    scheduler:    getSchedulerStatus(),
    errorCount:   countErrorsSince(Date.now() - 86_400_000),
    serverTime:   Date.now(),
  };
  return NextResponse.json(payload);
}
