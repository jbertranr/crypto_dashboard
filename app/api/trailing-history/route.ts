import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { LOG_DIR } from "../../lib/logger";

export interface SlMod {
  time:  number;
  oldSl: number;
  newSl: number;
  peak:  number;
}

/** Returns all the log files whose date falls within [fromMs, toMs]. */
function logFilesInRange(fromMs: number, toMs: number): string[] {
  const files: string[] = [];
  const d = new Date(fromMs);
  const end = new Date(toMs);
  // iterate day by day
  while (d <= end) {
    const name = `app-${d.toISOString().slice(0, 10)}.log`;
    const full = path.join(LOG_DIR, name);
    if (fs.existsSync(full)) files.push(full);
    d.setDate(d.getDate() + 1);
  }
  return files;
}

export async function GET(req: NextRequest) {
  const sp     = req.nextUrl.searchParams;
  const symbol = sp.get("symbol");
  const fromMs = parseInt(sp.get("from") ?? "0", 10);
  const toMs   = parseInt(sp.get("to")   ?? String(Date.now()), 10);

  if (!symbol || !fromMs) {
    return NextResponse.json({ error: "symbol i from són obligatoris" }, { status: 400 });
  }

  const files = logFilesInRange(fromMs, toMs);
  const mods: SlMod[] = [];

  for (const file of files) {
    const content = fs.readFileSync(file, "utf-8");
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      let entry: Record<string, unknown>;
      try { entry = JSON.parse(line); } catch { continue; }

      if (entry.module !== "trailing-engine") continue;
      if (entry.msg !== "SL pujat" && entry.msg !== "SL baixat") continue;
      if (entry.symbol !== symbol) continue;

      const t = entry.time as number;
      if (t < fromMs || t > toMs) continue;

      mods.push({
        time:  t,
        oldSl: entry.oldSl as number,
        newSl: parseFloat(entry.newSl as string),
        peak:  entry.peak as number,
      });
    }
  }

  return NextResponse.json(mods);
}
