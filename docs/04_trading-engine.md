# 04 — Motor de Trading

CryptDesk té tres motors de servidor que s'executen com a singletons de Node.js. S'inicien en el primer request HTTP i continuen actius mentre el servidor està engegat. Utilitzen `globalThis` per sobreviure els hot-reloads de Next.js en mode development.

---

## 1. TrailingEngine

**Fitxer:** `app/lib/trailing-engine.ts`
**Interval:** cada **30 segons**

### Propòsit
Gestiona els trailing stops automàticament sense intervenció de l'usuari. Monitoritza el preu en temps real i mou el Stop Loss progressivament per protegir els beneficis.

### Flux d'execució

```
Cada 30s:
  1. Llegeix order_trailing (pendents d'activació)
     Per cada pendent:
       → Obté preu actual de Binance
       → [Break Even] Si breakEvenAtr > 0 i preu ≥ entrada + breakEvenAtr×ATR:
           · Obté el preu TP de l'OCO existent
           · Cancel·la l'OCO original
           · Col·loca nova OCO amb TP igual + SL a break even (preu d'entrada)
           · Actualitza el registre (breakEvenAtr = 0 per no re-activar)
       → Si preu > activateAt:
           · Cancel·la l'OCO original
           · Col·loca nou ordre SL (trailing)
           · Mou registre a trailing_active
           · Envia notificació Telegram

  2. Llegeix trailing_active (actius)
     Per cada actiu:
       → Obté preu actual
       → Si preu > highest_price (per SELL):
           · Calcula nou SL = preu actual × (1 - trail_dist_pct/100)
           · Cancel·la SL anterior
           · Col·loca nou SL
           · Actualitza highest_price
       → Si l'ordre SL ja no existeix (FILLED):
           · Registra el fill al journal
           · Envia notificació Telegram
           · Elimina de trailing_active
```

### Backoff exponencial

Quan Binance retorna errors consecutius per un parell concret, el motor fa pauses creixents per no saturar l'API:

| Errors consecutius | Pausa |
|-------------------|-------|
| 1–2 | Normal (30s) |
| 3 | 1 minut |
| 5 | 5 minuts |
| 7+ | 30 minuts (màxim) |

El backoff es reseteja quan l'operació té èxit.

### Persistència

Els trailing stops es guarden a SQLite (`order_trailing` i `trailing_active`). Si el servidor es reinicia, el motor recupera l'estat i continua on ho va deixar.

---

## 2. OrderMonitor

**Fitxer:** `app/lib/order-monitor.ts`
**Interval:** cada **35 segons** (desfasat 5s del TrailingEngine per no coincidir)

### Propòsit
Detecta quan una ordre s'ha executat (FILLED) o cancel·lat, calcula el P&L i envia notificació per Telegram.

### Flux d'execució

```
Cada 35s:
  1. GET /api/orders → obté llista actual d'ordres obertes (Binance)
  2. Compara amb llista anterior (en memòria)
  3. Per cada ordre que ha desaparegut:
     → Consulta estat a Binance (queryOrder)
     → Si status = FILLED:
         · Calcula P&L vs preu d'entrada (order_meta)
         · Afegeix al trade_journal
         · Envia notificació Telegram (TP / SL / compra / venda)
     → Si status = CANCELED (altra cama d'OCO):
         · S'ignora (és comportament normal d'un OCO)
  4. Actualitza llista anterior
```

### Tipus de notificació per fill

| Tipus | Condició | Icona |
|-------|---------|-------|
| Take Profit | Ordre de limit venda executada amb guany | 🟢 ✓ |
| Stop Loss | Ordre de stop executada amb pèrdua | 🔴 ✗ |
| Market Buy | Compra de mercat executada | 🔵 |
| Manual Sell | Venda manual executada | 🟣 |

---

## 3. AutoTrader (Bots)

**Fitxer:** `app/lib/auto-trader.ts`
**Interval:** cada **60 segons** (via Scheduler)

### Propòsit
Executa ordres automàtiques basades en anàlisi tècnica quan es tanca una vela. Cada bot és independent i pot tenir el seu propi mode (paper/real).

### Configuració per bot

| Paràmetre | Descripció | Default |
|-----------|-----------|---------|
| `name` | Nom identificador | — |
| `sim_id` | Referència a configuració de simulació | — |
| `enabled` | Actiu o no | `false` |
| `budget_usdt` | Capital per trade en USDC | — |
| `max_daily` | Màxim trades per dia | `3` |
| `hours_from` | Inici de la finestra horària | `8` |
| `hours_to` | Fi de la finestra horària | `22` |
| `require_multi_tf` | Requereix confirmació multi-timeframe | `false` |
| `min_probability` | Probabilitat mínima d'entrada (0–100) | `60` |
| `max_open` | Màxim ordres obertes simultànies | `5` |
| `mode` | `paper` o `real` | `paper` |

### Detecció de tancament de vela

El poll global s'executa cada 60 s. Per cada bot actiu comprova si una vela nova ha tancat:

```
candleJustClosed(interval):
  1. Calcula l'índex de l'última vela tancada: floor(ara / periode) - 1
  2. Primera crida: guarda l'índex com a "darrer vist" → no dispara (evita scan a l'arrencada)
  3. Crida següents:
     · Si l'índex no ha avançat → cap vela nova → no dispara
     · Si l'índex ha avançat:
         - Actualitza "darrer vist" (sempre, per no re-disparar senyals vells)
         - Comprova frescor: la vela va tancar fa menys del 25% del període?
             · Per interval 4h (checkInterval 1h): finestra de 15 min
             · Per interval 1h: finestra de 15 min
           → Sí: dispara runBotScan
           → No (vela massa vella, p.ex. el servidor estava aturat): no dispara
```

> **Nota:** Per a intervals ≥ 1h el bot comprova cada hora (no cada 4h) si la vela superior ha tancat. Això dóna una finestra de 15 min per recuperar-se d'un reinici del servidor.

### Flux d'una iteració (runBotScan)

```
Quan una vela acaba de tancar:
  1. Comprova finestra horària (hours_from → hours_to UTC)
     → Fora: notifica Telegram "fora de finestra" i surt
  2. Comprova max_daily, max_open (config.maxOpen) i pressupost
     → Exhaurit: notifica Telegram el motiu i surt
     ⚠ max_open llegit en ordre de prioritat: bot.maxOpen → effectiveConfig.maxOpen → config.maxOpen
  3. Per cada símbol del bot:
     a. Comprova si ja hi ha posició oberta (OCO, trailing actiu o pendent) → salta
     b. getAnalysis(symbol, interval) → score 0–100
     c. Si require_multi_tf: comprova interval superior (confirmació)
     d. Si score ≥ min_probability i senyal = BUY:
          · placeMarketBuy(symbol, qty, bot.mode)
          · Calcula TP = tpAtr×ATR, SL = slAtr×ATR
          · placeOcoOrder({ TP, SL }, bot.mode)
          · Si trailing configurat: trailingSet(..., breakEvenAtr)
          · journalAdd(...)
  4. Telegram (si tg_on_market_scan = 1): envia resultat per cada símbol
     · BUY_EXECUTED · NO_SIGNAL · MULTI_TF_FAIL · TRAILING_ACTIU
```

### Paràmetres de la simulació desada (sim config)

Els paràmetres operatius d'un bot vénen del fitxer JSON de simulació (`simulation/<sim_id>.json`), camp `config`:

| Paràmetre | Descripció | Default |
|-----------|-----------|---------|
| `tpAtr` | Multiplicador ATR per al Take Profit | `2.5` |
| `slAtr` | Multiplicador ATR per al Stop Loss | `1.0` |
| `trailActivateAtr` | Multiplicador ATR per activar el trailing | `1.5` |
| `trailDistanceAtr` | Multiplicador ATR per a la distància del trailing | `1.0` |
| `breakEvenAtr` | Multiplicador ATR per moure SL a break even | `0` (desactivat) |
| `maxOpen` | Màxim de posicions simultànies del bot | sense límit |
| `symbols` | Llista de símbols (format USDT, es converteix a USDC automàticament) | — |
| `interval` | Timeframe de les veles | — |

> **Break Even**: quan el preu arriba a `entrada + breakEvenAtr × ATR`, el SL es mou al preu d'entrada (benefici mínim garantit). S'aplica tant a ordres automàtiques del bot com a ordres manuals col·locades amb un bot preset seleccionat.

### Modes de gestió de capital

El capital per operació es calcula a partir del mode configurat a la simulació desada (`sim_id`):

| Mode | Fórmula | Paràmetres |
|------|---------|-----------|
| `FIXED` | `capitalFixed` USDC per trade | `capitalFixed` |
| `PCT` | `budgetUsdt × capitalPct%` | `capitalPct` |
| `ANTI_MARTINGALE` | `budgetUsdt × amBasePct%` × factor de pèrdua | `amBasePct` |
| `RISK_PCT` | `(budgetUsdt × riskPct%) / distànciaSL%` (cap 50%) | `riskPct` |
| `PYRAMID` | `budgetUsdt × pyramidBasePct%` × `pyramidFactor ^ wins_consecutives` (cap 50%) | `pyramidBasePct`, `pyramidFactor`, `pyramidMaxLevel` |

**ANTI_MARTINGALE** — redueix la mida quan hi ha pèrdues consecutives:
- 0–1 pèrdues: ×1.0 (mida base)
- 2 pèrdues: ×0.5
- 3+ pèrdues: ×0.25

**PYRAMID** — augmenta la mida quan hi ha guanys consecutius (anti-martingala inversa):
- Llegeix els últims trades del bot des del journal per comptar wins consecutives
- 0 wins: `basePct%` (mida base)
- 1 win: `basePct% × factor`
- N wins: `basePct% × factor^N` (màxim `pyramidMaxLevel` nivells)
- Qualsevol pèrdua reseteja el comptador a 0
- Cap màxim: mai supera el 50% del `budgetUsdt`

### Criteris d'entrada (indicadors)

L'anàlisi tècnica avalua:
- **RSI** (14): compra si < 40, evitar si > 70
- **MACD**: creuament positiu
- **EMA 20/50/200**: preu per sobre de les EMAs
- **Bollinger Bands**: preu a banda inferior (reversió)
- **Stochastic**: zona de sobrevenda
- **Volum**: confirma el moviment
- **Patrons de vela**: Hammer, Doji, Engulfing, Morning Star...

El score final (0–100) pondera tots els senyals. Un bot entra quan supera `min_probability`.

---

## 4. Scheduler

**Fitxer:** `app/lib/scheduler.ts`

Tasques periòdiques que s'executen independentment dels motors de trading:

| Tasca | Interval | Descripció |
|-------|---------|-----------|
| Snapshot portfolio | Cada 15 min | Desa el valor total a `snapshots` |
| Informe horari | Cada hora | Envia a Telegram: balanç vs snapshot d'1h anterior |
| Informe diari | Cada dia a les 07:30 | Envia a Telegram: resum de les últimes 24h |
| Consistència d'ordres | Cada hora | Compara ordres Binance vs DB; alerta si hi ha divergències |

### Informe horari (Telegram)
```
📊 Informe horari
Valor total: $15,420  (+$342 vs fa 1h, +2.3%)
Ordres obertes: 5 (3 OCO · 2 LIMIT)
```

### Informe diari (Telegram)
```
📈 Resum diari — 17 abr 2026
Valor inicial: $14,800
Valor final:   $15,420
Variació: +$620 (+4.2%)
Trades avui: 3 (2 TP, 1 SL)
Win rate: 66.7%
```

---

## 5. MotorWatchdog i CrashMonitor

**Fitxers:** `app/lib/motor-watchdog.ts`, `app/lib/crash-monitor.ts`

Dos processos auxiliars que vetllen per la salut dels motors principals:

- **MotorWatchdog**: comprova periòdicament que el TrailingEngine i l'OrderMonitor segueixen actius. Si detecta que s'han aturat (per error no capturat), els reinicia i envia alerta Telegram.

- **CrashMonitor**: captura errors no gestionats (`unhandledRejection`, `uncaughtException`), els registra a `app_errors` i envia alerta Telegram amb el stack trace.

---

## Modes paper i real als motors

Tots els motors respecten el mode assignat a cada bot o trailing:

```typescript
// TrailingEngine — usa el mode del trailing_active
await cancelOrder(symbol, orderId, trailing.mode);
await placeSLOrder(symbol, qty, slPrice, trailing.mode);

// OrderMonitor — consulta ambdós modes per separat
const paperOrders = await getOpenOrders("paper");
const realOrders  = await getOpenOrders("real");

// AutoTrader — usa el mode del bot
await placeMarketBuy(symbol, qty, bot.mode);
await placeOcoOrder(params, bot.mode);
```

---

## Activar / desactivar motors

Des del dashboard (Configuració → Status) o via settings:

| Setting | Propòsit |
|---------|---------|
| `trailing_engine_enabled` | Activa/desactiva el TrailingEngine |
| `order_monitor_enabled` | Activa/desactiva l'OrderMonitor |
| `auto_trade_enabled` | Activa/desactiva l'AutoTrader (tots els bots) |
| `scheduler_enabled` | Activa/desactiva les tasques del Scheduler |

## Controls de bots per mode

A **Configuració → Bots** hi ha tres nivells de control:

| Nivell | On | Efecte |
|--------|----|--------|
| **Master switch** (`auto_trade_enabled`) | Settings | Para absolutament tots els bots, independentment del mode |
| **Bulk paper** | Botons "Activar tots / Desactivar tots" (fila Paper) | Activa/desactiva tots els bots `mode=paper` d'una sola acció |
| **Bulk real** | Botons "Activar tots / Desactivar tots" (fila Real) | Activa/desactiva tots els bots `mode=real` (requereix confirmació) |
| **Individual** | Toggle per cada bot card | Activa/desactiva un bot concret |

La fila bulk és visible només si hi ha bots del mode corresponent. El comptador `actius/total` s'actualitza en temps real.

Internament usa `PATCH /api/bots` amb `{ bulk: true, mode, enabled }` que executa un únic `UPDATE bots SET enabled = ?` a la base de dades del mode corresponent (`paper.db` o `real.db`).

---

## Vegeu també

[[01_architecture]] · [[02_api-reference]] · [[03_database-schema]] · [[08_integrations]]
