# CryptDesk — Guia per a Claude

## Desplegament a producció

```bash
# 1. Configura la connexió (una sola vegada)
cp .deploy.env.example .deploy.env
# edita .deploy.env amb la IP/clau SSH del servidor Oracle

# 2. Desplega
bash deploy.sh

# 3. Rollback (al servidor de producció)
bash scripts/rollback.sh
```

**Flux:** `deploy.sh` (local) → git pull al servidor → backup del .next actual a `releases/` → `npm run build` → `pm2 restart`. Conserva els últims 5 builds.

---

## Arrencada del sistema

### Script d'inici (recomanat)

```bash
bash start.sh
```

Fa tot automàticament: atura el que estigui engegat, arrenca Next.js (3000), el servidor públic (3001) i el túnel Cloudflare. Mostra les URLs al final.

### Arrencada manual

```bash
# Port 3000 — Next.js (dashboard + API)
npm run dev

# Port 3001 — Servidor públic (proxy + estàtics)
node server-public.mjs
```

`server-public.mjs` serveix `public/www/` i proxeja cap al port 3000 **únicament** els endpoints necessaris per l'app mòbil (llista blanca opt-in). Qualsevol altra ruta retorna 403.

**No usar Python** (`python -m http.server`) — no fa el proxy de l'API.

### Parar ports

```bash
npx kill-port 3000 3001
```

### Arrencar en background des de Claude

Per evitar que VSCode es pengi, sempre usar `run_in_background: true`:

```bash
# Port 3000
cd "c:/Users/jbert/claude/crypto_dashboard" && npm run dev > logs/dev-server.log 2>&1 &

# Port 3001
cd "c:/Users/jbert/claude/crypto_dashboard" && node server-public.mjs > logs/www-server.log 2>&1 &
```

---

## Arquitectura de seguretat

| Port | Servidor | Exposat externament | Accés |
|------|----------|--------------------|----|
| 3000 | Next.js (dashboard + API) | ❌ mai | Només xarxa local |
| 3001 | `server-public.mjs` (proxy + estàtics) | ✅ via Cloudflare | Qualsevol dispositiu |

**El port 3000 mai s'exposa via Cloudflare.** L'app mòbil accedeix a l'API a través del port 3001, que fa de proxy cap al 3000 amb una llista blanca d'endpoints:

- `POST /api/auth/login` i `POST /api/auth/logout`
- `GET /api/status`, `/api/pnl`, `/api/orders`, `/api/orders/trailing`
- `GET /api/balance`, `/api/market`, `/api/errors`, `/api/activity`
- `GET /api/cost-basis`, `/api/portfolio-snapshot`, `/api/klines-range`

Qualsevol altra ruta (dashboard principal, endpoints d'acció/escriptura) retorna **403**.

Per afegir nous endpoints a l'app mòbil, editar `ALLOWED_API` a `server-public.mjs`.

## Accés extern via Cloudflare Tunnel

Només cal **un túnel**, per al port 3001:

```bash
cloudflared tunnel --url http://localhost:3001 > /tmp/cf-tunnel.log 2>&1 &
sleep 5 && grep -o 'https://[a-zA-Z0-9._-]*\.trycloudflare\.com' /tmp/cf-tunnel.log
```

Cada arrencada genera una URL aleatòria nova. L'script `start.sh` ho fa automàticament.

### config.js — URL de l'API

Com que el proxy és al mateix servidor (port 3001), `API_BASE` ha de ser buit (rutes relatives). El fitxer `public/www/config.js` ho gestiona automàticament:
- **localhost** → `http://localhost:3000` (accés directe al backend)
- **extern** → `""` (rutes relatives, el proxy del 3001 s'encarrega)

No cal actualitzar cap URL quan canvia el túnel.

---

## Estructura del projecte

- `app/` — Next.js: API routes, llibreries del backend, components React del dashboard principal
- `app/api/` — Endpoints REST (ordres, mercat, status, klines, auth…)
- `app/lib/` — Lògica de negoci: auto-trader, trailing engine, cache-store (SQLite), binance-auth
- `app/lib/scheduler.ts` — Tasques periòdiques: informe horari, diari, snapshot portfolio i comprovació consistència ordres
- `public/www/` — App mòbil estàtica (orders.html, portfolio.html, risks.html…) amb JS/CSS propis
- `public/www/config.js` — Configuració d'entorn: URL de l'API (local o externa via Cloudflare)
- `data/` — Base de dades SQLite (`cache.db`)
- `logs/` — Fitxers de log per dia
- `scripts/test-orders.mjs` — Script de test: compara ordres de Binance vs API local

## Notes importants

- La base de dades és SQLite a `data/cache.db`; les migracions s'apliquen automàticament en arrencar el backend
- `public/www/common.js` conté helpers compartits entre totes les pàgines mòbils; `config.js` es carrega abans i defineix `API_BASE`
- Els bots de trading s'activen a través de la configuració del dashboard (port 3000)
- El scheduler comprova cada hora si les ordres de Binance coincideixen amb la DB local; si detecta divergències envia alerta per Telegram
- Per testejar la consistència d'ordres manualment: `node scripts/test-orders.mjs`

---

## Trading real (Mainnet Binance)

L'aplicació suporta **paper trading** (Testnet, per defecte) i **real trading** (Mainnet) en paral·lel. Cada bot i cada ordre manual tria el mode independentment.

### Activació ràpida

1. Afegeix les claus reals al `.env.local`:
   ```env
   BINANCE_API_KEY_REAL=<la_teva_clau_mainnet>
   BINANCE_SECRET_KEY_REAL=<el_teu_secret_mainnet>
   ```
2. Reinicia l'aplicació
3. A la navegació apareix el toggle **PAPER | REAL** — clica **REAL** per activar-lo
4. Per crear un bot en mode real: **Configuració → Bots → Nou bot → Mode: REAL**

> Si `BINANCE_API_KEY_REAL` és buit, el botó REAL queda desactivat automàticament.

Documentació completa: [`docs/paper-real-trading.md`](docs/paper-real-trading.md)
