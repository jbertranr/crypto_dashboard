#!/usr/bin/env bash
# deploy.sh — Desplega CryptDesk a producció (Oracle Free Tier)
#
# Ús:
#   bash deploy.sh              → desplega la branca actual
#   bash deploy.sh --dry-run    → mostra el que faria sense executar res
#
# Prerequisits locals:
#   - SSH configurat a ~/.ssh/config amb l'alias 'cryptdesk-prod'
#     o definir PROD_HOST / PROD_USER / PROD_KEY al fitxer .deploy.env
#   - Git amb tots els canvis commitats

set -euo pipefail

# ── Configuració ──────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_ENV="$SCRIPT_DIR/.deploy.env"

# Valors per defecte (sobreescrits per .deploy.env)
PROD_HOST=""
PROD_USER="opc"
PROD_KEY=""           # buit = usa l'agent SSH o la clau per defecte
PROD_DIR="/var/oled/cryptdesk/crypto_dashboard"
SSH_ALIAS=""          # si existeix, s'usa en lloc de PROD_HOST

# Carrega configuració local si existeix
if [ -f "$DEPLOY_ENV" ]; then
  # shellcheck source=/dev/null
  source "$DEPLOY_ENV"
fi

DRY_RUN=false
for arg in "$@"; do
  [ "$arg" = "--dry-run" ] && DRY_RUN=true
done

# ── Colors ────────────────────────────────────────────────────────────────────

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${CYAN}ℹ  $*${NC}"; }
ok()      { echo -e "${GREEN}✅ $*${NC}"; }
warn()    { echo -e "${YELLOW}⚠  $*${NC}"; }
error()   { echo -e "${RED}❌ $*${NC}"; exit 1; }
step()    { echo -e "\n${BOLD}── $* ──${NC}"; }
dry_run() { echo -e "${YELLOW}[DRY-RUN] $*${NC}"; }

# ── Validació SSH ─────────────────────────────────────────────────────────────

build_ssh_cmd() {
  if [ -n "$SSH_ALIAS" ]; then
    echo "ssh $SSH_ALIAS"
  elif [ -n "$PROD_HOST" ]; then
    local key_opt=""
    [ -n "$PROD_KEY" ] && key_opt="-i $PROD_KEY"
    echo "ssh $key_opt ${PROD_USER}@${PROD_HOST}"
  else
    error "Cal configurar SSH. Crea .deploy.env o configura ~/.ssh/config amb l'alias 'cryptdesk-prod' i afegeix SSH_ALIAS=cryptdesk-prod"
  fi
}

SSH_CMD=$(build_ssh_cmd)

# ── Banner ────────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║       CryptDesk — Desplegament               ║${NC}"
$DRY_RUN && \
echo -e "${BOLD}║       *** MODE DRY-RUN ***                   ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════╝${NC}"
echo ""

# ── 1. Comprova que tot és comitat ────────────────────────────────────────────

step "1. Verificació Git"

BRANCH=$(git -C "$SCRIPT_DIR" rev-parse --abbrev-ref HEAD)
COMMIT=$(git -C "$SCRIPT_DIR" rev-parse --short HEAD)
info "Branca: $BRANCH  |  Commit: $COMMIT"

DIRTY=$(git -C "$SCRIPT_DIR" status --porcelain 2>/dev/null || true)
if [ -n "$DIRTY" ]; then
  warn "Hi ha canvis no commitats:"
  git -C "$SCRIPT_DIR" status --short
  echo ""
  read -r -p "Continuar igualment? [s/N] " resp
  [[ "$resp" =~ ^[sS]$ ]] || { info "Desplegament cancel·lat."; exit 0; }
else
  ok "Working tree net"
fi

# ── 2. Comprova connectivitat SSH ─────────────────────────────────────────────

step "2. Connectivitat SSH"

if $DRY_RUN; then
  dry_run "ssh ping a $PROD_HOST (omès en dry-run)"
else
  if $SSH_CMD "echo ok" &>/dev/null; then
    ok "SSH operatiu"
  else
    error "No s'ha pogut connectar. Comprova .deploy.env o ~/.ssh/config"
  fi
fi

# ── 3. Envia el codi ──────────────────────────────────────────────────────────

step "3. Sincronització de codi"

if $DRY_RUN; then
  dry_run "git push + git pull al servidor"
else
  # Push local → remot (si existeix un remot 'origin')
  if git -C "$SCRIPT_DIR" remote | grep -q "origin"; then
    info "Pujant a origin..."
    git -C "$SCRIPT_DIR" push origin "$BRANCH" 2>&1 | sed 's/^/   /'
    ok "Push completat"
  else
    warn "Sense remot 'origin' — usant rsync directe"
    RSYNC_EXCLUDE=(
      --exclude='.git'
      --exclude='node_modules'
      --exclude='.next'
      --exclude='data'
      --exclude='logs'
      --exclude='.env.local'
      --exclude='simulation'
      --exclude='.deploy.env'
    )
    rsync -az --delete "${RSYNC_EXCLUDE[@]}" \
      "$SCRIPT_DIR/" \
      "${PROD_USER}@${PROD_HOST}:${PROD_DIR}/"
    ok "rsync completat"
  fi
fi

# ── 4. Executa el desplegament al servidor ────────────────────────────────────

step "4. Desplegament al servidor"

REMOTE_SCRIPT="$PROD_DIR/scripts/remote-deploy.sh"

if $DRY_RUN; then
  dry_run "$SSH_CMD bash $REMOTE_SCRIPT $BRANCH"
else
  info "Executant remote-deploy.sh al servidor..."
  echo ""
  $SSH_CMD "bash $REMOTE_SCRIPT $BRANCH" 2>&1 | sed 's/^/   /'
  echo ""
  ok "Desplegament remot completat"
fi

# ── 5. Verificació final ──────────────────────────────────────────────────────

step "5. Verificació"

if $DRY_RUN; then
  dry_run "Health check a l'API"
else
  sleep 3
  if $SSH_CMD "curl -sf http://localhost:3000/api/status" &>/dev/null; then
    ok "API respon correctament"
  else
    warn "L'API no respon — pot estar arrencant. Comprova: pm2 logs crypto-app"
  fi
fi

# ── Resum ─────────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║  Desplegament completat ✓                    ║${NC}"
echo -e "${GREEN}${BOLD}╠══════════════════════════════════════════════╣${NC}"
printf  "${GREEN}${BOLD}║  Commit: %-36s║${NC}\n" "$COMMIT ($BRANCH)"
echo -e "${GREEN}${BOLD}╠══════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}${BOLD}║  Logs:   pm2 logs crypto-app                 ║${NC}"
echo -e "${GREEN}${BOLD}║  Rollback: bash scripts/rollback.sh          ║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════╝${NC}"
echo ""
