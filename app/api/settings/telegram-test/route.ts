import { NextResponse } from "next/server";
import { sendTelegram, isConfigured } from "../../../lib/telegram";

export async function POST() {
  if (!isConfigured()) {
    return NextResponse.json(
      { ok: false, error: "TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID no configurats al .env.local" },
      { status: 400 }
    );
  }
  try {
    await sendTelegram(
      `🧪 <b>Test de connexió</b>\n\nLes notificacions de Telegram funcionen correctament ✅`
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
