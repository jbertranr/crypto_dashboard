#!/usr/bin/env bash
# scripts/rollback.sh — Reverteix a una versió anterior de CryptDesk
#
# Ús (al servidor de producció):
#   bash scripts/rollback.sh              → llista versions i demana quina
#   bash scripts/rollback.sh <nom_versió> → rollback directe
#   bash scripts/rollback.sh --latest     → rollback a la versió anterior
#
# Des del local (via deploy.sh --rollback):
#   bash deploy.sh --rollback

set -euo pipefail

# --yes salta la confirmació interactiva (usat pel backend web)
AUTO_YES=false
ARGS=()
for arg in "$@"; do
  [ "$arg" = "--yes" ] && AUTO_YES=true || ARGS+=("$arg")
done
set -- "${ARGS[@]+"${ARGS[@]}"}"

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="$APP_DIR/releases"
PM2_APP="crypto-app"
PM2_APP2="public-server"

# ── Colors ────────────────────────────────────────────────────────────────────

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()  { echo -e "${CYAN}   ℹ  $*${NC}"; }
ok()    { echo -e "${GREEN}   ✅ $*${NC}"; }
warn()  { echo -e "${YELLOW}   ⚠  $*${NC}"; }
error() { echo -e "${RED}   ❌ $*${NC}"; exit 1; }
step()  { echo -e "\n${BOLD}── $* ──${NC}"; }

cd "$APP_DIR"

# ── Llista versions disponibles ───────────────────────────────────────────────

list_releases() {
  find "$BACKUP_DIR" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | sort -r
}

release_count() {
  list_releases | wc -l
}

if [ ! -d "$BACKUP_DIR" ] || [ "$(release_count)" -eq 0 ]; then
  error "No hi ha cap versió guardada a $BACKUP_DIR"
fi

# ── Banner ────────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║       CryptDesk — Rollback                   ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════╝${NC}"
echo ""

# ── Versió actual ─────────────────────────────────────────────────────────────

CURRENT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "desconegut")
echo -e "   Versió activa: ${BOLD}$CURRENT_COMMIT${NC}"
echo ""

# ── Selecció de versió ────────────────────────────────────────────────────────

TARGET=""

if [ "${1:-}" = "--latest" ]; then
  TARGET=$(list_releases | head -1)
elif [ -n "${1:-}" ]; then
  # Nom passat directament
  if [ -d "$BACKUP_DIR/$1" ]; then
    TARGET="$BACKUP_DIR/$1"
  else
    error "Versió '$1' no trobada a $BACKUP_DIR"
  fi
else
  # Mode interactiu — llista les versions i demana
  echo -e "   ${BOLD}Versions guardades:${NC}"
  echo ""

  i=1
  declare -a DIRS=()
  while IFS= read -r dir; do
    DIRS+=("$dir")
    name=$(basename "$dir")
    commit="—"
    saved="—"
    if [ -f "$dir/meta.json" ]; then
      commit=$(python3 -c "import json; d=json.load(open('$dir/meta.json')); print(d.get('commit','—'))" 2>/dev/null || echo "—")
      saved=$(python3  -c "import json; d=json.load(open('$dir/meta.json')); print(d.get('savedAt','—'))" 2>/dev/null || echo "—")
    fi
    printf "   ${CYAN}%2d)${NC}  %-28s  commit %-8s  %s\n" "$i" "$name" "$commit" "$saved"
    i=$(( i + 1 ))
  done < <(list_releases)

  echo ""
  read -r -p "   Quina versió restaurar? (1-$(( i-1 )), o 'q' per cancel·lar): " choice

  [[ "$choice" =~ ^[qQ]$ ]] && { info "Cancel·lat."; exit 0; }
  [[ "$choice" =~ ^[0-9]+$ ]] || error "Opció invàlida"
  idx=$(( choice - 1 ))
  [ "$idx" -lt 0 ] || [ "$idx" -ge "${#DIRS[@]}" ] && error "Número fora de rang"

  TARGET="${DIRS[$idx]}"
fi

TARGET_NAME=$(basename "$TARGET")
info "Rollback a: $TARGET_NAME"

# ── Confirmació ───────────────────────────────────────────────────────────────

echo ""
echo -e "   ${YELLOW}${BOLD}Atenció: es reemplaçarà el .next actual per la versió seleccionada.${NC}"
echo -e "   ${YELLOW}El codi font (app/, lib/, etc.) NO canvia — només el build.${NC}"
echo ""
if ! $AUTO_YES; then
  read -r -p "   Confirmar rollback? [s/N] " resp
  [[ "$resp" =~ ^[sS]$ ]] || { info "Cancel·lat."; exit 0; }
fi

# ── Backup del .next actual (per si el rollback falla) ────────────────────────

step "Backup de seguretat"

if [ -d "$APP_DIR/.next" ]; then
  SAFETY="$BACKUP_DIR/_safety_$(date +%Y%m%d_%H%M%S)"
  mkdir -p "$SAFETY"
  cp -r "$APP_DIR/.next" "$SAFETY/.next"
  ok "Backup de seguretat desat a releases/$(basename "$SAFETY")"
fi

# ── Restauració ───────────────────────────────────────────────────────────────

step "Restauració del build"

if [ ! -d "$TARGET/.next" ]; then
  error "El backup $TARGET_NAME no conté .next — backup incomplet"
fi

rm -rf "$APP_DIR/.next"
cp -r  "$TARGET/.next" "$APP_DIR/.next"
ok "Build restaurat des de $TARGET_NAME"

# ── Restart PM2 ───────────────────────────────────────────────────────────────

step "Restart PM2"

if pm2 describe "$PM2_APP" &>/dev/null; then
  pm2 restart "$PM2_APP" --update-env 2>&1 | grep -E "restarted|online|error" | sed 's/^/   /' || true
  ok "$PM2_APP reiniciat"
else
  warn "$PM2_APP no existeix a PM2"
fi

if pm2 describe "$PM2_APP2" &>/dev/null; then
  pm2 restart "$PM2_APP2" 2>&1 | grep -E "restarted|online|error" | sed 's/^/   /' || true
  ok "$PM2_APP2 reiniciat"
fi

pm2 save --force &>/dev/null || true

# ── Verificació ───────────────────────────────────────────────────────────────

step "Verificació"

sleep 3
if curl -sf http://localhost:3000/api/status &>/dev/null; then
  ok "API respon correctament"
else
  warn "L'API no respon — pot estar arrencant. Comprova: pm2 logs $PM2_APP"
fi

# ── Resum ─────────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║  Rollback completat ✓                        ║${NC}"
echo -e "${GREEN}${BOLD}╠══════════════════════════════════════════════╣${NC}"
printf  "${GREEN}${BOLD}║  Restaurat: %-33s║${NC}\n" "$TARGET_NAME"
echo -e "${GREEN}${BOLD}╠══════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}${BOLD}║  Per desfer: bash scripts/rollback.sh        ║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════╝${NC}"
echo ""
