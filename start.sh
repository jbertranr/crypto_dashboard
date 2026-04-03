#!/usr/bin/env bash
# start.sh — Arrenca tot el sistema CryptDesk (o el reinicia si ja estava engegat)

ROOT="$(cd "$(dirname "$0")" && pwd)"
LOG="$ROOT/logs"
mkdir -p "$LOG"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║        CryptDesk — Arrencada             ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── 1. Aturar processos existents ─────────────────────────────────────────────
echo "⏹  Aturant processos existents..."

npx --yes kill-port 3000 3001 2>/dev/null && echo "   ports 3000/3001 alliberats" || true

if tasklist 2>/dev/null | grep -qi "cloudflared"; then
  taskkill /F /IM cloudflared.exe >/dev/null 2>&1 && echo "   cloudflared aturat"
fi

sleep 1

# ── 2. Port 3000 — Next.js ────────────────────────────────────────────────────
echo ""
echo "🚀 Arrencant Next.js (port 3000)..."
cd "$ROOT"
nohup npm run dev > "$LOG/dev-server.log" 2>&1 &

for i in $(seq 1 20); do
  sleep 1
  if curl -s http://localhost:3000/api/status >/dev/null 2>&1; then
    echo "   ✅ Next.js actiu"
    break
  fi
  [ $i -eq 20 ] && echo "   ⚠️  Next.js tarda — comprova $LOG/dev-server.log"
done

# ── 3. Port 3001 — server-public.mjs (proxy + estàtics) ──────────────────────
echo ""
echo "🌐 Arrencant servidor públic (port 3001)..."
cd "$ROOT"
nohup node server-public.mjs > "$LOG/www-server.log" 2>&1 &

sleep 2
if curl -s http://localhost:3001 >/dev/null 2>&1; then
  echo "   ✅ Servidor públic actiu"
else
  echo "   ⚠️  Error — comprova $LOG/www-server.log"
fi

# ── 4. Túnel Cloudflare (només port 3001) ────────────────────────────────────
echo ""
echo "🔗 Arrencant túnel Cloudflare (port 3001)..."
nohup cloudflared tunnel --url http://localhost:3001 > /tmp/cf-tunnel.log 2>&1 &

echo "   Esperant URL del túnel..."
sleep 8

URL=$(grep -o 'https://[a-zA-Z0-9._-]*\.trycloudflare\.com' /tmp/cf-tunnel.log 2>/dev/null | head -1)

# ── 4b. Notificació Telegram amb la URL del túnel ─────────────────────────────
if [ -n "$URL" ]; then
  node "$ROOT/scripts/notify-tunnel.mjs" "$URL"
fi

# ── 5. Resum ──────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Sistema CryptDesk operatiu                                  ║"
echo "╠══════════════════════════════════════════════════════════════╣"
printf  "║  Dashboard local   http://localhost:3000                     ║\n"
printf  "║  App local         http://localhost:3001                     ║\n"
if [ -n "$URL" ]; then
printf  "║  App externa       %-42s║\n" "$URL"
else
printf  "║  App externa       (túnel no disponible encara)              ║\n"
fi
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Port 3000: mai exposat externament (segur)                  ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "   Test d'ordres:  node scripts/test-orders.mjs"
echo ""
