# 09 — Guia de Desenvolupament

Guia per a developers i agents IA que treballen en el projecte. Explica les convencions, on viu cada cosa i com afegir funcionalitats noves.

---

## Primers fitxers a llegir

Quan arribes a un projecte sense context, llegeix en aquest ordre:

1. `CLAUDE.md` — Instruccions específiques per a Claude Code
2. `docs/01_architecture.md` — Visió general del sistema
3. `app/lib/binance-auth.ts` — Com es fan les crides a Binance
4. `app/lib/cache-store.ts` — Com funciona la base de dades
5. `app/lib/auto-trader.ts` — Lògica central del trading automàtic

---

## Convenció de fitxers

| Tipus | On viu | Exemple |
|-------|--------|---------|
| Endpoints API | `app/api/<nom>/route.ts` | `app/api/orders/new/route.ts` |
| Lògica de servidor | `app/lib/<nom>.ts` | `app/lib/trailing-engine.ts` |
| Components React | `app/components/<Nom>.tsx` | `app/components/PortfolioTab.tsx` |
| Contextos React | `app/contexts/<Nom>Context.tsx` | `app/contexts/TradingModeContext.tsx` |
| Pàgines app mòbil | `public/www/<nom>.html` | `public/www/orders.html` |
| Scripts de manteniment | `scripts/<nom>.mjs` | `scripts/test-orders.mjs` |
| Documentació | `docs/<NN>_<nom>.md` | `docs/04_trading-engine.md` |

---

## Com afegir un nou endpoint API

1. **Crea el fitxer** `app/api/<ruta>/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { logger } from "@/lib/logger";

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // lògica aquí
    const data = { example: true };
    return NextResponse.json(data);
  } catch (err) {
    logger.error({ err }, "Error a /api/exemple");
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
```

2. **Si l'endpoint necessita Binance**, usa `binance-auth.ts`:

```typescript
import { getOpenOrders } from "@/lib/binance-auth";
import type { TradingMode } from "@/lib/types";

const mode = (req.nextUrl.searchParams.get("mode") ?? "paper") as TradingMode;
const orders = await getOpenOrders(mode);
```

3. **Si necessita SQLite**, usa `cache-store.ts` o `db.ts`:

```typescript
import { getDb } from "@/lib/db";

const db = getDb("cache");  // o "paper" / "real"
const rows = db.prepare("SELECT * FROM settings WHERE key = ?").all("my_key");
```

4. **Si ha de ser accessible des del mòbil**, afegeix-lo a `ALLOWED_API` a `server-public.mjs`.

5. **Documenta'l** a `docs/02_api-reference.md`.

---

## Com afegir un nou component al dashboard

1. Crea `app/components/NouComponent.tsx`
2. Afegeix `"use client"` si usa hooks o events de navegador
3. Importa'l des de `OrdersPanel.tsx` (si és una nova pestanya) o des del component pare corresponent
4. Per a dades en temps real, usa el hook `useServerEvents()` de `ServerEventsProvider.tsx`

### Patró per a una nova pestanya

```typescript
"use client";
import { useState, useEffect } from "react";

export default function NovaPestanya() {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch("/api/nou-endpoint")
      .then(r => r.json())
      .then(setData);
  }, []);

  return <div>{/* contingut */}</div>;
}
```

Afegeix la pestanya a `Nav.tsx` (llista de tabs) i a `OrdersPanel.tsx` (renderitzat condicional).

---

## Com crear un nou bot / configuració de simulació

1. A la pestanya **Simulació** del dashboard, dissenya els paràmetres i executa el backtest
2. Desa la configuració com a preset (botó "Desar")
3. Ves a **Configuració → Bots → Nou bot**
4. Selecciona la configuració desada com a `sim_id`
5. Configura: mode (paper/real), budget, finestra horària, etc.
6. Activa el bot

El bot comença a operar a la propera vela tancada.

---

## Patrons importants

### Accés a la BD per mode

```typescript
import { getDb } from "@/lib/db";
import type { TradingMode } from "@/lib/types";

function getJournal(mode: TradingMode) {
  const db = getDb(mode);  // paper.db o real.db automàticament
  return db.prepare("SELECT * FROM trade_journal ORDER BY exit_at DESC").all();
}
```

### Crides a Binance amb mode

```typescript
import { binanceGet, binancePost } from "@/lib/binance-auth";

// Sempre passa el mode explícitament
const balance = await binanceGet("/account", {}, mode);
const order = await binancePost("/order", { symbol, side, ... }, mode);
```

### Logging

```typescript
import { logger } from "@/lib/logger";

logger.info({ symbol, qty }, "Compra executada");
logger.warn({ orderId }, "Ordre no trobada");
logger.error({ err, context }, "Error crític");
```

Els logs van a `logs/app-YYYY-MM-DD.log` (JSON) i a la consola en dev.

### Registrar errors a la DB

```typescript
import { errorStore } from "@/lib/error-store";

errorStore.add({
  message: "Error al trailing",
  context: { symbol, orderId },
  severity: "error",
  stack: err.stack,
});
```

### Enviar notificació Telegram

```typescript
import { telegram } from "@/lib/telegram";

await telegram.sendMessage("Missatge de prova", mode);
await telegram.sendOrderFill({ symbol, price, qty, pnl }, mode);
```

---

## Zones de risc — atenció especial

### Mode real (Mainnet)
Qualsevol operació en mode real envia ordres amb **diners reals**. Sempre:
- Verifica el mode abans de cridar funcions de Binance
- Usa `real-guard.ts` per a confirmacions explícites
- Comprova `realConfigured` via `GET /api/trading-mode` abans d'activar

```typescript
import { requireRealConfirmation } from "@/lib/real-guard";

// Llança error si l'usuari no ha confirmat explícitament
await requireRealConfirmation(mode, "Estàs a punt d'enviar una ordre real");
```

### Motors singletons
Els motors (TrailingEngine, OrderMonitor) s'inicien amb `globalThis`. **No instanciar-ne de nous** des d'endpoints o components. Usa les funcions de gestió existents:

```typescript
import { getTrailingEngine } from "@/lib/trailing-engine";
const engine = getTrailingEngine();  // retorna sempre la mateixa instància
```

### SQLite concurrent
SQLite en WAL mode permet múltiples lectors simultanis però un sol escriptor. Per a operacions crítiques usa transaccions:

```typescript
const db = getDb("cache");
const insertMany = db.transaction((items) => {
  for (const item of items) {
    db.prepare("INSERT INTO ...").run(item);
  }
});
insertMany(myItems);
```

---

## Tests i verificació

```bash
# Comprova consistència d'ordres (Binance vs DB local)
node scripts/test-orders.mjs

# Prova l'anàlisi tècnica per un símbol
node scripts/test-doge.mjs

# Neteja ordres sense posició associada
node scripts/cleanup-orphans.mjs

# Lint TypeScript
npm run lint

# Build complet (detecta errors de tipus)
npm run build
```

---

## Estructura de tipus TypeScript

Els tipus globals estan a `app/lib/types.ts`:

```typescript
export type TradingMode = "paper" | "real";
export type OrderSide = "BUY" | "SELL";
export type OrderType = "LIMIT" | "MARKET" | "STOP_LOSS_LIMIT" | "OCO";
export type ExitType = "TP" | "SL" | "MANUAL" | "TRAILING";
export type Strategy = "Swing" | "Scalp" | "DCA" | "Breakout" | "Hedge";
export type Interval = "5m" | "15m" | "1h" | "4h" | "1d";
```

---

## Notes per a agents IA

- **Llegir abans de modificar:** sempre `Read` un fitxer complet abans d'editar-lo
- **No inventar endpoints:** consulta `docs/02_api-reference.md` per a la llista exacta
- **Mode paper és el default segur:** mai canviar el default de `mode` a `real`
- **Les migracions de BD son automàtiques:** afegeix camps amb `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
- **Un sol túnel Cloudflare:** per al port 3001, mai pel 3000
- **`CLAUDE.md` té prioritat:** si hi ha instruccions específiques allà, segueix-les per sobre d'aquesta guia
