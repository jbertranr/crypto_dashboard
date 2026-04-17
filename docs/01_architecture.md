# 01 — Arquitectura del sistema

## Visió general

CryptDesk és una aplicació Next.js 16 (App Router) que actua simultàniament com a:
- **Dashboard web** per gestionar el trading (port 3000, accés local)
- **Backend API** per als motors de servidor i l'app mòbil
- **Servidor públic** que exposa l'app mòbil amb proxy segur (port 3001, accés extern)

---

## Diagrama de capes

```
┌─────────────────────────────────────────────────────────────┐
│  Dispositius externs (mòbil, etc.)                          │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTPS
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Cloudflare Tunnel (URL aleatòria per sessió)               │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  server-public.mjs  (port 3001)                             │
│  • Serveix public/www/ (HTML/JS/CSS estàtics)               │
│  • Proxeja 12 endpoints de consulta → port 3000             │
│  • Qualsevol altra ruta → 403 Forbidden                     │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP local
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Next.js  (port 3000) — mai exposat externament             │
│  ├── App Router: React components + SSR                     │
│  ├── API Routes: ~50 endpoints REST                         │
│  └── Singleton motors: TrailingEngine, OrderMonitor         │
└──────┬────────────────────────────────┬─────────────────────┘
       │                                │
       ▼                                ▼
┌─────────────┐                ┌────────────────────┐
│  SQLite     │                │  APIs externes     │
│  cache.db   │                │  • Binance Testnet │
│  paper.db   │                │  • Binance Mainnet │
│  real.db    │                │  • Telegram Bot    │
└─────────────┘                └────────────────────┘
```

---

## Ports i exposició

| Port | Procés | Exposat externament | Protecció |
|------|--------|--------------------|-----------| 
| 3000 | Next.js | ❌ Mai | Només xarxa local |
| 3001 | server-public.mjs | ✅ Via Cloudflare | Whitelist 12 endpoints |

**Regla fonamental:** el port 3000 mai s'exposa a Internet. Tot l'accés extern passa per 3001, que actua de proxy restringit.

---

## Separació paper / real

El sistema manté dos entorns completament independents:

| Aspecte | Paper (Testnet) | Real (Mainnet) |
|---------|-----------------|---------------|
| URL Binance | `demo-api.binance.com` | `api.binance.com` |
| Credencials | `BINANCE_API_KEY` | `BINANCE_API_KEY_REAL` |
| Base de dades | `data/paper.db` | `data/real.db` |
| Bots | mode: "paper" | mode: "real" |
| Journal | entrades paper | entrades real |
| Default | ✅ Sempre | ❌ Requereix clau + confirmació |

La infraestructura compartida (cache, snapshots, settings, errors) viu a `data/cache.db`.

---

## Cicle de vida d'una ordre

```
1. Usuari → NewOrderModal (dashboard port 3000)
   │
   ▼
2. POST /api/orders/new { symbol, side, price, qty, mode }
   │
   ▼
3. binance-auth.ts → Binance API (testnet o mainnet)
   │
   ├─→ Ordre creada → desa order_meta + strategy a cache.db
   │
   ▼
4. OrderMonitor (cada 35s) detecta canvi d'estat
   │
   ├─→ FILLED → pnl-calc → journal-store → Telegram notificació
   └─→ CANCELLED (altra cama OCO) → s'ignora
```

---

## Cicle de vida d'un trailing stop

```
1. Usuari configura trailing (activateAt, trailDist) via UI
   │
   ▼
2. POST /api/orders/trailing → desa a order_trailing (pendent)
   │
   ▼
3. TrailingEngine (cada 30s) comprova preu actual
   │
   ├─→ preu > activateAt → activa trailing:
   │     cancel·la OCO original → col·loca SL nou → mou a trailing_active
   │
   └─→ trailing actiu + nou màxim → mou SL amunt (cancel·la + reemplaça)
         │
         └─→ SL executat → Telegram notificació
```

---

## Cicle de vida d'un bot

```
1. Usuari crea bot (Configuració → Bots) amb mode paper|real
   │
   ▼
2. Scheduler (cada 60s) → AutoTrader.tick()
   │
   ├─→ comprova si nova vela tancada
   ├─→ getAnalysis(symbol, interval)
   ├─→ avalua criteris d'entrada (score, volum, patrons)
   │
   ├─→ NO ENTRA → espera propera vela
   │
   └─→ ENTRA → placeMarketBuy(symbol, qty, bot.mode)
                 └─→ placeOcoOrder (TP/SL automàtic)
                     └─→ journalAdd + Telegram notificació
```

---

## Motors de servidor (singletons)

Tres processos que s'inicien en el primer request HTTP i continuen actius:

| Motor | Fitxer | Interval | Propòsit |
|-------|--------|---------|---------|
| TrailingEngine | `app/lib/trailing-engine.ts` | 30s | Activa i mou trailing stops |
| OrderMonitor | `app/lib/order-monitor.ts` | 35s | Detecta fills i notifica |
| Scheduler | `app/lib/scheduler.ts` | Múltiple | Reports, snapshots, consistència |

Els singletons es guarden a `globalThis` per sobreviure els hot-reloads de Next.js en desenvolupament.

---

## Server-Sent Events (SSE)

El dashboard utilitza SSE per rebre actualitzacions en temps real sense polling:

- **Endpoint:** `GET /api/stream`
- **Event bus:** `app/lib/event-bus.ts` — singleton que distribueix events a tots els clients connectats
- **Proveïdor:** `ServerEventsProvider.tsx` — component React que manté la connexió SSE
- **Tipus d'events:** fills d'ordres, activacions de trailing, canvis de status dels motors, nous logs

---

## Autenticació

- Basada en `iron-session` (cookies xifrades)
- Credencials configurades a `.env.local`: `DASHBOARD_USERNAME` + `DASHBOARD_PASSWORD`
- Sessió: `POST /api/auth/login` → cookie HttpOnly → `POST /api/auth/logout`
- Totes les API routes comproven la sessió via middleware

---

## Cache i rendiment

| Capa | Mecanisme | TTL |
|------|-----------|-----|
| Klines (veles OHLCV) | SQLite `api_cache` | 5 minuts |
| Anàlisi tècnica | SQLite `api_cache` | 5 minuts |
| Preu de mercat | Cap cache (fetch directe) | — |
| Snapshots portfolio | SQLite `snapshots` | Persistents |

Invalidació manual: `DELETE /api/cache/invalidate?prefix=klines`
