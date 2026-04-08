#!/usr/bin/env bash
# scripts/remote-deploy.sh — S'executa AL SERVIDOR de producció
# Cridat per deploy.sh. No executar directament tret que sàpigues el que fas.
#
# Ús: bash scripts/remote-deploy.sh [branca]
#
# Fa:
#   1. git pull
#   2. npm ci (si package-lock.json ha canviat)
#   3. Backup de la versió actual (.next + metadades)
#   4. npm run build
#   5. pm2 restart
#   6. Neteja de backups antics (conserva els últims N)

set -euo pipefail

BRANCH="${1:-master}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="$APP_DIR/releases"
MAX_BACKUPS=5
PM2_APP="crypto-app"
PM2_APP2="public-server"   # pot no existir, s'ignora l'error

# ── Colors ────────────────────────────────────────────────────────────────────

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'
BOLD='\033[1m'; NC='\033[0m'

info() { echo -e "${CYAN}   ℹ  $*${NC}"; }
ok()   { echo -e "${GREEN}   ✅ $*${NC}"; }
warn() { echo -e "${YELLOW}   ⚠  $*${NC}"; }
step() { echo -e "\n${BOLD}── $* ──${NC}"; }

cd "$APP_DIR"

step "git pull ($BRANCH)"

git fetch origin "$BRANCH" 2>&1 | sed 's/^/   /'
git reset --hard "origin/$BRANCH" 2>&1 | sed 's/^/   /'
COMMIT=$(git rev-parse --short HEAD)
COMMIT_MSG=$(git log -1 --pretty=format:"%s")
ok "Commit: $COMMIT — $COMMIT_MSG"

# ── npm ci si les dependències han canviat ────────────────────────────────────

step "Dependències"

LOCK_CHANGED=$(git diff HEAD@{1} HEAD --name-only 2>/dev/null | grep "package-lock.json" || true)
if [ -n "$LOCK_CHANGED" ] || [ ! -d node_modules ]; then
  info "package-lock.json canviat — executant npm ci..."
  npm ci --prefer-offline 2>&1 | tail -5 | sed 's/^/   /'
  ok "Dependències actualitzades"
else
  ok "Dependències sense canvis (omès)"
fi

# ── Backup de la versió actual ────────────────────────────────────────────────

step "Backup versió actual"

mkdir -p "$BACKUP_DIR"

if [ -d "$APP_DIR/.next" ]; then
  STAMP=$(date +"%Y%m%d_%H%M%S")
  PREV_COMMIT=$(git rev-parse --short HEAD@{1} 2>/dev/null || echo "unknown")
  BACKUP_NAME="${STAMP}_${PREV_COMMIT}"
  BACKUP_PATH="$BACKUP_DIR/$BACKUP_NAME"

  mkdir -p "$BACKUP_PATH"
  cp -r "$APP_DIR/.next"       "$BACKUP_PATH/.next"
  cp    "$APP_DIR/package.json" "$BACKUP_PATH/package.json"

  # Guarda metadades del backup
  cat > "$BACKUP_PATH/meta.json" <<EOF
{
  "commit":    "$PREV_COMMIT",
  "branch":    "$BRANCH",
  "savedAt":   "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "deployedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF
  ok "Backup desat a releases/$BACKUP_NAME"
else
  warn "Sense .next anterior — primer desplegament"
fi

# ── Build ─────────────────────────────────────────────────────────────────────

step "Build (npm run build)"

info "Compilant — pot trigar 1-2 min..."
npm run build 2>&1 | grep -E "✓|✗|error|warning|Route|warn|compiled|Finished" | sed 's/^/   /' || {
  warn "Build complet (alguns warnings suprimits)"
}
ok "Build completat"

# ── Restart PM2 ───────────────────────────────────────────────────────────────

step "Restart PM2"

if pm2 describe "$PM2_APP" &>/dev/null; then
  pm2 restart "$PM2_APP" --update-env 2>&1 | grep -E "restarted|online|error" | sed 's/^/   /' || true
  ok "$PM2_APP reiniciat"
else
  warn "$PM2_APP no existeix a PM2 — arrencant de nou"
  pm2 start npm --name "$PM2_APP" -- start
fi

# Servidor públic (port 3001)
if pm2 describe "$PM2_APP2" &>/dev/null; then
  pm2 restart "$PM2_APP2" --update-env 2>&1 | grep -E "restarted|online|error" | sed 's/^/   /' || true
  ok "$PM2_APP2 reiniciat"
else
  info "Arrencant $PM2_APP2 per primera vegada..."
  pm2 start node --name "$PM2_APP2" -- "$APP_DIR/server-public.mjs"
  ok "$PM2_APP2 engegat"
fi

pm2 save --force &>/dev/null || true

# ── Reload nginx (si existeix) ────────────────────────────────────────────────

if sudo systemctl is-active --quiet nginx 2>/dev/null; then
  if sudo nginx -t 2>/dev/null; then
    sudo systemctl reload nginx
    ok "nginx recarregat"
  else
    warn "Config nginx invàlida — reload omès"
  fi
fi

# ── Neteja backups antics ─────────────────────────────────────────────────────

step "Neteja backups"

BACKUP_COUNT=$(find "$BACKUP_DIR" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | wc -l)
if [ "$BACKUP_COUNT" -gt "$MAX_BACKUPS" ]; then
  TO_DELETE=$(find "$BACKUP_DIR" -maxdepth 1 -mindepth 1 -type d | sort | head -$(( BACKUP_COUNT - MAX_BACKUPS )))
  echo "$TO_DELETE" | while read -r dir; do
    rm -rf "$dir"
    info "Eliminat: $(basename "$dir")"
  done
  ok "Conservats els últims $MAX_BACKUPS backups"
else
  ok "$BACKUP_COUNT backup(s) — sense neteja necessària"
fi

# ── Llista backups disponibles ────────────────────────────────────────────────

echo ""
info "Backups disponibles (per rollback):"
find "$BACKUP_DIR" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | sort -r | while read -r dir; do
  name=$(basename "$dir")
  commit="—"
  if [ -f "$dir/meta.json" ]; then
    commit=$(python3 -c "import json,sys; d=json.load(open('$dir/meta.json')); print(d.get('commit','—'))" 2>/dev/null || echo "—")
  fi
  echo "      $name  (commit: $commit)"
done

echo ""
echo -e "${GREEN}${BOLD}   Desplegament completat ✓  commit $COMMIT${NC}"
echo ""
