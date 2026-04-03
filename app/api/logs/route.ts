import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { todayFile, LOG_DIR } from "../../lib/logger";

export interface LogEntry {
  ts:      number;   // epoch ms (pino usa "time")
  level:   number;   // 10=trace 20=debug 30=info 40=warn 50=error 60=fatal
  module?: string;
  msg:     string;
  err?:    string;
  [key: string]: unknown;
}

const LEVEL_NUM: Record<string, number> = {
  trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60,
};

/** Llegeix les últimes `limit` línies d'un fitxer de text. */
function tailLines(filePath: string, limit: number): string[] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, "utf-8");
  const lines   = content.split("\n").filter(Boolean);
  return lines.slice(-limit);
}

export async function GET(req: NextRequest) {
  const sp     = req.nextUrl.searchParams;
  const limit  = Math.min(parseInt(sp.get("limit")  ?? "200", 10), 500);
  const level  = sp.get("level")  ?? "debug";  // min level a retornar
  const modFilter = sp.get("module") ?? "";      // filtre de mòdul

  const minLevel = LEVEL_NUM[level] ?? 20;

  // Inclou el fitxer d'avui i, si és el primer moment del dia, d'ahir
  const today    = todayFile();
  const yesterday = (() => {
    const d = new Date(); d.setDate(d.getDate() - 1);
    return `${LOG_DIR}/app-${d.toISOString().slice(0, 10)}.log`;
  })();

  const rawLines = [
    ...tailLines(yesterday, limit),
    ...tailLines(today,     limit),
  ].slice(-limit);

  const entries: LogEntry[] = [];
  for (const line of rawLines) {
    try {
      const obj = JSON.parse(line) as LogEntry;
      if (obj.level < minLevel) continue;
      if (modFilter && obj.module !== modFilter) continue;
      // Pino usa "time" com a timestamp; normalitzem a "ts"
      if (!obj.ts && (obj as Record<string, unknown>).time) {
        obj.ts = (obj as Record<string, unknown>).time as number;
      }
      entries.push(obj);
    } catch { /* línia malformada, ignorem */ }
  }

  return NextResponse.json({ entries: entries.slice(-limit) });
}
