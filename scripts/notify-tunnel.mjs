#!/usr/bin/env node
/**
 * notify-tunnel.mjs — Envia la URL del túnel Cloudflare per Telegram.
 * Ús: node scripts/notify-tunnel.mjs <url>
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const url  = process.argv[2];

if (!url) process.exit(0);

// Llegir .env.local
const envPath = path.join(ROOT, ".env.local");
const env = {};
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const token  = env.TELEGRAM_BOT_TOKEN;
const chatId = env.TELEGRAM_CHAT_ID;

if (!token || !chatId) {
  console.log("   ⚠️  Telegram no configurat (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)");
  process.exit(0);
}

const text = `🔗 *CryptDesk reiniciat*\nApp externa: ${url}`;

try {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
  if (res.ok) {
    console.log("   ✅ Telegram notificat");
  } else {
    const err = await res.text();
    console.log(`   ⚠️  Error Telegram: ${err}`);
  }
} catch (e) {
  console.log(`   ⚠️  Error Telegram: ${e.message}`);
}
