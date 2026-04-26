# 02 — Referència de l'API REST

Tots els endpoints viuen a `app/api/` i segueixen la convenció de Next.js App Router (fitxers `route.ts`). Totes les rutes requereixen sessió autenticada excepte `/api/auth/login`, `/api/auth/logout` i `/api/trading-mode`.

La columna **Proxy** indica si l'endpoint és accessible des del port 3001 (app mòbil).

---

## Autenticació

| Mètode | Ruta | Descripció | Proxy |
|--------|------|-----------|-------|
| `POST` | `/api/auth/login` | Login amb `{ username, password }`. Retorna cookie de sessió | ✅ |
| `POST` | `/api/auth/logout` | Destrueix la sessió | ✅ |

---

## Ordres

| Mètode | Ruta | Descripció | Proxy |
|--------|------|-----------|-------|
| `GET` | `/api/orders` | Ordres obertes. Query: `?mode=paper\|real` | ✅ |
| `POST` | `/api/orders/new` | Crea ordre LIMIT o OCO. Body: `{ symbol, side, type, price, qty, stopPrice, stopLimitPrice, mode }` | ❌ |
| `DELETE` | `/api/orders/cancel` | Cancel·la una ordre. Body: `{ symbol, orderId, mode }` | ❌ |
| `DELETE` | `/api/orders/cancel-all` | Cancel·la totes les ordres obertes. Body: `{ mode }` | ❌ |
| `PUT` | `/api/orders/modify` | Modifica preu d'una ordre. Body: `{ symbol, orderId, newPrice, mode }` | ❌ |
| `GET` | `/api/orders/history` | Historial d'ordres. Query: `?symbols=BTC,ETH&mode=paper\|real` | ❌ |
| `POST` | `/api/orders/buy-and-exit` | Market buy + OCO de sortida automàtica. Body: `{ symbol, quoteQty, tpPct, slPct, mode }` | ❌ |
| `POST` | `/api/orders/replace-oco` | Reemplaça una OCO existent. Body: `{ symbol, cancelOrderId, price, stopPrice, stopLimitPrice, qty, mode }` | ❌ |
| `POST` | `/api/orders/market-buy` | Market buy directe. Body: `{ symbol, quoteQty, mode }` | ❌ |
| `POST` | `/api/orders/sell-to-usdt` | Ven tota la posició d'un asset. Body: `{ asset, mode }` | ❌ |
| `GET` | `/api/orders/trailing` | Trailing stops pendents i actius. Query: `?mode=paper\|real` | ✅ |
| `POST` | `/api/orders/trailing` | Crea o actualitza trailing stop. Body: `{ symbol, orderId, activateAt, trailDist, mode }` | ❌ |
| `POST` | `/api/orders/trailing/activate` | Activa trailing manualment. Body: `{ symbol, orderId, mode }` | ❌ |
| `GET` | `/api/orders/meta` | Metadata d'ordres (interval, trade_code, notes). Query: `?mode=paper\|real` | ❌ |

---

## Mercat i preus

| Mètode | Ruta | Descripció | Proxy |
|--------|------|-----------|-------|
| `GET` | `/api/balance` | Saldo del compte. Query: `?mode=paper\|real` | ✅ |
| `GET` | `/api/klines` | Veles OHLCV amb cache 5min. Query: `?symbol=BTCUSDC&interval=1h&limit=100` | ❌ |
| `GET` | `/api/klines-range` | Veles per rang de dates. Query: `?symbol=BTCUSDC&interval=1d&start=timestamp&end=timestamp` | ✅ |
| `GET` | `/api/analysis` | Anàlisi tècnica completa. Query: `?symbol=BTCUSDC&interval=1h` | ❌ |
| `GET` | `/api/market` | Top guanyadors/perdedors + preu BTC | ✅ |
| `GET` | `/api/market-price` | Preu actual d'un símbol. Query: `?symbol=BTCUSDC` | ❌ |
| `GET` | `/api/trades` | Trades executats recents. Query: `?symbol=BTCUSDC&mode=paper|real` | ❌ |
| `GET` | `/api/exchange-info` | Tick size, lot size, filtres d'un parell. Query: `?symbol=BTCUSDC` | ❌ |
| `GET` | `/api/exchange-info/symbols` | Llista de tots els símbols disponibles | ❌ |
| `POST` | `/api/convert` | Conversió entre monedes. Body: `{ from, to, amount }` | ❌ |

---

## P&L i portfolio

| Mètode | Ruta | Descripció | Proxy |
|--------|------|-----------|-------|
| `GET` | `/api/pnl` | P&L realitzat per períodes (24h, 7d, 1m, 1y). Query: `?mode=paper\|real` | ✅ |
| `GET` | `/api/cost-basis` | Cost mig d'entrada per asset. Query: `?mode=paper\|real` | ✅ |
| `GET` | `/api/portfolio-snapshot` | Historial de snapshots del valor total | ✅ |
| `POST` | `/api/portfolio-snapshot` | Desa snapshot actual (cridat pel scheduler cada 15min) | ❌ |

---

## Bots i simulació

| Mètode | Ruta | Descripció | Proxy |
|--------|------|-----------|-------|
| `GET` | `/api/bots` | Llista de tots els bots | ❌ |
| `POST` | `/api/bots` | Crea un bot. Body: `{ name, simId, mode, ... }` | ❌ |
| `PATCH` | `/api/bots` | Actualitza un bot. Body: `{ id, ...patch }` | ❌ |
| `PATCH` | `/api/bots` | **Bulk:** activa/desactiva tots els bots d'un mode. Body: `{ bulk: true, mode: "paper"\|"real", enabled: boolean }` | ❌ |
| `DELETE` | `/api/bots` | Elimina un bot. Query: `?id=<id>` | ❌ |
| `GET` | `/api/simulation/configs` | Configuracions de simulació desades | ❌ |
| `POST` | `/api/simulation/run` | Executa backtest. Body: `{ config }` | ❌ |
| `GET` | `/api/simulation/export` | Exporta resultats de simulació (CSV/JSON) | ❌ |

---

## Journal i activitat

| Mètode | Ruta | Descripció | Proxy |
|--------|------|-----------|-------|
| `GET` | `/api/journal` | Entrades del trade journal. Query: `?mode=paper\|real&limit=50` | ❌ |
| `GET` | `/api/journal/related` | Trades relacionats per símbol. Query: `?symbol=BTCUSDC&mode=paper|real` | ❌ |
| `GET` | `/api/activity` | Log d'activitat (events de bots i ordres) | ✅ |

---

## Sistema i configuració

| Mètode | Ruta | Descripció | Proxy |
|--------|------|-----------|-------|
| `GET` | `/api/status` | Estat dels motors (trailing, monitor, bots) | ✅ |
| `GET` | `/api/trading-mode` | Retorna `{ realConfigured: boolean }` | ❌ |
| `GET` | `/api/settings` | Tots els settings de l'aplicació | ❌ |
| `POST` | `/api/settings` | Actualitza un setting. Body: `{ key, value }` | ❌ |
| `GET` | `/api/settings/status` | Estat dels toggles de bots i motors | ❌ |
| `POST` | `/api/settings/telegram-test` | Envia missatge de prova a Telegram | ❌ |
| `GET` | `/api/errors` | Errors de les últimes 24h | ✅ |
| `GET` | `/api/logs` | Stream de logs (SSE) | ❌ |
| `POST` | `/api/logs/export` | Exporta logs a fitxer | ❌ |
| `GET` | `/api/stream` | Server-Sent Events (fills, status, logs) | ❌ |
| `DELETE` | `/api/cache/invalidate` | Invalida cache per prefix. Query: `?prefix=klines` | ❌ |
| `GET` | `/api/debug/audit` | Informe d'auditoria del sistema | ❌ |

---

## Telegram

| Mètode | Ruta | Descripció | Proxy |
|--------|------|-----------|-------|
| `POST` | `/api/telegram/report` | Envia informe de portfolio ara | ❌ |
| `POST` | `/api/telegram/orders` | Envia llista d'ordres a Telegram | ❌ |
| `POST` | `/api/telegram/test-all` | Prova totes les funcions de Telegram | ❌ |

---

## Deploy i debug

| Mètode | Ruta | Descripció | Proxy |
|--------|------|-----------|-------|
| `POST` | `/api/deploy` | Inicia desplegament a producció | ❌ |
| `GET` | `/api/deploy/stream` | Progrés del desplegament (SSE) | ❌ |

---

## Format de resposta

Totes les respostes retornen JSON. En cas d'error:

```json
{
  "error": "Descripció de l'error"
}
```

Els errors HTTP usats: `400` (paràmetres incorrectes), `401` (no autenticat), `403` (prohibit), `500` (error de servidor).

---

## Vegeu també

[[01_architecture]] · [[03_database-schema]] · [[05_configuration]]
