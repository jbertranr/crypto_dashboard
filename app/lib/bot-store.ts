/**
 * Bot store — persistent multi-bot config.
 *
 * Paper bots → data/paper.db
 * Real  bots → data/real.db
 *
 * Each bot is linked to a SavedConfig (simulation) and holds its own
 * operational parameters (budget, daily limit, time window).
 */

import path from "path";
import fs from "fs";
import { getDb, paperDb, realDb } from "./db";

const BOT_SCHEMA = `
  CREATE TABLE IF NOT EXISTS bots (
    id               TEXT    PRIMARY KEY,
    name             TEXT    NOT NULL,
    sim_id           TEXT    NOT NULL,
    enabled          INTEGER NOT NULL DEFAULT 0,
    budget_usdc      REAL    NOT NULL DEFAULT 500,
    max_daily        INTEGER NOT NULL DEFAULT 3,
    hours_from       INTEGER NOT NULL DEFAULT 8,
    hours_to         INTEGER NOT NULL DEFAULT 22,
    require_multi_tf INTEGER NOT NULL DEFAULT 0,
    created_at       INTEGER NOT NULL
  );
`;

function initBotDb(d: ReturnType<typeof getDb>) {
  d.exec(BOT_SCHEMA);
  const cols = (d.prepare("PRAGMA table_info(bots)").all() as { name: string }[]).map(r => r.name);
  if (!cols.includes("code"))            d.exec("ALTER TABLE bots ADD COLUMN code             TEXT    NOT NULL DEFAULT ''");
  if (!cols.includes("entry_desc"))      d.exec("ALTER TABLE bots ADD COLUMN entry_desc       TEXT    NOT NULL DEFAULT ''");
  if (!cols.includes("exit_desc"))       d.exec("ALTER TABLE bots ADD COLUMN exit_desc        TEXT    NOT NULL DEFAULT ''");
  if (!cols.includes("min_probability")) d.exec("ALTER TABLE bots ADD COLUMN min_probability  INTEGER          DEFAULT NULL");
  if (!cols.includes("max_open"))        d.exec("ALTER TABLE bots ADD COLUMN max_open          INTEGER          DEFAULT NULL");
  if (!cols.includes("priority"))        d.exec("ALTER TABLE bots ADD COLUMN priority           INTEGER NOT NULL DEFAULT 50");
  if (cols.includes("budget_usdt") && !cols.includes("budget_usdc"))
    d.exec("ALTER TABLE bots RENAME COLUMN budget_usdt TO budget_usdc");
  // Note: no mode column — mode is implicit from which DB the bot lives in

  // Migrate existing data from cache.db (one-time, safe to retry)
  migrateBotFromCacheDb(d);
}

function migrateBotFromCacheDb(target: ReturnType<typeof getDb>) {
  try {
    const cacheDbPath = path.join(path.dirname(
      (target === paperDb
        ? (paperDb as unknown as { filename: string }).filename
        : (realDb  as unknown as { filename: string }).filename)
    ), "cache.db");
    if (!fs.existsSync(cacheDbPath)) return;

    const srcMode = target === paperDb ? "paper" : "real";
    target.exec(`ATTACH DATABASE '${cacheDbPath}' AS src`);
    target.exec(`
      INSERT OR IGNORE INTO bots (id, name, sim_id, enabled, budget_usdc, max_daily, hours_from, hours_to, require_multi_tf, created_at,
        code, entry_desc, exit_desc, min_probability, max_open)
      SELECT id, name, sim_id, enabled, budget_usdc, max_daily, hours_from, hours_to, require_multi_tf, created_at,
        COALESCE(code, ''), COALESCE(entry_desc, ''), COALESCE(exit_desc, ''), min_probability, max_open
      FROM src.bots
      WHERE COALESCE(mode, 'paper') = '${srcMode}'
    `);
    target.exec("DETACH DATABASE src");
  } catch { /* cache.db pot no tenir la taula — ignorat */ }
}

initBotDb(paperDb);
initBotDb(realDb);

/* ── Types ───────────────────────────────────────────────────── */

export interface Bot {
  id:             string;
  code:           string;
  name:           string;
  simId:          string;
  enabled:        boolean;
  budgetUsdc:     number;
  maxDaily:       number;
  hoursFrom:      number;
  hoursTo:        number;
  requireMultiTf: boolean;
  entryDesc:      string;
  exitDesc:       string;
  minProbability: number | null;
  maxOpen:        number | null;
  priority:       number;
  mode:           "paper" | "real";
  createdAt:      number;
}

interface BotRow {
  id:               string;
  code:             string;
  name:             string;
  sim_id:           string;
  enabled:          number;
  budget_usdc:      number;
  max_daily:        number;
  hours_from:       number;
  hours_to:         number;
  require_multi_tf: number;
  entry_desc:       string;
  exit_desc:        string;
  min_probability:  number | null;
  max_open:         number | null;
  priority:         number | null;
  created_at:       number;
}

function rowToBot(row: BotRow, mode: "paper" | "real"): Bot {
  return {
    id:             row.id,
    code:           row.code || "",
    name:           row.name,
    simId:          row.sim_id,
    enabled:        row.enabled === 1,
    budgetUsdc:     row.budget_usdc,
    maxDaily:       row.max_daily,
    hoursFrom:      row.hours_from,
    hoursTo:        row.hours_to,
    requireMultiTf: row.require_multi_tf === 1,
    entryDesc:      row.entry_desc || "",
    exitDesc:       row.exit_desc  || "",
    minProbability: row.min_probability ?? null,
    maxOpen:        row.max_open        ?? null,
    priority:       row.priority        ?? 50,
    mode,
    createdAt:      row.created_at,
  };
}

function nextBotCode(mode: "paper" | "real"): string {
  const row = getDb(mode).prepare("SELECT COUNT(*) as cnt FROM bots").get() as { cnt: number };
  return `B-${String(row.cnt + 1).padStart(3, "0")}`;
}

/* ── Accessors ───────────────────────────────────────────────── */

/** Returns all bots from both DBs (needed by the auto-trader). */
export function botGetAll(): Bot[] {
  const paperRows = paperDb.prepare("SELECT * FROM bots ORDER BY created_at ASC").all() as BotRow[];
  const realRows  = realDb.prepare("SELECT * FROM bots ORDER BY created_at ASC").all() as BotRow[];
  const all = [
    ...paperRows.map(r => rowToBot(r, "paper")),
    ...realRows.map(r => rowToBot(r, "real")),
  ];
  all.sort((a, b) => a.createdAt - b.createdAt);
  return all;
}

/** Returns only bots for a specific mode. */
export function botGetByMode(mode: "paper" | "real"): Bot[] {
  const rows = getDb(mode).prepare("SELECT * FROM bots ORDER BY created_at ASC").all() as BotRow[];
  return rows.map(r => rowToBot(r, mode));
}

export function botGet(id: string): Bot | null {
  const paperRow = paperDb.prepare("SELECT * FROM bots WHERE id = ?").get(id) as BotRow | undefined;
  if (paperRow) return rowToBot(paperRow, "paper");
  const realRow  = realDb.prepare("SELECT * FROM bots WHERE id = ?").get(id) as BotRow | undefined;
  if (realRow) return rowToBot(realRow, "real");
  return null;
}

export function botCreate(data: {
  name:            string;
  simId:           string;
  budgetUsdc?:     number;
  maxDaily?:       number;
  hoursFrom?:      number;
  hoursTo?:        number;
  requireMultiTf?: boolean;
  entryDesc?:      string;
  exitDesc?:       string;
  minProbability?: number | null;
  maxOpen?:        number | null;
  mode?:           "paper" | "real";
}): Bot {
  if (data.budgetUsdc !== undefined && data.budgetUsdc <= 0)
    throw new Error("budgetUsdc ha de ser > 0");
  if (data.maxDaily !== undefined && data.maxDaily < 1)
    throw new Error("maxDaily ha de ser ≥ 1");
  if (data.hoursFrom !== undefined && (data.hoursFrom < 0 || data.hoursFrom > 23))
    throw new Error("hoursFrom ha d'estar entre 0 i 23");
  if (data.hoursTo !== undefined && (data.hoursTo < 1 || data.hoursTo > 24))
    throw new Error("hoursTo ha d'estar entre 1 i 24 (24 = tot el dia)");

  const mode = data.mode ?? "paper";
  const d    = getDb(mode);
  const id   = `bot_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const code = nextBotCode(mode);
  const now  = Date.now();
  d.prepare(`
    INSERT INTO bots
      (id, code, name, sim_id, enabled, budget_usdc, max_daily, hours_from, hours_to, require_multi_tf, entry_desc, exit_desc, min_probability, max_open, created_at)
    VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, code,
    data.name, data.simId,
    data.budgetUsdc  ?? 500,
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

  const d = getDb(existing.mode);
  const fields: string[] = [];
  const values: unknown[] = [];

  if (patch.name           !== undefined) { fields.push("name = ?");             values.push(patch.name); }
  if (patch.simId          !== undefined) { fields.push("sim_id = ?");            values.push(patch.simId); }
  if (patch.enabled        !== undefined) { fields.push("enabled = ?");           values.push(patch.enabled ? 1 : 0); }
  if (patch.budgetUsdc     !== undefined) { fields.push("budget_usdc = ?");       values.push(patch.budgetUsdc); }
  if (patch.maxDaily       !== undefined) { fields.push("max_daily = ?");          values.push(patch.maxDaily); }
  if (patch.hoursFrom      !== undefined) { fields.push("hours_from = ?");         values.push(patch.hoursFrom); }
  if (patch.hoursTo        !== undefined) { fields.push("hours_to = ?");           values.push(patch.hoursTo); }
  if (patch.requireMultiTf !== undefined) { fields.push("require_multi_tf = ?");   values.push(patch.requireMultiTf ? 1 : 0); }
  if (patch.entryDesc      !== undefined) { fields.push("entry_desc = ?");         values.push(patch.entryDesc); }
  if (patch.exitDesc       !== undefined) { fields.push("exit_desc = ?");          values.push(patch.exitDesc); }
  if ("minProbability" in patch)          { fields.push("min_probability = ?");    values.push(patch.minProbability ?? null); }
  if ("maxOpen"        in patch)          { fields.push("max_open = ?");           values.push(patch.maxOpen        ?? null); }
  if (patch.priority   !== undefined)     { fields.push("priority = ?");           values.push(patch.priority); }
  // Note: mode cannot be changed via update (would require moving between DBs)

  if (fields.length === 0) return existing;
  values.push(id);
  d.prepare(`UPDATE bots SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return botGet(id)!;
}

export function botDelete(id: string): boolean {
  const existing = botGet(id);
  if (!existing) return false;
  const result = getDb(existing.mode).prepare("DELETE FROM bots WHERE id = ?").run(id);
  return result.changes > 0;
}

export function botToggle(id: string): Bot | null {
  const bot = botGet(id);
  if (!bot) return null;
  return botUpdate(id, { enabled: !bot.enabled });
}

/** Enable or disable ALL bots of a given mode at once. */
export function botSetAllEnabled(mode: "paper" | "real", enabled: boolean): number {
  const result = getDb(mode).prepare("UPDATE bots SET enabled = ?").run(enabled ? 1 : 0);
  return result.changes;
}
