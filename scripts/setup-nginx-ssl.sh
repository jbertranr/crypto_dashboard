#!/usr/bin/env bash
# scripts/setup-nginx-ssl.sh — Instal·la nginx + Let's Encrypt per test.bertran.info
#
# Executar UNA SOLA VEGADA al servidor Oracle de producció:
#   ssh cryptdesk-prod "cd /var/oled/cryptdesk/crypto_dashboard && bash scripts/setup-nginx-ssl.sh"
#
# Prerequisits (cal fer-los ABANS d'executar aquest script):
#   1. DNS: registre A test.bertran.info → IP del servidor Oracle
#   2. Oracle Cloud Console → Networking → VCN → Security Lists:
#      afegir Ingress Rules per TCP port 80 i TCP port 443 (source: 0.0.0.0/0)

set -euo pipefail

DOMAIN="test.bertran.info"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EMAIL="admin@bertran.info"

GREEN='\033[0;32m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { echo -e "${GREEN}   ✅ $*${NC}"; }
info() { echo -e "${CYAN}   ℹ  $*${NC}"; }
step() { echo -e "\n${BOLD}── $* ──${NC}"; }

step "Instal·lant nginx i certbot (Oracle Linux / dnf)"
sudo dnf install -y epel-release
sudo dnf install -y nginx certbot python3-certbot-nginx
ok "Paquets instal·lats"

step "Obrint ports 80 i 443 al firewall (firewalld)"
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
ok "Ports oberts"

step "Activant nginx"
sudo systemctl enable nginx
sudo systemctl start nginx || sudo systemctl reload nginx
ok "nginx actiu"

step "Configurant virtual host per $DOMAIN"
sudo cp "$APP_DIR/config/nginx-$DOMAIN.conf" "/etc/nginx/sites-available/$DOMAIN"
sudo ln -sf "/etc/nginx/sites-available/$DOMAIN" "/etc/nginx/sites-enabled/$DOMAIN"
# Desactivar el default per evitar conflictes de server_name
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
ok "Virtual host configurat"

step "Obtenint certificat Let's Encrypt per $DOMAIN"
sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL"
ok "Certificat obtingut"

step "Verificant renovació automàtica"
if sudo systemctl list-timers certbot.timer &>/dev/null 2>&1; then
  sudo systemctl enable certbot.timer
  ok "Renovació via systemd timer activada"
else
  # Fallback: cron job
  ( sudo crontab -l 2>/dev/null | grep -v certbot; echo "0 3 * * * certbot renew --quiet --post-hook 'systemctl reload nginx'" ) | sudo crontab -
  ok "Renovació via cron activada"
fi

echo ""
echo -e "${GREEN}${BOLD}   Setup completat ✓${NC}"
echo ""
info "Verifica amb: curl -I https://$DOMAIN/api/status"
info "Logs nginx:   sudo tail -f /var/log/nginx/error.log"
