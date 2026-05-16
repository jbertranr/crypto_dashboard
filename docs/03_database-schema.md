# 03 — Esquema de la base de dades

CryptDesk usa **SQLite** amb `better-sqlite3`. Hi ha tres fitxers de base de dades, tots en mode **WAL** (Write-Ahead Logging) per permetre accés concurrent segur. Es creen automàticament en el primer arrencament.

```
data/
├── cache.db    ← Infraestructura compartida (cache, settings, errors...)
├── paper.db    ← Trades i bots del mode paper (Testnet)
└── real.db     ← Trades i bots del mode real (Mainnet)
```

---

## `data/cache.db` — Infraestructura compartida

### `api_cache`
Cache de respostes de l'API de Binance.

| Camp | Tipus | Descripció |
|------|-------|-----------|
| `key` | TEXT PK | Clau de cache (ex: `klines:BTCUSDC:1h`) |
| `value` | TEXT | Resposta JSON serialitzada |
| `expires_at` | INTEGER | Timestamp d'expiració (Unix ms) |
| `created_at` | INTEGER | Timestamp de creació |

TTL per defecte: 5 minuts per klines i anàlisi tècnica.

---

### `snapshots`
Historial del valor total del portfolio (un punt cada 15 minuts).

| Camp | Tipus | Descripció |
|------|-------|-----------|
| `id` | INTEGER PK | Auto-increment |
| `total_usdt` | REAL | Valor total en USDC (nom de columna històric) |
| `assets` | TEXT | JSON amb detall per asset |
| `created_at` | INTEGER | Timestamp Unix ms |

Usat per: `PortfolioChart.tsx`, endpoint `GET /api/portfolio-snapshot`.

---

### `strategies`
Estratègia de trading assignada a cada ordre oberta.

| Camp | Tipus | Descripció |
|------|-------|-----------|
| `order_key` | TEXT PK | Identificador `oco:ID` o `ord:ID` |
| `strategy` | TEXT | Valor: `Swing`, `Scalp`, `DCA`, `Breakout`, `Hedge` |
| `updated_at` | INTEGER | Timestamp de l'última actualització |

---

### `trailing_active`
Trailing stops actius que el `TrailingEngine` gestiona.

| Camp | Tipus | Descripció |
|------|-------|-----------|
| `id` | INTEGER PK | Auto-increment |
| `symbol` | TEXT | Parell (ex: `BTCUSDC`) |
| `side` | TEXT | `BUY` o `SELL` |
| `sl_order_id` | TEXT | ID de l'ordre SL activa a Binance |
| `trail_dist_pct` | REAL | Distància del trailing en % |
| `highest_price` | REAL | Màxim preu vist (per SELL) |
| `qty` | REAL | Quantitat de la posició |
| `mode` | TEXT | `paper` o `real` |
| `created_at` | INTEGER | Timestamp |

---

### `order_trailing`
Trailing stops pendents d'activació (esperen que el preu superi `activate_at`).

| Camp | Tipus | Descripció |
|------|-------|-----------|
| `id` | INTEGER PK | Auto-increment |
| `symbol` | TEXT | Parell |
| `order_id` | TEXT | ID de l'OCO o ordre associada |
| `activate_at` | REAL | Preu d'activació del trailing |
| `trail_dist_pct` | REAL | Distància del trailing en % |
| `qty` | REAL | Quantitat |
| `mode` | TEXT | `paper` o `real` |
| `created_at` | INTEGER | Timestamp |

---

### `order_meta`
Metadata addicional per a cada ordre (no disponible a Binance).

| Camp | Tipus | Descripció |
|------|-------|-----------|
| `order_key` | TEXT PK | Identificador de l'ordre |
| `interval` | TEXT | Interval de la senyal (ex: `1h`) |
| `trade_code` | TEXT | Codi únic del trade (ex: `SOL-2024-001`) |
| `notes` | TEXT | Notes lliures de l'usuari |
| `exit_notes` | TEXT | Notes en tancar la posició |
| `updated_at` | INTEGER | Timestamp |

---

### `settings`
Configuració de l'aplicació en format clau-valor.

| Camp | Tipus | Descripció |
|------|-------|-----------|
| `key` | TEXT PK | Nom del setting |
| `value` | TEXT | Valor (sempre com a string) |
| `updated_at` | INTEGER | Timestamp de l'última modificació |

Veure llista completa de settings a [05_configuration.md](05_configuration.md).

---

### `app_errors`
Registre d'errors de l'aplicació.

| Camp | Tipus | Descripció |
|------|-------|-----------|
| `id` | INTEGER PK | Auto-increment |
| `message` | TEXT | Missatge d'error |
| `context` | TEXT | Context JSON (endpoint, paràmetres) |
| `severity` | TEXT | `error`, `warn`, `info` |
| `stack` | TEXT | Stack trace (si disponible) |
| `created_at` | INTEGER | Timestamp |

Retinguts: últimes 24 hores. Endpoint: `GET /api/errors`.

---

### `trade_counter`
Comptador global de trades per generar codis únics.

| Camp | Tipus | Descripció |
|------|-------|-----------|
| `id` | INTEGER PK | Sempre `1` |
| `count` | INTEGER | Nombre total de trades creats |

---

## `data/paper.db` — Mode Paper (Testnet)

### `trade_journal`
Registre complet de tots els trades en mode paper.

| Camp | Tipus | Descripció |
|------|-------|-----------|
| `id` | INTEGER PK | Auto-increment |
| `trade_code` | TEXT | Codi únic del trade |
| `symbol` | TEXT | Parell (ex: `BTCUSDC`) |
| `side` | TEXT | `BUY` o `SELL` |
| `entry_price` | REAL | Preu d'entrada |
| `exit_price` | REAL | Preu de sortida |
| `qty` | REAL | Quantitat |
| `pnl_usdt` | REAL | P&L realitzat en USDC (nom de columna històric) |
| `pnl_pct` | REAL | P&L en percentatge |
| `strategy` | TEXT | Estratègia usada |
| `interval` | TEXT | Interval de la senyal |
| `exit_type` | TEXT | `TP`, `SL`, `MANUAL`, `TRAILING` |
| `bot_id` | INTEGER | ID del bot (NULL si manual) |
| `notes` | TEXT | Notes del trade |
| `mode` | TEXT | Sempre `paper` en aquest fitxer |
| `entry_at` | INTEGER | Timestamp d'entrada |
| `exit_at` | INTEGER | Timestamp de sortida |

---

### `bots`
Configuració dels bots en mode paper.

| Camp | Tipus | Descripció |
|------|-------|-----------|
| `id` | INTEGER PK | Auto-increment |
| `name` | TEXT | Nom del bot |
| `sim_id` | TEXT | Referència a configuració de simulació |
| `enabled` | INTEGER | `0` o `1` |
| `budget_usdc` | REAL | Capital màxim simultani del bot en USDC |
| `max_daily` | INTEGER | Màxim de trades per dia |
| `hours_from` | INTEGER | Hora d'inici de la finestra (0-23) |
| `hours_to` | INTEGER | Hora de fi de la finestra (0-23) |
| `require_multi_tf` | INTEGER | Requereix confirmació multi-timeframe |
| `min_probability` | REAL | Probabilitat mínima d'entrada (0-100) |
| `max_open` | INTEGER | Màxim d'ordres obertes simultànies |
| `mode` | TEXT | Sempre `paper` en aquest fitxer |
| `created_at` | INTEGER | Timestamp |
| `updated_at` | INTEGER | Timestamp |

---

## `data/real.db` — Mode Real (Mainnet)

Estructura idèntica a `paper.db`. Les mateixes taules `trade_journal` i `bots`, però amb `mode = "real"` i connectades al Mainnet de Binance.

---

## Migracions

Les migracions s'apliquen **automàticament** en arrencar el backend. El fitxer `app/lib/db.ts` conté la funció factory que:
1. Obre (o crea) el fitxer `.db` corresponent
2. Activa WAL mode
3. Aplica `CREATE TABLE IF NOT EXISTS` per a totes les taules
4. Afegeix columnes noves via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`

No cal cap eina de migració externa.

---

## Accés a les bases de dades

```typescript
import { getDb } from "@/lib/db";

// Base de dades per mode
const db = getDb("paper");   // → data/paper.db
const db = getDb("real");    // → data/real.db
const db = getDb("cache");   // → data/cache.db (default)
```

Tots els accesos usen statements preparats (`db.prepare(...)`) per prevenir SQL injection.

---

## Vegeu també

[[01_architecture]] · [[05_configuration]] · [[04_trading-engine]]
