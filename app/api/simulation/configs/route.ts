import { NextRequest, NextResponse } from "next/server";
import { apiError } from "../../../lib/api-error";
import fs   from "fs";
import path from "path";

const CONFIGS_DIR = path.join(process.cwd(), "simulation");

function ensureDir() {
  if (!fs.existsSync(CONFIGS_DIR)) fs.mkdirSync(CONFIGS_DIR, { recursive: true });
}

export interface SavedConfig {
  id:              string;   // nom del fitxer sense extensió
  name:            string;
  savedAt:         string;
  pnlPct?:         number;   // guany % de la última simulació desada (opcional)
  config:          Record<string, unknown>;
  effectiveConfig?: Record<string, unknown>;
}

/** GET /api/simulation/configs — llista totes les configuracions desades */
export async function GET() {
  try {
    ensureDir();
    const files = fs.readdirSync(CONFIGS_DIR).filter(f => f.endsWith(".json"));
    const configs: SavedConfig[] = files.map(f => {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(CONFIGS_DIR, f), "utf-8"));
        return { id: f.replace(".json", ""), ...raw } as SavedConfig;
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b!.savedAt.localeCompare(a!.savedAt)) as SavedConfig[];

    return NextResponse.json({ configs });
  } catch (e) {
    return apiError(e, "simulation/configs GET");
  }
}

/** POST /api/simulation/configs — desa una configuració nova */
export async function POST(req: NextRequest) {
  try {
    ensureDir();
    const { name, config, pnlPct, effectiveConfig } = await req.json() as {
      name:             string;
      config:           Record<string, unknown>;
      pnlPct?:          number;
      effectiveConfig?: Record<string, unknown>;
    };
    if (!name || !config) {
      return NextResponse.json({ error: "Falten name o config" }, { status: 400 });
    }

    const savedAt  = new Date().toISOString();
    const safeName = name.replace(/[^a-zA-Z0-9_\- ]/g, "").trim().replace(/\s+/g, "_").slice(0, 60);
    const id       = `${Date.now()}_${safeName}`;
    const payload: Record<string, unknown> = { name, savedAt, config };
    if (pnlPct          !== undefined) payload.pnlPct          = pnlPct;
    if (effectiveConfig !== undefined) payload.effectiveConfig = effectiveConfig;

    fs.writeFileSync(path.join(CONFIGS_DIR, `${id}.json`), JSON.stringify(payload, null, 2), "utf-8");
    return NextResponse.json({ ok: true, id, name, savedAt });
  } catch (e) {
    return apiError(e, "simulation/configs POST");
  }
}

/** DELETE /api/simulation/configs — elimina una configuració per id */
export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json() as { id: string };
    if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });

    const safeName = path.basename(id);
    const filePath = path.join(CONFIGS_DIR, `${safeName}.json`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e, "simulation/configs DELETE");
  }
}
