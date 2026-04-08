/**
 * Bot store — persistent multi-bot config (SQLite, data/cache.db)
 *
 * Each bot is linked to a SavedConfig (simulation) and holds its own
 * operational parameters (budget, daily limit, time window).
 * The trading parameters (TP/SL ATRs, pairs, interval) are read-only
 * and derived from the linked simulation at runtime.
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH  = path.join(DATA_DIR, "cache.db");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS bots (
    id               TEXT    PRIMARY KEY,
    name             TEXT    NOT NULL,
    sim_id           TEXT    NOT NULL,
    enabled          INTEGER NOT NULL DEFAULT 0,
    budget_usdt      REAL    NOT NULL DEFAULT 500,
    max_daily        INTEGER NOT NULL DEFAULT 3,
    hours_from       INTEGER NOT NULL DEFAULT 8,
    hours_to         INTEGER NOT NULL DEFAULT 22,
    require_multi_tf INTEGER NOT NULL DEFAULT 0,
    created_at       INTEGER NOT NULL
  );
`);

// ── Schema migration — add columns introduced after initial release ────────────
{
  const cols = (db.prepare("PRAGMA table_info(bots)").all() as { name: string }[]).map(r => r.name);
  if (!cols.includes("code"))            db.exec("ALTER TABLE bots ADD COLUMN code             TEXT    NOT NULL DEFAULT ''");
  if (!cols.includes("entry_desc"))      db.exec("ALTER TABLE bots ADD COLUMN entry_desc       TEXT    NOT NULL DEFAULT ''");
  if (!cols.includes("exit_desc"))       db.exec("ALTER TABLE bots ADD COLUMN exit_desc        TEXT    NOT NULL DEFAULT ''");
  if (!cols.includes("min_probability")) db.exec("ALTER TABLE bots ADD COLUMN min_probability  INTEGER          DEFAULT NULL");
  if (!cols.includes("max_open"))        db.exec("ALTER TABLE bots ADD COLUMN max_open          INTEGER          DEFAULT NULL");
}

/* ── Types ───────────────────────────────────────────────────── */

export interface Bot {
  id:             string;
  code:           string;
  name:           string;
  simId:          string;
  enabled:        boolean;
  budgetUsdt:     number;
  maxDaily:       number;
  hoursFrom:      number;
  hoursTo:        number;
  requireMultiTf: boolean;
  entryDesc:      string;
  exitDesc:       string;
  minProbability: number | null;  // null = usa el de la config de simulació
  maxOpen:        number | null;  // null = usa el de la config de simulació
  createdAt:      number;
}

interface BotRow {
  id:               string;
  code:             string;
  name:             string;
  sim_id:           string;
  enabled:          number;
  budget_usdt:      number;
  max_daily:        number;
  hours_from:       number;
  hours_to:         number;
  require_multi_tf: number;
  entry_desc:       string;
  exit_desc:        string;
  min_probability:  number | null;
  max_open:         number | null;
  created_at:       number;
}

function rowToBot(row: BotRow): Bot {
  return {
    id:             row.id,
    code:           row.code || "",
    name:           row.name,
    simId:          row.sim_id,
    enabled:        row.enabled === 1,
    budgetUsdt:     row.budget_usdt,
    maxDaily:       row.max_daily,
    hoursFrom:      row.hours_from,
    hoursTo:        row.hours_to,
    requireMultiTf: row.require_multi_tf === 1,
    entryDesc:      row.entry_desc || "",
    exitDesc:       row.exit_desc  || "",
    minProbability: row.min_probability ?? null,
    maxOpen:        row.max_open        ?? null,
    createdAt:      row.created_at,
  };
}

function nextBotCode(): string {
  const row = db.prepare("SELECT COUNT(*) as cnt FROM bots").get() as { cnt: number };
  return `B-${String(row.cnt + 1).padStart(3, "0")}`;
}

/* ── Accessors ───────────────────────────────────────────────── */

export function botGetAll(): Bot[] {
  const rows = db.prepare("SELECT * FROM bots ORDER BY created_at ASC").all() as BotRow[];
  return rows.map(rowToBot);
}

export function botGet(id: string): Bot | null {
  const row = db.prepare("SELECT * FROM bots WHERE id = ?").get(id) as BotRow | undefined;
  return row ? rowToBot(row) : null;
}

export function botCreate(data: {
  name:            string;
  simId:           string;
  budgetUsdt?:     number;
  maxDaily?:       number;
  hoursFrom?:      number;
  hoursTo?:        number;
  requireMultiTf?: boolean;
  entryDesc?:      string;
  exitDesc?:       string;
  minProbability?: number | null;
  maxOpen?:        number | null;
}): Bot {
  if (data.budgetUsdt !== undefined && data.budgetUsdt <= 0)
    throw new Error("budgetUsdt ha de ser > 0");
  if (data.maxDaily !== undefined && data.maxDaily < 1)
    throw new Error("maxDaily ha de ser ≥ 1");
  if (data.hoursFrom !== undefined && (data.hoursFrom < 0 || data.hoursFrom > 23))
    throw new Error("hoursFrom ha d'estar entre 0 i 23");
  if (data.hoursTo !== undefined && (data.hoursTo < 1 || data.hoursTo > 24))
    throw new Error("hoursTo ha d'estar entre 1 i 24 (24 = tot el dia)");

  const id   = `bot_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const code = nextBotCode();
  const now  = Date.now();
  db.prepare(`
    INSERT INTO bots
      (id, code, name, sim_id, enabled, budget_usdt, max_daily, hours_from, hours_to, require_multi_tf, entry_desc, exit_desc, min_probability, max_open, created_at)
    VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, code,
    data.name, data.simId,
    data.budgetUsdt  ?? 500,
    data.maxDaily    ?? 3,
    data.hoursFrom   ?? 8,
    data.hoursTo     ?? 22,
    data.requireMultiTf ? 1 : 0,
    data.entryDesc      ?? "",
    data.exitDesc       ?? "",
    data.minProbability ?? null,
    data.maxOpen        ?? null,
    now,
  );
  return botGet(id)!;
}

export function botUpdate(id: string, patch: Partial<Omit<Bot, "id" | "code" | "createdAt">>): Bot | null {
  const existing = botGet(id);
  if (!existing) return null;

  const fields: string[] = [];
  const values: unknown[] = [];

  if (patch.name           !== undefined) { fields.push("name = ?");             values.push(patch.name); }
  if (patch.simId          !== undefined) { fields.push("sim_id = ?");            values.push(patch.simId); }
  if (patch.enabled        !== undefined) { fields.push("enabled = ?");           values.push(patch.enabled ? 1 : 0); }
  if (patch.budgetUsdt     !== undefined) { fields.push("budget_usdt = ?");       values.push(patch.budgetUsdt); }
  if (patch.maxDaily       !== undefined) { fields.push("max_daily = ?");          values.push(patch.maxDaily); }
  if (patch.hoursFrom      !== undefined) { fields.push("hours_from = ?");         values.push(patch.hoursFrom); }
  if (patch.hoursTo        !== undefined) { fields.push("hours_to = ?");           values.push(patch.hoursTo); }
  if (patch.requireMultiTf !== undefined) { fields.push("require_multi_tf = ?");   values.push(patch.requireMultiTf ? 1 : 0); }
  if (patch.entryDesc      !== undefined) { fields.push("entry_desc = ?");         values.push(patch.entryDesc); }
  if (patch.exitDesc       !== undefined) { fields.push("exit_desc = ?");          values.push(patch.exitDesc); }
  if ("minProbability" in patch)          { fields.push("min_probability = ?");    values.push(patch.minProbability ?? null); }
  if ("maxOpen"        in patch)          { fields.push("max_open = ?");           values.push(patch.maxOpen        ?? null); }

  if (fields.length === 0) return existing;
  values.push(id);
  db.prepare(`UPDATE bots SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return botGet(id)!;
}

export function botDelete(id: string): boolean {
  const result = db.prepare("DELETE FROM bots WHERE id = ?").run(id);
  return result.changes > 0;
}

export function botToggle(id: string): Bot | null {
  const bot = botGet(id);
  if (!bot) return null;
  return botUpdate(id, { enabled: !bot.enabled });
}
