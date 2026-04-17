# 08 — Integracions externes

---

## Binance API

### Endpoints usats

| Endpoint Binance | Propòsit |
|-----------------|---------|
| `GET /api/v3/account` | Balanç del compte (assets i quantitats) |
| `GET /api/v3/openOrders` | Llista d'ordres obertes |
| `GET /api/v3/allOrders` | Historial complet d'ordres |
| `GET /api/v3/myTrades` | Trades executats |
| `GET /api/v3/klines` | Veles OHLCV (1m, 5m, 15m, 1h, 4h, 1d...) |
| `GET /api/v3/ticker/price` | Preu actual d'un símbol |
| `GET /api/v3/ticker/24hr` | Estadístiques 24h (top guanyadors/perdedors) |
| `GET /api/v3/exchangeInfo` | Regles de trading per símbol (tick size, lot size) |
| `POST /api/v3/order` | Crear ordre (LIMIT, MARKET, STOP_LOSS_LIMIT) |
| `POST /api/v3/order/oco` | Crear ordre OCO |
| `DELETE /api/v3/order` | Cancel·lar ordre |
| `GET /api/v3/order` | Consultar estat d'una ordre concreta |

### URLs base

| Mode | URL |
|------|-----|
| Paper (Testnet) | `https://demo-api.binance.com/api/v3` |
| Real (Mainnet) | `https://api.binance.com/api/v3` |

### Autenticació

Totes les peticions signades usem **HMAC-SHA256**:

```typescript
// Pseudocodi de binance-auth.ts
const params = new URLSearchParams({ ...queryParams, timestamp });
const signature = createHmac("sha256", secretKey)
  .update(params.toString())
  .digest("hex");
params.append("signature", signature);

fetch(`${BASE_URL}${endpoint}?${params}`, {
  headers: { "X-MBX-APIKEY": apiKey }
});
```

El fitxer `app/lib/binance-auth.ts` suporta tres tipus de firma: **HMAC-SHA256** (per defecte), **ED25519** i **RSA** (per claus d'alta seguretat).

### Rate limiting

Binance imposa límits de peticions per minut (pesos). L'aplicació gestiona els errors `429 Too Many Requests` i `418 IP Ban` amb **backoff exponencial**:

1. Primer error → espera 1s i reintenta
2. Segon error consecutiu → espera 5s
3. Tercer+ error → espera creixent fins a màxim 30 minuts
4. Error 418 (IP ban) → pausa forçada de 60 minuts + alerta Telegram

### Funció factory per mode

```typescript
import { binanceClient } from "@/lib/binance-auth";
import type { TradingMode } from "@/lib/types";

// Totes les funcions accepten mode
async function getOpenOrders(mode: TradingMode = "paper") {
  const client = binanceClient(mode);
  return client.get("/openOrders");
}
```

---

## Telegram Bot API

### Configuració

1. Crea el bot via [@BotFather](https://t.me/BotFather) → `/newbot`
2. Obté el **TOKEN** del bot
3. Escriu `/start` al bot i obté el **CHAT_ID** via:
   ```
   https://api.telegram.org/bot<TOKEN>/getUpdates
   ```
4. Afegeix a `.env.local`:
   ```env
   TELEGRAM_BOT_TOKEN=<token>
   TELEGRAM_CHAT_ID=<chat_id>
   ```

### Tipus de notificació

**Fill d'ordre (TP / SL / compra / venda):**
```
🟢 Take Profit executat ✓
📊 BTCUSDC
📌 Preu exec.: $95,420
📦 Quantitat:  0.0105 BTC
💵 Valor:      $1,001.91
📈 P&L: +$45.20 (+4.72%)
⏰ 17 abr 2026 · 14:32
```

**Activació de trailing stop:**
```
🔔 Trailing Stop activat
📊 SOLUSDC
📌 Activat a: $145.20
🎯 SL inicial: $142.30 (−2%)
⏰ 17 abr 2026 · 15:01
```

**Informe horari:**
```
📊 Informe horari — 14:00
💼 Valor total: $15,420
📈 +$342 vs fa 1h (+2.3%)
📋 Ordres obertes: 5
```

**Informe diari (07:30):**
```
📈 Resum diari — 17 abr 2026
Inici del dia: $14,800
Ara:           $15,420
Variació: +$620 (+4.2%)
Trades: 3 | TP: 2 | SL: 1
Win rate: 66.7%
```

**Error crític:**
```
🚨 Error al sistema
Motor: TrailingEngine
Error: Cannot read property 'price' of undefined
Context: { symbol: "SOLUSDC", orderId: "12345" }
⏰ 17 abr 2026 · 16:45
```

### Fitxer d'integració

`app/lib/telegram.ts` exporta:

| Funció | Descripció |
|--------|-----------|
| `sendMessage(text, mode?)` | Envia missatge de text simple |
| `sendOrderFill(fill, mode?)` | Notificació de fill d'ordre formategada |
| `sendTrailingActivated(data, mode?)` | Notificació d'activació de trailing |
| `sendPortfolioReport(data, mode?)` | Informe de portfolio complet |
| `sendDailyReport(data, mode?)` | Informe diari |
| `sendError(error, context?)` | Alerta d'error crític |

El paràmetre `mode` selecciona el bot de Telegram (paper o real) si estan configurats separadament.

### Prova de connexió

```bash
# Via endpoint
curl -X POST http://localhost:3000/api/settings/telegram-test

# Via script
node scripts/notify-tunnel.mjs
```

---

## Cloudflare Tunnel

### Per què Cloudflare Tunnel?

- Cap configuració de router ni port forwarding
- HTTPS automàtic (certificat gestionat per Cloudflare)
- URL pública sense IP fixa
- Gratuït (pla free de Cloudflare)

### Funcionament

```
Internet → Cloudflare Edge → Túnel xifrat → cloudflared (local) → port 3001
```

El procés `cloudflared` corre localment i estableix una connexió outbound cap a Cloudflare. No cal obrir cap port al firewall.

### Ús

```bash
# Arrenca el túnel per al port 3001 (app mòbil)
cloudflared tunnel --url http://localhost:3001 > /tmp/cf-tunnel.log 2>&1 &

# Espera i obté la URL
sleep 5 && grep -o 'https://[a-zA-Z0-9._-]*\.trycloudflare\.com' /tmp/cf-tunnel.log
```

Cada sessió genera una **URL aleatòria nova** (ex: `https://orange-cloud-xyz.trycloudflare.com`). Per URLs permanents cal un compte Cloudflare i un túnel nomenat.

### Notificar la URL nova

```bash
node scripts/notify-tunnel.mjs
```

Envia la URL nova via Telegram perquè l'usuari pugui accedir des del mòbil.

### Perquè només el port 3001?

Un sol túnel és suficient perquè:
- El port 3000 (dashboard) **mai s'exposa** externament per seguretat
- El port 3001 serveix tant l'app mòbil com fa de proxy per a l'API

```
┌──────────────────────────────────────────────┐
│  ✅ UN sol túnel → port 3001                 │
│     app mòbil (HTML/JS) + API de consulta    │
│                                              │
│  ❌ Port 3000 — mai exposat                  │
│     dashboard complet + API d'escriptura     │
└──────────────────────────────────────────────┘
```

### Instal·lació de cloudflared

```bash
# Windows (winget)
winget install Cloudflare.cloudflared

# Linux (Ubuntu/Debian)
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb
```
