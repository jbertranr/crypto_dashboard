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

### Motors i automatismes (per mode)

Cada motor té una variant `_real` per al mode real. La clau sense sufix és per a paper.

| Clau | Default | Descripció |
|------|---------|-----------|
| `trailing_engine_enabled` | `1` | Motor de trailing stops (paper) |
| `trailing_engine_enabled_real` | `1` | Motor de trailing stops (real) |
| `order_monitor_enabled` | `1` | Detecció de fills d'ordres (paper) |
| `order_monitor_enabled_real` | `1` | Detecció de fills d'ordres (real) |
| `auto_trade_enabled` | `0` | Auto-trader — master switch (paper) |
| `auto_trade_enabled_real` | `0` | Auto-trader — master switch (real) |
| `scheduler_enabled` | `1` | Tasques periòdiques (paper) |
| `scheduler_enabled_real` | `1` | Tasques periòdiques (real) |
| `crash_monitor_enabled` | `1` | Monitor de crashes (paper) |
| `crash_monitor_enabled_real` | `1` | Monitor de crashes (real) |
| `activity_logger_enabled` | `1` | Logger d'activitat (paper) |
| `activity_logger_enabled_real` | `1` | Logger d'activitat (real) |
| `cancel_auto_sell` | `0` | Vendre automàticament en cancel·lar ordre (paper) |
| `cancel_auto_sell_real` | `0` | Vendre automàticament en cancel·lar ordre (real) |
| `sl_sell_remaining` | `0` | Vendre el romanent quan s'activa el SL (paper) |
| `sl_sell_remaining_real` | `0` | Vendre el romanent quan s'activa el SL (real) |

### Notificacions Telegram

Les claus sense sufix s'apliquen al mode paper; les `_real` al mode real.

| Clau | Default | Descripció |
|------|---------|-----------|
| `tg_on_new_order` | `1` | Notificar nova ordre col·locada (paper) |
| `tg_on_new_order_real` | `1` | Notificar nova ordre col·locada (real) |
| `tg_on_order_close` | `1` | Notificar ordre executada/tancada (paper) |
| `tg_on_order_close_real` | `1` | Notificar ordre executada/tancada (real) |
| `tg_on_sl_modify` | `1` | Notificar modificació de Stop Loss (paper) |
| `tg_on_sl_modify_real` | `1` | Notificar modificació de Stop Loss (real) |
| `tg_on_trailing_activate` | `1` | Notificar activació de trailing stop (paper) |
| `tg_on_trailing_activate_real` | `1` | Notificar activació de trailing stop (real) |
| `tg_on_market_scan` | `0` | Notificar cada escaneig de mercat del bot (paper) |
| `tg_on_market_scan_real` | `0` | Notificar cada escaneig de mercat del bot (real) |
| `tg_on_motor_anomaly` | `1` | Alerta si un motor deixa de funcionar (global) |

> Els informes horaris i diaris s'envien sempre si el scheduler està actiu — no tenen setting de toggle propi.

### Quote asset i parells

| Clau | Default | Descripció |
|------|---------|-----------|
| `quote_asset` | `USDC` | Moneda quote dels parells (`USDC`, `USDT`, `BUSD`, `FDUSD`) |
| `priority_pairs` | `BTCUSDC,ETHUSDC,BNBUSDC,SOLUSDC,XRPUSDC` | Parells actius (paper) — ha de coincidir amb `quote_asset` |
| `priority_pairs_real` | `BTCUSDC,ETHUSDC,BNBUSDC,SOLUSDC,XRPUSDC` | Parells actius (real) |

> **Binance Europa:** Tots els parells han d'usar USDC. El setting `quote_asset` controla quin quote usa l'auto-trader. Valors vàlids: `USDC`, `USDT`, `BUSD`, `FDUSD`, `TUSD`.

### Entrada al mercat

| Clau | Default | Descripció |
|------|---------|-----------|
| `entry_type` | `LIMIT` | Tipus d'ordre d'entrada: `LIMIT` o `MARKET` (paper) |
| `entry_type_real` | `LIMIT` | Tipus d'ordre d'entrada (real) |
| `entry_limit_offset_pct` | `0.1` | % per sota del preu per a ordre limit d'entrada |

### Paràmetres OCO (Take Profit / Stop Loss)

| Clau | Default | Descripció |
|------|---------|-----------|
| `oco_tp_atr` | `2.0` | Take Profit = preu entrada + N×ATR |
| `oco_sl_atr` | `1.0` | Stop Loss = preu entrada − N×ATR |
| `oco_sl_limit_offset_pct` | `0.2` | SL limit = SL stop − X% (evita fills parcials) |

### Trailing stop

| Clau | Default | Descripció |
|------|---------|-----------|
| `trailing_activate_atr` | `1.5` | S'activa quan preu ≥ entrada + N×ATR |
| `trailing_distance_atr` | `1.0` | Distància del trailing = N×ATR (mode ATR) |
| `trailing_sl_mode` | `ATR` | Mode del SL: `ATR` o `PIVOT_LOW` (paper) |
| `trailing_sl_mode_real` | `ATR` | Mode del SL (real) |
| `trailing_pivot_tf` | `1h` | Timeframe per detectar pivot lows (mode PIVOT_LOW) |
| `trailing_pivot_tf_real` | `1h` | Timeframe per detectar pivot lows (real) |
| `trailing_pivot_offset_pct` | `0.1` | % buffer per sota del pivot low (evita stops al preu exacte) |
| `trailing_pivot_offset_pct_real` | `0.1` | % buffer (real) |

### Gestió de capital

| Clau | Default | Descripció |
|------|---------|-----------|
| `capital_mode` | `FIXED` | Mode: `FIXED` (import fix) o `PCT_PORTFOLIO` (% del portfolio) |
| `capital_mode_real` | `FIXED` | Mode (real) |
| `capital_fixed_usdt` | `100` | Import per trade en USDC (mode FIXED) (paper) |
| `capital_fixed_usdt_real` | `100` | Import per trade en USDC (mode FIXED) (real) |
| `capital_pct_portfolio` | `5` | % del portfolio per trade (mode PCT_PORTFOLIO) (paper) |
| `capital_pct_portfolio_real` | `5` | % del portfolio per trade (real) |
| `capital_max_open` | `3` | Màxim de posicions obertes simultànies (paper) |
| `capital_max_open_real` | `3` | Màxim de posicions obertes simultànies (real) |

### Motor watchdog

| Clau | Default | Descripció |
|------|---------|-----------|
| `tg_on_motor_anomaly` | `1` | Envia alerta Telegram si un motor no respon |
| `motor_anomaly_multiplier` | `3` | Envia alerta si el motor porta N×interval sense executar-se |

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

---

## Vegeu també

[[01_architecture]] · [[08_integrations]] · [[07_deployment]]
