# 07 — Desplegament i operació

---

## Entorns

| Entorn | On s'executa | Accés |
|--------|-------------|-------|
| **Desenvolupament** | Màquina local (Windows) | http://localhost:3000 |
| **Producció** | Oracle Cloud Free Tier (Ubuntu) | Via Cloudflare Tunnel |

---

## Arrencada en desenvolupament

### Opció recomanada: `start.sh`

```bash
bash start.sh
```

Fa tot automàticament:
1. Atura qualsevol procés anterior als ports 3000 i 3001
2. Arrenca Next.js al port 3000 (background)
3. Arrenca `server-public.mjs` al port 3001 (background)
4. Arrenca el túnel Cloudflare (background)
5. Mostra la URL pública generada

### Arrencada manual

```bash
# Terminal 1 — Next.js (dashboard + API)
npm run dev

# Terminal 2 — Servidor públic (app mòbil + proxy)
node server-public.mjs
```

### Arrencada en background des de Claude Code

Per evitar que VSCode es pengi, usar sempre `run_in_background: true`:

```bash
# Next.js
cd "c:/Users/jbert/claude/crypto_dashboard" && npm run dev > logs/dev-server.log 2>&1 &

# Servidor públic
cd "c:/Users/jbert/claude/crypto_dashboard" && node server-public.mjs > logs/www-server.log 2>&1 &
```

### Aturar ports

```bash
npx kill-port 3000 3001
```

---

## Túnel Cloudflare

El túnel exposa el port 3001 (app mòbil) a Internet via HTTPS. Genera una URL aleatòria nova cada cop que s'arrenca.

```bash
# Arrenca el túnel
cloudflared tunnel --url http://localhost:3001 > /tmp/cf-tunnel.log 2>&1 &

# Obté la URL generada
sleep 5 && grep -o 'https://[a-zA-Z0-9._-]*\.trycloudflare\.com' /tmp/cf-tunnel.log
```

`start.sh` fa això automàticament i mostra la URL al final. No cal actualitzar cap configuració de l'app mòbil quan canvia la URL (veure [06_mobile-app.md](06_mobile-app.md) — `config.js`).

Per notificar la URL nova via Telegram:
```bash
node scripts/notify-tunnel.mjs
```

---

## Desplegament a producció

### Prerequisits (una sola vegada)

```bash
cp .deploy.env.example .deploy.env
# Edita .deploy.env:
# PROD_HOST=<IP del servidor Oracle>
# PROD_SSH_KEY=<ruta a la clau SSH>
# PROD_USER=ubuntu
# PROD_PATH=/var/oled/cryptdesk/crypto_dashboard
```

SSH alias configurat a `~/.ssh/config`:
```
Host cryptdesk-prod
  HostName <IP del servidor>
  User ubuntu
  IdentityFile <ruta-clau-ssh>
```

### Desplegar

```bash
bash deploy.sh
```

**Flux de `deploy.sh`:**
1. Llegeix `.deploy.env`
2. SSH al servidor → `git pull origin master`
3. Fa backup del directori `.next` actual a `releases/YYYY-MM-DD_HH-MM/`
4. `npm ci --production`
5. `npm run build`
6. `pm2 restart cryptdesk`
7. Comprova que el servei ha arrencat correctament

Conserva els últims **5 builds** a `releases/`. Els anteriors s'eliminen automàticament.

### Rollback

Al servidor de producció:

```bash
bash scripts/rollback.sh
```

Restaura el build anterior de `releases/` i reinicia pm2.

---

## Servidor de producció (Oracle Cloud)

| Detall | Valor |
|--------|-------|
| Proveïdor | Oracle Cloud Free Tier |
| OS | Ubuntu 22.04 |
| SSH alias | `cryptdesk-prod` |
| Ruta del projecte | `/var/oled/cryptdesk/crypto_dashboard` |
| Gestor de processos | pm2 |
| Nom del procés pm2 | `cryptdesk` |
| Port intern | 3000 (Next.js) + 3001 (públic) |
| Accés extern | Via Cloudflare Tunnel (no Nginx) |

### Comandes útils al servidor

```bash
# Estat dels processos
pm2 status

# Logs en temps real
pm2 logs cryptdesk

# Reiniciar manualment
pm2 restart cryptdesk

# Veure últims N logs
pm2 logs cryptdesk --lines 100
```

### Configuració pm2 (`ecosystem.config.js`)

```javascript
module.exports = {
  apps: [{
    name: "cryptdesk",
    script: "node_modules/.bin/next",
    args: "start",
    cwd: "/var/oled/cryptdesk/crypto_dashboard",
    env: {
      NODE_ENV: "production",
      PORT: 3000
    }
  }]
};
```

---

## Logs

Els logs es guarden a `logs/` amb format `app-YYYY-MM-DD.log` (JSON estructurat via Pino).

```bash
# Llegir logs d'avui
cat logs/app-$(date +%Y-%m-%d).log | jq .

# Filtrar errors
cat logs/app-$(date +%Y-%m-%d).log | jq 'select(.level >= 50)'

# Seguir en temps real
tail -f logs/app-$(date +%Y-%m-%d).log
```

Nivells de log: `10` (trace) · `20` (debug) · `30` (info) · `40` (warn) · `50` (error) · `60` (fatal)

---

## Variables d'entorn a producció

El fitxer `.env.local` s'ha de copiar manualment al servidor. **No s'inclou al repositori.**

```bash
# Copiar des de local a producció
scp .env.local cryptdesk-prod:/var/oled/cryptdesk/crypto_dashboard/.env.local
```

Reiniciar pm2 després de canviar variables:
```bash
ssh cryptdesk-prod "pm2 restart cryptdesk"
```

---

## Verificació post-deploy

```bash
# Comprova que el backend respon
curl http://localhost:3000/api/status

# Comprova que el servidor públic respon
curl http://localhost:3001/api/status

# Comprova que el mode real està configurat (si escau)
curl http://localhost:3000/api/trading-mode
```
