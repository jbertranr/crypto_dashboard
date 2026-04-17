/**
 * Central database factory.
 *
 * data/paper.db  — trading data for paper mode (journal, bots)
 * data/real.db   — trading data for real mode  (journal, bots)
 * data/cache.db  — shared infrastructure (market cache, settings, errors,
 *                  pending_oco, trailing engine state)
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

export type TradingMode = "paper" | "real";

const DATA_DIR = path.join(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

declare global {
  var __paperDb: InstanceType<typeof Database> | undefined;
  var __realDb:  InstanceType<typeof Database> | undefined;
}

function openDb(file: string): InstanceType<typeof Database> {
  const db = new Database(path.join(DATA_DIR, file));
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  return db;
}

export const paperDb = (global.__paperDb ??= openDb("paper.db"));
export const realDb  = (global.__realDb  ??= openDb("real.db"));

export function getDb(mode: TradingMode = "paper"): InstanceType<typeof Database> {
  return mode === "real" ? realDb : paperDb;
}
