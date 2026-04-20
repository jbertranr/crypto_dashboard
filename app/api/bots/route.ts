/**
 * REST API for multi-bot management.
 *
 * GET    /api/bots           → all bots + their resolved SavedConfig
 * POST   /api/bots           → create bot
 * PATCH  /api/bots           → update bot (partial)
 * DELETE /api/bots?id=...    → delete bot
 */

import { NextRequest, NextResponse } from "next/server";
import { botGetAll, botGet, botCreate, botUpdate, botDelete, botSetAllEnabled } from "@/app/lib/bot-store";
import path from "path";
import fs from "fs";

/* ── SavedConfig loader (same pattern as simulation/configs) ── */

const SIM_DIR = path.join(process.cwd(), "simulation");

interface SavedConfig {
  id: string;
  name: string;
  savedAt: string;
  pnlPct?: number;
  config: Record<string, unknown>;
  effectiveConfig?: Record<string, unknown>;
}

function loadSimConfig(id: string): SavedConfig | null {
  // A5: prevent path traversal — id must be alphanumeric/dash/underscore only
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return null;
  if (!fs.existsSync(SIM_DIR)) return null;
  const filePath = path.join(SIM_DIR, `${id}.json`);
  if (!path.resolve(filePath).startsWith(path.resolve(SIM_DIR))) return null;
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as SavedConfig;
  } catch {
    return null;
  }
}

function loadAllSimConfigs(): SavedConfig[] {
  if (!fs.existsSync(SIM_DIR)) return [];
  return fs
    .readdirSync(SIM_DIR)
    .filter(f => f.endsWith(".json"))
    .map(f => {
      try {
        const raw = fs.readFileSync(path.join(SIM_DIR, f), "utf-8");
        const cfg = JSON.parse(raw) as SavedConfig;
        cfg.id = f.replace(/\.json$/, "");
        return cfg;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as SavedConfig[];
}

/* ── GET ──────────────────────────────────────────────────────── */

export async function GET() {
  const bots = botGetAll();
  const simConfigs = loadAllSimConfigs();
  const simById = Object.fromEntries(simConfigs.map(c => [c.id, c]));

  const botsWithSim = bots.map(bot => ({
    ...bot,
    simConfig: simById[bot.simId] ?? null,
  }));

  return NextResponse.json({ bots: botsWithSim });
}

/* ── POST ────────────────────────────────────────────────────── */

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, simId, budgetUsdt, maxDaily, hoursFrom, hoursTo, requireMultiTf, entryDesc, exitDesc, minProbability, maxOpen, mode } = body as {
    name?: string;
    simId?: string;
    budgetUsdt?: number;
    maxDaily?: number;
    hoursFrom?: number;
    hoursTo?: number;
    requireMultiTf?: boolean;
    entryDesc?: string;
    exitDesc?: string;
    minProbability?: number | null;
    maxOpen?: number | null;
    mode?: "paper" | "real";
  };

  if (!name || !simId) {
    return NextResponse.json({ error: "name and simId are required" }, { status: 400 });
  }

  // C4: validate operational parameters
  if (hoursFrom !== undefined && (hoursFrom < 0 || hoursFrom > 23))
    return NextResponse.json({ error: "hoursFrom ha d'estar entre 0 i 23" }, { status: 400 });
  if (hoursTo !== undefined && (hoursTo < 1 || hoursTo > 24))
    return NextResponse.json({ error: "hoursTo ha d'estar entre 1 i 24 (24 = tot el dia)" }, { status: 400 });
  if (budgetUsdt !== undefined && budgetUsdt <= 0)
    return NextResponse.json({ error: "budgetUsdt ha de ser > 0" }, { status: 400 });
  if (maxDaily !== undefined && maxDaily < 1)
    return NextResponse.json({ error: "maxDaily ha de ser ≥ 1" }, { status: 400 });

  const simConfig = loadSimConfig(simId);
  if (!simConfig) {
    return NextResponse.json({ error: "Simulation config not found" }, { status: 404 });
  }

  const bot = botCreate({ name, simId, budgetUsdt, maxDaily, hoursFrom, hoursTo, requireMultiTf, entryDesc, exitDesc, minProbability, maxOpen, mode });
  return NextResponse.json({ bot, simConfig });
}

/* ── PATCH ───────────────────────────────────────────────────── */

export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { id, ...patch } = body as { id?: string } & Record<string, unknown>;

  // Bulk mode: { bulk: true, mode: "paper"|"real", enabled: boolean }
  if (patch.bulk === true) {
    const mode = patch.mode === "real" ? "real" : "paper";
    if (typeof patch.enabled !== "boolean")
      return NextResponse.json({ error: "enabled (boolean) is required for bulk" }, { status: 400 });
    const changed = botSetAllEnabled(mode, patch.enabled);
    return NextResponse.json({ ok: true, changed });
  }

  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const existing = botGet(id);
  if (!existing) return NextResponse.json({ error: "Bot not found" }, { status: 404 });

  const updated = botUpdate(id, {
    name:           typeof patch.name           === "string"  ? patch.name           : undefined,
    simId:          typeof patch.simId          === "string"  ? patch.simId          : undefined,
    enabled:        typeof patch.enabled        === "boolean" ? patch.enabled        : undefined,
    budgetUsdt:     typeof patch.budgetUsdt     === "number"  ? patch.budgetUsdt     : undefined,
    maxDaily:       typeof patch.maxDaily       === "number"  ? patch.maxDaily       : undefined,
    hoursFrom:      typeof patch.hoursFrom      === "number"  ? patch.hoursFrom      : undefined,
    hoursTo:        typeof patch.hoursTo        === "number"  ? patch.hoursTo        : undefined,
    requireMultiTf: typeof patch.requireMultiTf === "boolean" ? patch.requireMultiTf : undefined,
    entryDesc:      typeof patch.entryDesc      === "string"  ? patch.entryDesc      : undefined,
    exitDesc:       typeof patch.exitDesc       === "string"  ? patch.exitDesc       : undefined,
    ...("minProbability" in patch ? { minProbability: typeof patch.minProbability === "number" ? patch.minProbability : null } : {}),
    ...("maxOpen"        in patch ? { maxOpen:        typeof patch.maxOpen        === "number" ? patch.maxOpen        : null } : {}),
    ...(patch.mode === "paper" || patch.mode === "real" ? { mode: patch.mode as "paper" | "real" } : {}),
  });

  return NextResponse.json({ bot: updated });
}

/* ── DELETE ──────────────────────────────────────────────────── */

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id query param required" }, { status: 400 });

  const deleted = botDelete(id);
  if (!deleted) return NextResponse.json({ error: "Bot not found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
