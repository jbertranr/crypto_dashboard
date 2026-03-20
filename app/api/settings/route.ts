import { NextRequest, NextResponse } from "next/server";
import { settingGetAll, settingSet, SETTING_DEFAULTS } from "../../lib/settings-store";

export const dynamic = "force-dynamic";

// A6: whitelist of allowed setting keys
const ALLOWED_KEYS = new Set(Object.keys(SETTING_DEFAULTS));

export async function GET() {
  return NextResponse.json(settingGetAll());
}

export async function POST(req: NextRequest) {
  try {
    const { key, value } = (await req.json()) as { key: string; value: string };
    if (!key) return NextResponse.json({ ok: false, error: "key requerit" }, { status: 400 });
    // A6: reject unknown keys to prevent arbitrary settings injection
    if (!ALLOWED_KEYS.has(key)) return NextResponse.json({ ok: false, error: "clau no permesa" }, { status: 400 });
    settingSet(key, value);
    return NextResponse.json({ ok: true });
  } catch {
    // A6: generic error message — don't expose internal details
    return NextResponse.json({ ok: false, error: "Error intern" }, { status: 500 });
  }
}
