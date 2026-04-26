# 06 — App Mòbil (public/www)

L'app mòbil és una aplicació web estàtica independent del dashboard principal de Next.js. Està optimitzada per a pantalles petites i s'accedeix via el port 3001 (exposat externament via Cloudflare Tunnel).

---

## Arquitectura

```
Dispositiu mòbil (Internet)
        │ HTTPS
        ▼
Cloudflare Tunnel
        │
        ▼
server-public.mjs (port 3001)
  ├── Serveix: public/www/*.html, *.js, *.css
  └── Proxeja: 12 endpoints de consulta → port 3000
```

L'app mòbil **no té accés directe** al port 3000 ni al dashboard principal. Tota comunicació passa pel proxy de `server-public.mjs`.

---

## Estructura de fitxers

```
public/www/
├── index.html          ← Pàgina principal (balance, ordres, errors)
├── portfolio.html      ← Detall del portfolio per asset
├── orders.html         ← Ordres obertes agrupades per símbol
├── risks.html          ← Valoració de riscos i alertes
├── logs.html           ← Visor de logs en temps real
├── motors.html         ← Estat dels motors de servidor
├── settings.html       ← Configuració bàsica de l'app
│
├── config.js           ← API_BASE: lògica localhost vs extern
├── common.js           ← Helpers compartits, auth, fetch utils
├── app.js              ← Lògica principal + routing entre pàgines
├── portfolio.js        ← Lògica específica de portfolio.html
├── orders.js           ← Lògica específica de orders.html
├── risks.js            ← Lògica específica de risks.html
├── logs.js             ← Lògica específica de logs.html
├── motors.js           ← Lògica específica de motors.html
│
└── styles/
    └── mobile.css      ← Estils optimitzats per a mòbil
```

---

## Pàgines

### `index.html` — Dashboard principal
- Balanç total del compte (crypto + stablecoins)
- Resum d'ordres obertes
- P&L de les últimes 24h
- Últims errors del sistema

### `portfolio.html` — Portfolio detallat
- Llista de tots els assets amb valor, % del total i P&L
- Distribució crypto vs stablecoins
- Cost mig d'entrada per asset

### `orders.html` — Ordres obertes
- Ordres agrupades per símbol
- Tipus (LIMIT, OCO), preu i distància al preu actual
- Trailing stops actius i pendents

### `risks.html` — Riscos
- Posicions amb SL massa llunyà
- Posicions sense SL configurada
- Concentració excessiva en un asset
- Alertes de balanç baix

### `logs.html` — Logs
- Stream dels últims logs del servidor
- Filtres per nivell (info, warn, error)
- Cerca per text

### `motors.html` — Motors de servidor
- Estat del TrailingEngine i OrderMonitor
- Última execució i errors recents
- Toggle per activar/desactivar

### `settings.html` — Configuració
- Ajustos bàsics accessibles des del mòbil
- Notificacions Telegram (on/off)

---

## `config.js` — Detecció d'entorn

```javascript
// Detecta si s'accedeix en local o des d'extern
if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
  window.API_BASE = "http://localhost:3000";  // Accés directe al backend
} else {
  window.API_BASE = "";  // Rutes relatives → el proxy del 3001 s'encarrega
}
```

Amb `API_BASE = ""`, totes les crides API usen rutes relatives (ex: `/api/balance`), que el proxy de `server-public.mjs` redirigeix al port 3000. **No cal actualitzar cap URL quan canvia el túnel Cloudflare.**

---

## `common.js` — Helpers compartits

Funcions disponibles globalment a totes les pàgines:

| Funció | Descripció |
|--------|-----------|
| `apiFetch(path, opts)` | Fetch autenticat amb `API_BASE` prefixat |
| `formatUsdt(value)` | Formata un número com a USDC (ex: `$1,234.56`) |
| `formatPct(value)` | Formata un percentatge (ex: `+2.34%`) |
| `checkAuth()` | Comprova si la sessió és vàlida, redirigeix a login si no |
| `logout()` | Tanca sessió i redirigeix |
| `showError(msg)` | Mostra error toast a l'usuari |
| `showSuccess(msg)` | Mostra success toast |

---

## Flux d'autenticació

```
1. Usuari accedeix a qualsevol pàgina
2. common.js → checkAuth() → GET /api/status
   ├── 200 OK → usuari autenticat → carrega la pàgina
   └── 401 → redirigeix a /login.html (o index si no configurat)

3. Login:
   POST /api/auth/login { username, password }
   ├── 200 → cookie de sessió HttpOnly → redirigeix al dashboard
   └── 401 → mostra error

4. Logout:
   POST /api/auth/logout → destrueix cookie → redirigeix
```

La cookie de sessió és HttpOnly (no accessible via JS) i es gestiona automàticament pel navegador.

---

## Endpoints accessibles des del mòbil

Tots els endpoints accessibles (whitelist del proxy) són de **només lectura**. Cap operació d'escriptura és accessible des del port 3001:

| Mètode | Endpoint | Pàgina que l'usa |
|--------|----------|-----------------|
| `POST` | `/api/auth/login` | Login |
| `POST` | `/api/auth/logout` | Totes |
| `GET` | `/api/status` | motors.html, checkAuth |
| `GET` | `/api/balance` | index.html, portfolio.html |
| `GET` | `/api/orders` | orders.html |
| `GET` | `/api/orders/trailing` | orders.html |
| `GET` | `/api/pnl` | index.html, portfolio.html |
| `GET` | `/api/cost-basis` | portfolio.html |
| `GET` | `/api/portfolio-snapshot` | portfolio.html |
| `GET` | `/api/market` | index.html |
| `GET` | `/api/errors` | index.html |
| `GET` | `/api/activity` | index.html |
| `GET` | `/api/klines-range` | portfolio.html (gràfic) |

---

## Seguretat del proxy

`server-public.mjs` implementa dues proteccions:

1. **Whitelist opt-in:** qualsevol ruta `/api/*` no present a `ALLOWED_API` retorna `403 Forbidden` immediatament, sense arribar al port 3000.

2. **Path traversal prevention:** per als fitxers estàtics, comprova que la ruta resolta estigui dins de `public/www/`. Qualsevol intent de sortir del directori retorna `403`.

```javascript
// Exemple de petició bloquejada:
GET /api/orders/new   → 403 (endpoint d'escriptura)
GET /../.env.local    → 403 (path traversal)
GET /api/deploy       → 403 (endpoint restringit)
```

---

## Com afegir una nova pàgina

1. Crea `public/www/nova-pagina.html` amb l'estructura base:
   ```html
   <!DOCTYPE html>
   <html>
   <head>
     <script src="config.js"></script>
     <script src="common.js"></script>
   </head>
   <body>
     <!-- contingut -->
     <script src="nova-pagina.js"></script>
   </body>
   </html>
   ```

2. Crea `public/www/nova-pagina.js` amb la lògica

3. Si necessita nous endpoints de l'API, afegeix-los a `ALLOWED_API` a `server-public.mjs` (veure [05_configuration.md](05_configuration.md))

4. Afegeix l'enllaç a la navegació de `common.js` o a `index.html`

---

## Vegeu també

[[01_architecture]] · [[05_configuration]] · [[08_integrations]] · [[07_deployment]]
