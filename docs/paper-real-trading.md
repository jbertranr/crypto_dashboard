# Paper Trading + Real Trading en paral·lel

## Visió general

L'aplicació suporta dos modes d'operació independents:

| Mode | Mercat | Credencials | Ús |
|------|--------|-------------|-----|
| **PAPER** | Binance Testnet (`demo-api.binance.com`) | `BINANCE_API_KEY` + `BINANCE_SECRET_KEY` | Prova estratègies sense risc |
| **REAL** | Binance Mainnet (`api.binance.com`) | `BINANCE_API_KEY_REAL` + `BINANCE_SECRET_KEY_REAL` | Trading real amb diners reals |

Cada bot i cada ordre manual pot ser paper o real de forma independent. El filtre global a la navegació controla quines operacions es mostren al Journal.

---

## Configuració initial

### 1. Claus API (`.env.local`)

```env
# ── Paper trading (Testnet Binance) ──────────────────────────────
BINANCE_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
BINANCE_SECRET_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# ── Real trading (Mainnet Binance) — deixar buit per desactivar ──
BINANCE_API_KEY_REAL=
BINANCE_SECRET_KEY_REAL=
```

Per obtenir les claus de Testnet:
1. Ves a https://testnet.binance.vision/
2. Crea un compte i genera les claus API
3. Copia-les a `BINANCE_API_KEY` / `BINANCE_SECRET_KEY`

Per obtenir les claus de Mainnet (real):
1. Ves a https://www.binance.com/en/my/settings/api-management
2. Crea una clau amb permisos: **Spot & Margin Trading** + **Read Info**
3. Copia-les a `BINANCE_API_KEY_REAL` / `BINANCE_SECRET_KEY_REAL`
4. Reinicia l'aplicació (`npm run dev`)

> **IMPORTANT**: Si `BINANCE_API_KEY_REAL` és buit, el mode real queda desactivat a tota la UI.

---

## Com funciona

### Toggle global (nav)

A la part inferior de la barra lateral hi ha un toggle **PAPER | REAL**:
- **PAPER** (per defecte): mostra i opera al Testnet
- **REAL**: mostra i opera al Mainnet — requereix confirmació i que les claus estiguin configurades

L'estat es guarda a `localStorage` com `trading_view_mode`.

### Per bot

A **Configuració → Bots**, quan crees o edites un bot, pots triar el mode:
- **PAPER**: el bot envia ordres al Testnet
- **REAL**: el bot envia ordres al Mainnet

> El canvi a REAL per un bot existent requereix confirmació explícita.

### Per ordre manual

A **New Order Modal**, les ordres s'envien al mode actiu al toggle global (PAPER o REAL).

### Visualització

- El **Journal** filtra automàticament per mode actiu
- Cada entrada del Journal mostra un badge **PAPER** (blau) o **REAL** (vermell)
- El toggle del Journal mostra estadístiques separades per mode

---

## Arquitectura tècnica

### `binance-auth.ts`

Totes les funcions d'ordre accepten un paràmetre `mode: TradingMode = "paper"`:

```typescript
export type TradingMode = "paper" | "real";

// Exemples:
placeMarketBuy(symbol, qty, mode)
placeOcoOrder(params, mode)
getOpenOrders(mode)
getAccount(mode)
cancelOrder(symbol, orderId, mode)
```

Les credencials s'obtenen de les variables d'entorn corresponents:
- `paper` → `BINANCE_API_KEY` + `BINANCE_SECRET_KEY` → `demo-api.binance.com`
- `real`  → `BINANCE_API_KEY_REAL` + `BINANCE_SECRET_KEY_REAL` → `api.binance.com`

### Base de dades

**Taula `bots`** (camp nou):
```sql
mode TEXT NOT NULL DEFAULT 'paper'  -- 'paper' | 'real'
```

**Taula `trade_journal`** (camp nou):
```sql
mode TEXT NOT NULL DEFAULT 'paper'  -- 'paper' | 'real'
```

**Taula `pending_oco`** (camp nou):
```sql
mode TEXT NOT NULL DEFAULT 'paper'  -- per reintentar OCOs pendents al mode correcte
```

Les migracions s'apliquen automàticament en arrencar el backend.

### Context React

`app/contexts/TradingModeContext.tsx` exporta:
```typescript
const { viewMode, setViewMode, realConfigured } = useTradingMode();
// viewMode: "paper" | "real"
// setViewMode: inclou confirmació + validació de claus
// realConfigured: true si BINANCE_API_KEY_REAL té valor
```

`DashboardShell` és el proveïdor arrel; tots els components fills poden usar `useTradingMode()`.

### Propagació del mode

```
toggle UI → viewMode (context localStorage)
         → NewOrderModal → POST /api/orders/... { mode }
         → JournalTab    → GET  /api/journal?mode=paper|real

bot.mode → auto-trader.ts → placeMarketBuy(symbol, qty, bot.mode)
                          → placeOcoOrder(params, bot.mode)
                          → journalAdd({ ..., mode: bot.mode })
                          → pendingOcoSave({ ..., mode: bot.mode })
```

---

## Endpoint `/api/trading-mode`

```
GET /api/trading-mode
→ { realConfigured: boolean }
```

Retorna si les claus reals estan configurades (sense exposar-les). La UI el consulta en carregar per habilitar/deshabilitar el botó REAL.

---

## Seguretat

1. **Confirmació obligatòria**: canviar a mode real des de la UI mostra un `confirm()` explícit
2. **Claus separades**: les claus reals i de testnet mai es barregen
3. **Default segur**: tot el codi usa `mode = "paper"` per defecte — impossible activar real per accident
4. **Validació a la UI**: si `BINANCE_API_KEY_REAL` és buit, el botó REAL queda desactivat
5. **Cap exposició de claus**: `GET /api/trading-mode` retorna `{ realConfigured: boolean }`, no les claus

---

## Operatives pendents per al mode real

Quan el mode real estigui actiu, tingues en compte:

- **Orphan detection** (`checkOrphanPositions`): actualment comprova únicament posicions paper (Testnet). Per al mode real, cal una implementació separada que cridi `getOpenOrders("real")` i `getAccount("real")`.
- **Balanç a la UI**: el component de balanç mostra el compte paper. Afegir un toggle per veure el balanç real.
- **Scheduler d'alertes**: les comprovacions de consistència d'ordres operen al mode paper. Ampliar-les al real si cal.

---

## Flux de verificació

```
1. Configura BINANCE_API_KEY_REAL al .env.local
2. Reinicia: npm run dev
3. Comprovació: curl http://localhost:3000/api/trading-mode
   → { "realConfigured": true }
4. A la nav, el botó REAL s'activa
5. Crea un bot en mode REAL (Configuració → Bots)
6. Activa el bot
7. L'auto-trader envia ordres a api.binance.com amb les claus reals
8. Les operacions apareixen al Journal amb badge REAL
9. Canvia el toggle de la nav a REAL per veure-les
```
