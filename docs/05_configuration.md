# 05 — Configuració

Hi ha dos nivells de configuració: les **variables d'entorn** (`.env.local`) que configuren credencials i secrets, i els **settings** de l'aplicació que es guarden a SQLite i es poden canviar en calent des del dashboard.

---

## Variables d'entorn (`.env.local`)

El fitxer `.env.local` s'ha de crear a l'arrel del projecte. **Mai s'ha de pujar al repositori.**

```env
# ── Binance Testnet (Paper Trading) ─────────────────────────────
# Credencials de https://testnet.binance.vision
BINANCE_API_KEY=<testnet-api-key>
BINANCE_SECRET_KEY=<testnet-secret-key>

# ── Binance Mainnet (Real Trading) ──────────────────────────────
# Deixar buits per desactivar el mode real
BINANCE_API_KEY_REAL=<mainnet-api-key>
BINANCE_SECRET_KEY_REAL=<mainnet-secret-key>

# ── Telegram — Mode Paper ────────────────────────────────────────
TELEGRAM_BOT_TOKEN=<token-del-bot>
TELEGRAM_CHAT_ID=<chat-id>

# ── Telegram — Mode Real (opcional) ─────────────────────────────
# Si és buit, usa les credencials de paper per al mode real
TELEGRAM_BOT_TOKEN_REAL=
TELEGRAM_CHAT_ID_REAL=

# ── Autenticació del Dashboard ──────────────────────────────────
SESSION_SECRET=<mínim-32-caràcters-base64>
DASHBOARD_USERNAME=<nom-d-usuari>
DASHBOARD_PASSWORD=<contrasenya>
```

### Detall de cada variable

| Variable | Obligatòria | Descripció |
|----------|------------|-----------|
| `BINANCE_API_KEY` | ✅ | Clau API del Testnet de Binance |
| `BINANCE_SECRET_KEY` | ✅ | Secret del Testnet de Binance |
| `BINANCE_API_KEY_REAL` | ❌ | Clau API del Mainnet. Si buida → mode real desactivat |
| `BINANCE_SECRET_KEY_REAL` | ❌ | Secret del Mainnet |
| `TELEGRAM_BOT_TOKEN` | ❌ | Token del bot de Telegram (via @BotFather) |
| `TELEGRAM_CHAT_ID` | ❌ | ID del xat on s'envien les notificacions |
| `TELEGRAM_BOT_TOKEN_REAL` | ❌ | Bot separat per al mode real (fallback a paper si buit) |
| `TELEGRAM_CHAT_ID_REAL` | ❌ | Xat separat per al mode real |
| `SESSION_SECRET` | ✅ | Clau de xifrat de les cookies de sessió (≥32 chars) |
| `DASHBOARD_USERNAME` | ✅ | Usuari del dashboard |
| `DASHBOARD_PASSWORD` | ✅ | Contrasenya del dashboard |

> Si `TELEGRAM_BOT_TOKEN` és buit, les notificacions s'ignoren silenciosament. L'aplicació funciona amb normalitat.

---

## Variables d'entorn del servidor públic

El `server-public.mjs` accepta dues variables opcionals:

| Variable | Default | Descripció |
|----------|---------|-----------|
| `PUBLIC_PORT` | `3001` | Port on escolta el servidor públic |
| `NEXT_ORIGIN` | `http://localhost:3000` | URL del backend Next.js al qual proxeja |

---

## Settings de l'aplicació (SQLite)

Els settings es guarden a la taula `settings` de `data/cache.db`. Es gestionen des de la pestanya **Configuració** del dashboard o via `GET/POST /api/settings`.

### Motors i automatismes

| Clau | Default | Descripció |
|------|---------|-----------|
| `trailing_engine_enabled` | `true` | Activa el motor de trailing stops |
| `order_monitor_enabled` | `true` | Activa la detecció de fills d'ordres |
| `auto_trade_enabled` | `false` | Activa l'auto-trader (tots els bots) |
| `scheduler_enabled` | `true` | Activa les tasques periòdiques |

### Notificacions Telegram

| Clau | Default | Descripció |
|------|---------|-----------|
| `telegram_on_fill` | `true` | Notificar fills d'ordres |
| `telegram_on_trailing_activate` | `true` | Notificar activació de trailing |
| `telegram_on_trailing_move` | `false` | Notificar cada moviment del SL |
| `telegram_on_bot_entry` | `true` | Notificar entrades dels bots |
| `telegram_on_hourly_report` | `true` | Enviar informe horari |
| `telegram_on_daily_report` | `true` | Enviar informe diari |
| `telegram_on_error` | `true` | Notificar errors crítics |
| `telegram_on_consistency_alert` | `true` | Notificar divergències d'ordres |

### Quote asset i parells

| Clau | Default | Descripció |
|------|---------|-----------|
| `quote_asset` | `USDC` | Moneda quote de tots els parells (`USDC`, `USDT`, `BUSD`, `FDUSD`) |
| `priority_pairs` | `BTCUSDC,ETHUSDC,BNBUSDC,SOLUSDC,XRPUSDC` | Parells actius al dashboard i als bots (ha de coincidir amb `quote_asset`) |

> **Europa / Binance:** Binance Europa no permet USDT. Tots els parells han de ser en USDC. El setting `quote_asset` controla quin quote usa l'auto-trader per reescriure els símbols de les simulacions.
>
> **Nota tècnica:** El camp `symbol` dels `CoinRow` del mercat s'obté eliminant el quote asset del parell (`BTCUSDC` → `BTC`) via `.replace(/USDT|USDC/, "")`. Això permet que el PortfolioTab trobi el preu de mercat per a cada asset del balanç independentment de si el quote és USDT o USDC.

### Paràmetres de trading

| Clau | Default | Descripció |
|------|---------|-----------|
| `default_tp_pct` | `3.0` | Take Profit per defecte en % |
| `default_sl_pct` | `1.5` | Stop Loss per defecte en % |
| `default_trail_dist_pct` | `1.0` | Distància trailing per defecte en % |
| `atr_multiplier_tp` | `2.0` | Multiplicador ATR per al TP automàtic |
| `atr_multiplier_sl` | `1.0` | Multiplicador ATR per al SL automàtic |

### Sistema

| Clau | Default | Descripció |
|------|---------|-----------|
| `snapshot_interval_min` | `15` | Interval dels snapshots de portfolio en minuts |
| `cache_ttl_seconds` | `300` | TTL de la cache de klines i anàlisi (5 min) |
| `max_errors_kept` | `200` | Nombre màxim d'errors guardats a la DB |
| `log_level` | `info` | Nivell de log: `debug`, `info`, `warn`, `error` |

---

## Obtenir credencials de Binance

### Testnet (Paper Trading)
1. Ves a [https://testnet.binance.vision](https://testnet.binance.vision)
2. Inicia sessió amb GitHub
3. Genera un parell de claus API
4. Copia `BINANCE_API_KEY` i `BINANCE_SECRET_KEY`

### Mainnet (Real Trading)
1. Ves a [https://www.binance.com/en/my/settings/api-management](https://www.binance.com/en/my/settings/api-management)
2. Crea una nova clau API
3. Habilita permisos: **Spot & Margin Trading** + **Read Info**
4. ⚠️ No habilitis mai retirades via API
5. Copia `BINANCE_API_KEY_REAL` i `BINANCE_SECRET_KEY_REAL`

---

## Obtenir credencials de Telegram

1. Escriu a [@BotFather](https://t.me/BotFather) a Telegram
2. Executa `/newbot` i segueix les instruccions → obtindràs el **TOKEN**
3. Escriu `/start` al teu nou bot
4. Consulta `https://api.telegram.org/bot<TOKEN>/getUpdates`
5. Cerca `"chat":{"id":...}` → és el teu **CHAT_ID**

---

## Generar SESSION_SECRET

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Ha de tenir almenys 32 caràcters. Canviar-lo invalida totes les sessions actives.

---

## `server-public.mjs` — Whitelist d'endpoints

Per afegir nous endpoints accessibles des de l'app mòbil (port 3001), edita la constant `ALLOWED_API` a `server-public.mjs`:

```javascript
const ALLOWED_API = new Set([
  "POST /api/auth/login",
  "POST /api/auth/logout",
  "GET /api/status",
  "GET /api/pnl",
  "GET /api/orders",
  "GET /api/orders/trailing",
  "GET /api/balance",
  "GET /api/market",
  "GET /api/errors",
  "GET /api/activity",
  "GET /api/cost-basis",
  "GET /api/portfolio-snapshot",
  "GET /api/klines-range",
  // Afegeix nous endpoints aquí
]);
```

Format: `"MÈTODE /ruta/completa"`. Qualsevol ruta no present retorna **403 Forbidden**.
