# TOTELSISTEMA — Documentació completa del sistema de trading automatitzat de criptomonedes

> **Versió:** 2.0 · **Data:** Març 2026 · **Autor:** Projecte privat
> *Aquest document descriu de manera exhaustiva l'arquitectura, el funcionament, les estratègies i el potencial econòmic d'un sistema de trading de criptomonedes basat en anàlisi tècnica automatitzada i gestió activa del risc.*
>
> **Canvis v2.0:** Multi-bot auto-trader complet, crash monitor BTC, SSE en temps real, journal de trades, simulació integrada, mode PIVOT_LOW per al trailing, validació de seguretat robusta (path traversal, whitelist de settings, timeouts AbortSignal), correccions de race condition al trailing engine.

---

## Taula de continguts

1. [Resum executiu](#1-resum-executiu)
2. [Context i motivació](#2-context-i-motivació)
3. [Visió general del projecte](#3-visió-general-del-projecte)
4. [Arquitectura tècnica](#4-arquitectura-tècnica)
5. [Interfície d'usuari — el Dashboard](#5-interfície-dusuari--el-dashboard)
6. [El sistema d'ordres](#6-el-sistema-dordres)
7. [El motor de trailing stop](#7-el-motor-de-trailing-stop)
8. [Anàlisi tècnica automatitzada](#8-anàlisi-tècnica-automatitzada)
9. [L'escàner d'estratègies — Strategy Matrix](#9-lescàner-destrategies--strategy-matrix)
10. [El sistema de multi-bot auto-trader](#10-el-sistema-de-multi-bot-auto-trader)
11. [El monitor de crash BTC](#11-el-monitor-de-crash-btc)
12. [Sistema de notificacions Telegram](#12-sistema-de-notificacions-telegram)
13. [Gestió de logs i monitoratge en temps real](#13-gestió-de-logs-i-monitoratge-en-temps-real)
14. [Autenticació i seguretat](#14-autenticació-i-seguretat)
15. [Persistència de dades](#15-persistència-de-dades)
16. [El portfolio i la gestió del capital](#16-el-portfolio-i-la-gestió-del-capital)
17. [Estratègies de trading implementades](#17-estratègies-de-trading-implementades)
18. [Gestió del risc](#18-gestió-del-risc)
19. [Historial i anàlisi de rendiment](#19-historial-i-anàlisi-de-rendiment)
20. [Flux de treball diari](#20-flux-de-treball-diari)
21. [Integració amb Binance](#21-integració-amb-binance)
22. [Línies futures de desenvolupament](#22-línies-futures-de-desenvolupament)
23. [Previsió de guanys i anàlisi econòmica](#23-previsió-de-guanys-i-anàlisi-econòmica)
24. [Apèndix tècnic](#24-apèndix-tècnic)
25. [Glossari](#25-glossari)
26. [Consideracions legals i fiscals](#26-consideracions-legals-i-fiscals)

---

## 1. Resum executiu

Aquest document descriu un sistema de trading de criptomonedes dissenyat, desenvolupat i operat per a ús privat. El sistema combina l'anàlisi tècnica automatitzada amb una interfície visual intuïtiva per facilitar la presa de decisions d'inversió en mercats de criptomonedes, principalment en parells de USDT a la plataforma Binance.

### Punts clau

- **Plataforma:** Aplicació web Next.js 15 amb backend integrat (App Router + API Routes)
- **Broker:** Binance (testnet per defecte, fàcilment migrable a live)
- **Tipus d'ordres:** Mercat, Límit, OCO (One-Cancels-Other), Stop Loss amb trailing dinàmic
- **Anàlisi:** Cinc estratègies tècniques simultànies en tres temporalitats (5m, 1h, 4h)
- **Alertes:** Notificacions Telegram en temps real, informe horari de P&L i resum diari a les 7:30
- **Risc:** Gestió integrada amb TP/SL automàtics, trailing stop adaptatiu (mode ATR i PIVOT_LOW), crash monitor BTC
- **Auto-trading:** Sistema multi-bot configurable: cada bot té budget, horari, límit diari i simulació assignada
- **Temps real:** SSE (Server-Sent Events) per a logs, errors i execucions sense polling
- **Journal:** Registre intern de totes les operacions (entrades, trailing, sortides) amb P&L calculat
- **Capital mínim recomanat:** 1.000–5.000 USDT per operar amb eficàcia
- **Rendiment estimat (conservador):** +8% a +25% anual net de comissions

El sistema combina **suport a la decisió humana** amb **automatització completa opcional** via el sistema de multi-bot, que pot operar autònomament dins dels paràmetres configurats per l'usuari.

---

## 2. Context i motivació

### 2.1 El mercat de criptomonedes

Les criptomonedes representen una de les classes d'actius més volàtils i de major creixement de les últimes dues dècades. Bitcoin (BTC), la primera i més gran criptomoneda per capitalització, ha passat de valer pràcticament zero l'any 2009 a superar els 100.000 dòlars per unitat el 2025.

Aquesta volatilitat, que espanta els inversors tradicionals, és precisament el que fa les criptomonedes especialment interessants per al trading actiu: un mercat amb moviments del 5–15% diaris ofereix oportunitats que els mercats tradicionals (accions, bons, divises) rarament proporcionen.

Tanmateix, la mateixa volatilitat que crea oportunitats pot destruir capital ràpidament si no es gestiona correctament. La clau està en la combinació de:

1. **Anàlisi tècnica rigorosa** — llegir el mercat mitjançant indicadors matemàtics
2. **Gestió estricta del risc** — mai arriscar més del que es pot perdre
3. **Disciplina emocional** — executar el pla sense deixar-se portar per la por o l'avaricia
4. **Eines tecnològiques** — per executar ordres ràpidament i monitorar posicions en temps real

### 2.2 El problema que resol aquest sistema

Un inversor particular que vol operar en criptomonedes s'enfronta a diverses dificultats:

**Informació fragmentada.** Els preus, les posicions obertes, el historial d'ordres i l'anàlisi tècnica estan en llocs diferents. Cal saltar entre l'app de Binance, TradingView, calculadores de P&L i fulls de càlcul.

**Falta d'alertes intel·ligents.** Binance envia notificacions bàsiques d'execució d'ordres, però no ofereix informes de P&L consolidats, ni alertes de mercat personalitzades, ni resums de rendiment periòdics.

**Gestió manual del trailing stop.** Quan una posició va bé, el trader ha de decidir manualment quan moure el stop loss per protegir guanys. Aquesta decisió manual és difícil en un mercat que no dorm, i sovint resulta en sortides prematures o pèrdua de guanys ja consolidats.

**Anàlisi tècnica laboriosa.** Avaluar manualment cinc estratègies en tres temporalitats per a deu parells de divises seria una feina de dues hores al dia. Automatitzar-ho és la diferència entre una oportunitat aprofitada i una perduda.

**Este sistema resol tots aquests problemes en una única interfície integrada.**

### 2.3 El perfil de l'usuari

El sistema ha estat dissenyat per a un perfil específic d'usuari:

- **Inversor actiu** (no especulador intradiari) que busca rendiments superiors als productes bancaris tradicionals
- **Coneixements tècnics intermedis** — entén els conceptes de trading però no vol programar cada estratègia manualment
- **Temps disponible limitat** — pot dedicar 30–60 minuts al dia a revisar posicions i prendre decisions
- **Tolerància al risc moderada** — accepta perdre una part del capital invertit en operacions individuals però manté controls estrictes sobre el capital total

---

## 3. Visió general del projecte

### 3.1 Descripció en termes no tècnics

Imagina un panell de control semblant al d'un avió modern. A la pantalla principal veus, d'un cop d'ull, totes les teves posicions en criptomonedes: quant val cada una ara mateix, quant has guanyat o perdut respecte al preu d'entrada, i quins límits automàtics de guany i pèrdua has establert.

A la cantonada superior tens un escàner que revisa constantment el mercat: analitza Bitcoin, Ethereum, Solana i altres monedes, i quan detecta que una d'elles presenta condicions favorables de compra, et notifica amb una targeta informativa que inclou el preu d'entrada recomanat, l'objectiu de guany (Take Profit) i el nivell de protecció (Stop Loss).

Si decideixes actuar, amb dos clics fas la compra i el sistema configura automàticament les ordres de protecció. Des d'aquell moment, el sistema vigila la posició i, si el preu puja i activa el trailing stop, el nivell de protecció puja automàticament per assegurar els guanys acumulats.

Cada hora reps un missatge de Telegram amb un resum dels teus guanys i pèrdues de les últimes 60 minuts. A les 7:30 del matí reps el resum del dia anterior amb el rendiment total del portfolio.

Tot el sistema funciona als teus servidors i no depèn de cap servei de tercers (excepte Binance, que és on es custodia i opera el capital).

### 3.2 Diagrama de components (text)

```
┌─────────────────────────────────────────────────────────────────┐
│                    NAVEGADOR WEB (usuari)                        │
│  Dashboard → Portfolio → Ordres → Historial → Escàner → Logs   │
└─────────────────────────┬───────────────────────────────────────┘
                          │ HTTPS
┌─────────────────────────▼───────────────────────────────────────┐
│              SERVIDOR NEXT.JS (App Router)                       │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │  API Routes  │  │   Scheduler  │  │  Background Engines    │ │
│  │  /api/...    │  │  (cron-like) │  │  - Order Monitor       │ │
│  └──────┬───────┘  └──────┬───────┘  │  - Trailing Engine     │ │
│         │                 │          └────────────┬───────────┘ │
│  ┌──────▼─────────────────▼──────────────────────▼───────────┐  │
│  │                   Cache Layer (SQLite)                     │  │
│  │  - Dades de mercat (TTL 30s-5min)                         │  │
│  │  - Estratègies de les ordres                              │  │
│  │  - Trailing actius                                        │  │
│  │  - Snapshots de portfolio                                 │  │
│  └───────────────────────────────────────────────────────────┘  │
└──────────┬──────────────────────────────────────┬───────────────┘
           │ REST API (HMAC-SHA256)               │ Bot API
┌──────────▼───────────────┐          ┌───────────▼────────────┐
│      BINANCE API          │          │    TELEGRAM BOT API    │
│  - Dades de mercat        │          │  - Notificacions       │
│  - Execució d'ordres      │          │  - Informes periòdics  │
│  - Gestió del compte      │          └────────────────────────┘
└──────────────────────────┘
```

### 3.3 Tecnologies principals

| Component | Tecnologia | Motiu d'elecció |
|-----------|-----------|-----------------|
| Framework web | Next.js 15 (App Router) | Full-stack en un sol projecte, API Routes integrades |
| Llenguatge | TypeScript | Tipatge fort, menys errors en producció |
| Base de dades | SQLite (better-sqlite3) | Lleugera, sense servidor, persistent, ideal per a dades locals |
| Gràfics | Recharts | React-natiu, responsive, customitzable |
| Icones | Font Awesome 6 | Biblioteca completa, consistent |
| Logging | Pino + pino-pretty | Alt rendiment, multistream (consola + fitxer) |
| Estils | CSS pur amb variables custom | Control total, sense overhead de framework CSS |

---

## 4. Arquitectura tècnica

### 4.1 Estructura de directoris

```
crypto_dashboard/
│
├── app/                          # Codi principal (Next.js App Router)
│   ├── api/                      # Endpoints del servidor
│   │   ├── analysis/             # Anàlisi tècnica per symbol
│   │   ├── auth/                 # Autenticació (login/logout/status)
│   │   ├── balance/              # Saldos del compte Binance
│   │   ├── bots/                 # CRUD de bots d'auto-trading
│   │   ├── cost-basis/           # Càlcul de cost mitjà per actiu (FIFO)
│   │   ├── debug/audit/          # Informe de diagnòstic complet
│   │   ├── errors/               # Store d'errors del servidor (GET/POST)
│   │   ├── exchange-info/        # Metadades dels parells (tickSize, stepSize)
│   │   ├── journal/              # Journal intern de trades (GET/POST)
│   │   ├── klines/               # Dades de veles (OHLC) amb caché
│   │   ├── klines-range/         # Veles d'un rang temporal concret
│   │   ├── logs/                 # Lectura de fitxers de log diaris
│   │   ├── market/               # Dades de mercat agregades (tickers)
│   │   ├── orders/               # CRUD complet d'ordres
│   │   │   ├── buy-and-exit/     # Compra de mercat + OCO automàtic
│   │   │   ├── cancel/           # Cancel·lació d'ordres
│   │   │   ├── cancel-all/       # Cancel·lació massiva + venda d'emergència
│   │   │   ├── history/          # Historial d'ordres
│   │   │   ├── meta/             # Metadades d'ordres (codi trade, notes)
│   │   │   ├── modify/           # Modificació d'OCO existent
│   │   │   ├── new/              # Nova ordre OCO manual
│   │   │   ├── replace-oco/      # Substitució d'OCO
│   │   │   ├── sell-to-usdt/     # Venda ràpida a USDT
│   │   │   └── trailing/         # Gestió del trailing stop
│   │   │       └── activate/     # Activació manual de trailing
│   │   ├── pnl/                  # Càlcul de P&L per períodes
│   │   ├── settings/             # Configuració persistent (GET/POST amb whitelist)
│   │   ├── simulation/           # Gestió de configuracions de simulació
│   │   ├── stream/               # SSE: events en temps real (logs, errors, fills)
│   │   ├── telegram/             # Enviament de notificacions Telegram
│   │   └── trades/               # Historial de trades executats (Binance)
│   │
│   ├── components/               # Components React (UI)
│   │   ├── AnalysisTab.tsx       # Anàlisi tècnica detallada
│   │   ├── CoinIcon.tsx          # Icones i colors de criptomonedes
│   │   ├── CoinModal.tsx         # Modal de detall de moneda
│   │   ├── CoinSidebar.tsx       # Barra lateral amb preus en temps real
│   │   ├── DashboardShell.tsx    # Shell principal (gestió de tabs i market refresh)
│   │   ├── ErrorBoundary.tsx     # Captura d'errors React amb report al servidor
│   │   ├── ErrorsPanel.tsx       # Panell d'errors del sistema
│   │   ├── JournalTab.tsx        # Journal de trades amb filtres i estadístiques
│   │   ├── LogsPanel.tsx         # Visualitzador de logs en temps real (SSE)
│   │   ├── Nav.tsx               # Navegació principal
│   │   ├── NewOrderModal.tsx     # Modal de nova ordre
│   │   ├── OcoProgressChart.tsx  # Gràfica de progrés OCO
│   │   ├── OrdersPanel.tsx       # Panell principal (tabs)
│   │   ├── PnlStats.tsx          # Estadístiques de P&L
│   │   ├── PortfolioChart.tsx    # Gràfica d'evolució del portfolio
│   │   ├── PortfolioTab.tsx      # Vista de portfolio (donut, evolució, cost basis)
│   │   ├── ServerEventsProvider.tsx # Proveïdor SSE (logs/errors/fills en temps real)
│   │   ├── SettingsTab.tsx       # Configuració completa: bots, trailing, capital
│   │   ├── SimulationTab.tsx     # Backtesting i gestió de simulacions
│   │   ├── StrategyMatrix.tsx    # Escàner d'estratègies (matriu + top oportunitats)
│   │   └── TopbarTicker.tsx      # Ticker superior: BTC, volum, P&L, guanyadors/perdedors
│   │
│   ├── hooks/                    # Hooks React reutilitzables
│   │   ├── useEscapeKey.ts       # Tanca modals amb la tecla Escape
│   │   ├── useFetchInterval.ts   # Polling periòdic amb cleanup automàtic
│   │   └── useServerEvents.ts    # Subscripció al SSE stream
│   │
│   ├── lib/                      # Utilitats i lògica de negoci
│   │   ├── api-error.ts          # Gestió centralitzada d'errors d'API
│   │   ├── auto-trader.ts        # Motor multi-bot: poll 60s, compra + OCO automàtics
│   │   ├── binance-auth.ts       # Client autenticat de Binance (HMAC-SHA256)
│   │   ├── bot-store.ts          # Persistent store de bots (SQLite)
│   │   ├── cache-store.ts        # Caché persistent amb TTL (SQLite)
│   │   ├── constants.ts          # Constants compartides (STABLES, BINANCE_BASE)
│   │   ├── crash-monitor.ts      # Monitor de crash BTC: cancel·lació d'emergència
│   │   ├── error-store.ts        # Store d'errors del servidor (SQLite + SSE broadcast)
│   │   ├── event-bus.ts          # Bus d'events intern per a SSE
│   │   ├── format.ts             # Formatadors de números i dates
│   │   ├── indicators.ts         # Càlcul d'indicadors tècnics (EMA, MACD, RSI, ATR…)
│   │   ├── journal-store.ts      # Store del journal de trades (SQLite)
│   │   ├── logger.ts             # Sistema de logging multi-destí (consola + fitxer)
│   │   ├── order-monitor.ts      # Monitor d'ordres en background (poll 5s)
│   │   ├── pnl-calc.ts           # Càlcul de P&L per parells (FIFO)
│   │   ├── scheduler.ts          # Planificador de notificacions periòdiques
│   │   ├── session.ts            # Gestió de sessions d'autenticació
│   │   ├── settings-store.ts     # Configuració persistent (SQLite) amb validadors
│   │   ├── sse-types.ts          # Tipus TypeScript per a events SSE
│   │   ├── telegram.ts           # Client Telegram (notificacions i alertes)
│   │   ├── trailing-engine.ts    # Motor trailing stop (poll 30s, ATR + PIVOT_LOW)
│   │   └── types.ts              # Tipus TypeScript compartits
│   │
│   ├── login/                    # Pàgina d'autenticació
│   ├── styles/                   # Full d'estils principal
│   └── page.tsx                  # Entrada de l'aplicació (Server Component)
│
├── data/                         # Dades persistents (SQLite)
│   └── cache.db                  # Base de dades principal (settings, bots, journal, etc.)
│
├── logs/                         # Fitxers de log diaris
│   └── YYYY-MM-DD.log            # Un fitxer per dia (NDJSON, format Pino)
│
├── simulation/                   # Configuracions desades de simulació/backtesting
│   └── *.json                    # Cada fitxer és una configuració de bot
│
├── scripts/                      # Scripts d'utilitat i manteniment
├── reports/                      # Informes generats (backtesting, etc.)
└── middleware.ts                  # Protecció de totes les rutes (autenticació)
```

### 4.2 El patró de singleton per processos background

Un dels reptes tècnics principals d'una aplicació Next.js és mantenir processos continus en background (com el motor de trailing stop o el monitor d'ordres) sense que el servidor de desenvolupament els destrueixi i recrei en cada recàrrega.

La solució adoptada és el **patró de singleton via variables globals**:

```typescript
// Exemple simplificat del motor de trailing stop
declare global {
  var __trailingEngineStarted: boolean | undefined;
}

export function ensureTrailingEngine() {
  if (global.__trailingEngineStarted) return;
  global.__trailingEngineStarted = true;
  // Inicia el bucle de monitoratge...
  startTrailingLoop();
}
```

D'aquesta manera, el procés s'inicia exactament una vegada i persisteix durant tota la vida del servidor. Si el servidor es reinicia, el procés es torna a iniciar automàticament quan arriba la primera petició rellevant.

Els quatre motors background del sistema són:

| Motor | Funció | Freqüència |
|-------|---------|-----------|
| `order-monitor` | Detecta ordres completes/cancel·lades, actualitza journal | Cada 5 segons |
| `trailing-engine` | Actualitza el stop loss mòbil (ATR o PIVOT_LOW) | Cada 30 segons |
| `auto-trader` | Escaneig multi-bot, compra automàtica en tancament de candles | Cada 60 segons |
| `crash-monitor` | Monitoritza BTC, cancel·la ordres en crash extrem | Cada 60 segons |
| `scheduler` | Informes Telegram periòdics (horari + 7:30 diari) | Cada hora / 7:30 |

Tots els motors implementen **exponential backoff** en cas d'errors consecutius i usen `AbortSignal.timeout` en totes les crides externes per evitar bloquejos indefinits.

### 4.3 La capa de caché (SQLite)

Totes les dades que no cal obtenir en temps real s'emmagatzemen en una base de dades SQLite local. Aquesta aproximació té diversos avantatges:

**Reducció de latència.** Binance té límits d'API (rate limits) que permeten un nombre màxim de peticions per minut. Cachejant les respostes, el sistema fa servir eficientment el quota disponible.

**Persistència entre reinicis.** A diferència d'una caché en memòria, les dades a SQLite sobreviuen a reinicis del servidor. Això és crític per als trailing stops actius: si el servidor es reinicia, el trailing stop no es perd.

**Dades relacionades.** Les taules de SQLite permeten relaciones entre entitats: un trailing stop actiu sap de quin OCO ve, quina és la seva posició d'entrada, etc.

Les principals taules de la base de dades:

```sql
-- Caché genèrica de clau-valor amb TTL
CREATE TABLE IF NOT EXISTS cache (
  key       TEXT PRIMARY KEY,
  value     TEXT NOT NULL,
  expires   INTEGER NOT NULL
);

-- Trailing stops actius
CREATE TABLE IF NOT EXISTS trailing_active (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  sl_order_id       INTEGER NOT NULL,
  symbol            TEXT NOT NULL,
  side              TEXT NOT NULL,
  quantity          TEXT NOT NULL,
  trail_dist        REAL NOT NULL,
  tick_size         TEXT NOT NULL,
  current_sl        REAL NOT NULL,
  peak_price        REAL NOT NULL,
  entry_price       REAL NOT NULL,
  status            TEXT NOT NULL DEFAULT 'active',
  origin_oco_list_id INTEGER,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

-- Estratègies assignades a cada ordre
CREATE TABLE IF NOT EXISTS order_strategies (
  order_key  TEXT PRIMARY KEY,
  strategy   TEXT NOT NULL
);

-- Suggeriments de trailing per a OCO
CREATE TABLE IF NOT EXISTS trailing_suggestions (
  order_list_id INTEGER PRIMARY KEY,
  data          TEXT NOT NULL,
  expires       INTEGER NOT NULL
);

-- Snapshots de portfolio per calcular P&L
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  ts    INTEGER PRIMARY KEY,
  data  TEXT NOT NULL
);
```

### 4.4 Sincronització temporal amb Binance

Binance exigeix que les peticions autenticades portin un timestamp que no difereixi més de 5 segon del rellotge del servidor de Binance. Si el servidor de l'aplicació té el rellotge desajustat (cosa habitual en màquines virtuals o sistemes amb NTP poc freqüent), les peticions fallen amb error d'autenticació.

El sistema implementa sincronització automàtica:

```typescript
async function getSyncedTimestamp(): Promise<number> {
  const now = Date.now();
  // Re-sincronitza cada 5 minuts
  if (now - _lastSync > 5 * 60 * 1000) {
    const r = await fetch(`${BINANCE_API}/time`);
    const d = await r.json();
    _timeOffset = d.serverTime - Date.now();
    _lastSync = Date.now();
  }
  return Date.now() + _timeOffset;
}
```

---

## 5. Interfície d'usuari — el Dashboard

### 5.1 Filosofia de disseny

El dashboard ha estat dissenyat seguint el principi de **"informació densa sense soroll visual"**. Cada píxel de pantalla ha d'aportar valor. Els elements decoratius purs s'han eliminat. El resultat és una interfície que pot semblar austera a primera vista però que permet assimilar molta informació en una sola ullada.

La paleta de colors usa **variables CSS personalitzades** que permeten adaptar el tema fàcilment (mode clar/fosc). El sistema actual usa un tema fosc per defecte, menys fatigant per a sessions llargues de monitoratge.

### 5.2 Les tabs principals

El panell principal s'organitza en deu pestanyes:

#### Portfolio
Vista de conjunt de totes les criptomonedes que componen el compte. Inclou:
- Gràfic de pastís amb els colors de marca de cada criptomoneda (BTC en taronja, ETH en blau, SOL en verd, etc.)
- Taula amb: preu actual, valor de la posició en USDT, canvi en 24h
- Valor total del portfolio en USDT

#### Ordres obertes (Open Orders)
Llista de totes les ordres actives. Cada ordre es mostra com una "targeta" que inclou:
- Identificació: coin, par, tipus d'ordre, data
- Import de l'entrada en gran (prominent)
- Gràfica de progrés entre el preu d'entrada i els nivells de TP/SL
- Indicadors de distància al TP i al SL en percentatge
- Controls per editar o cancel·lar l'ordre

Quan una ordre té trailing stop configurat, la targeta mostra l'estat del trailing: pic de preu màxim vist, stop loss actual, distància de trailing.

#### Historial (History)
Registre de totes les ordres executades o cancel·lades. Les compres de mercat i les OCO associades es mostren **agrupades** en una sola targeta que reflecteix el trade complet:
- Preu d'entrada (compra de mercat)
- Preu de sortida (TP o SL executat)
- P&L de l'operació en USDT i percentatge
- Durada del trade
- Comissions totals pagades

#### Balance
Visualització del saldo del compte en format de fitxes (cards). Ordenat per rellevància:
1. Primer USDT/estables (el capital disponible)
2. Després la resta per valor USD descendent

Cada fitxa mostra: icon de la moneda, symbol, import total, valor en USD, quantitat lliure vs bloquejada (en ordres), preu actual i barra de proporció respecte al portfolio total.

#### Anàlisi (AnalysisTab)
Anàlisi tècnica detallada per a un symbol específic. L'usuari pot seleccionar qualsevol par USDT i temporalitat, i el sistema retorna:
- Puntuació de compra (0-100)
- Veredicte (BUY / WAIT / AVOID)
- Detall de les cinc estratègies: activa/inactiva, confiança, TP i SL suggerits
- Suggeriment de trailing stop (activació i distància en ATR)

#### Escàner (Matrix)
La vista més potent del sistema. Mostra una matriu de tots els parells monitorats × totes les temporalitats, amb el veredicte de cada combinació. Dalt de la matriu, les "Top Oportunitats" es mostren com targetes individuals amb:
- Gràfica de preu (corba, 48 períodes)
- Probabilitat estimada d'èxit
- Preu actual, TP i SL suggerits
- Botons per crear l'ordre directament

#### Journal
Registre intern de totes les operacions: compres (ENTRY_BUY, ENTRY_OCO), activacions de trailing (TRAIL_ACTIVE), sortides (EXIT_TRAILING, EXIT_MARKET). Cada entrada inclou preu, quantitat, P&L calculat, codi de trade i notes. Permet analitzar el rendiment per estratègia, interval i tipus de sortida.

#### Simulació
Gestió de configuracions de backtesting. Cada configuració (*.json a `/simulation/`) defineix els parells, l'interval, els paràmetres ATR de TP/SL/trailing i la capital. Aquestes configuracions s'assignen als bots d'auto-trading.

#### Configuració (Settings)
Panell de configuració complet:
- Notificacions Telegram (toggle per tipus d'event)
- Mode de trailing stop (ATR o PIVOT_LOW) i paràmetres
- Gestió de capital (FIXED o PCT_PORTFOLIO)
- Multi-bot: creació, edició i activació de bots d'auto-trading
- Presets de configuració per temporalitat (5m / 1h / 4h)
- Switch mestre d'auto-trading

#### Errors del sistema
Llista dels últims errors del servidor: falles de l'API de Binance, errors de càlcul, problemes de connectivitat. Actualitzat en temps real via SSE. Útil per diagnosticar problemes sense accedir als logs.

#### Logs del servidor
Visualitzador de logs en temps real via SSE. Els logs es mostren en ordre cronològic invers (el més recent primer). Inclou filtres per nivell (DEBUG, INFO, WARN, ERROR) i per mòdul (trailing-engine, order-monitor, telegram, etc.).

### 5.3 Disseny responsive

Tot i que l'aplicació s'optimitza per a pantalles d'escriptori o portàtil (1280px+), el disseny és responsive i funciona en tablets. En pantalles petites:
- Els textos dels botons s'amaguen (queden només les icones)
- Les taules s'adapten amb scroll horitzontal
- Les targetes es reorganitzen en columna única

### 5.4 Colors de marca de les criptomonedes

Un detall important de la interfície és l'ús dels **colors de marca oficials** de cada criptomoneda:

| Symbol | Color oficial | Hex |
|--------|--------------|-----|
| BTC | Taronja Bitcoin | `#F7931A` |
| ETH | Blau Ethereum | `#627EEA` |
| BNB | Groc Binance | `#F3BA2F` |
| SOL | Verd Solana | `#14F195` |
| LTC | Gris plata Litecoin | `#BFBBBB` |
| ADA | Blau Cardano | `#0033AD` |
| DOT | Rosa Polkadot | `#E6007A` |
| AVAX | Vermell Avalanche | `#E84142` |
| LINK | Blau Chainlink | `#2A5ADA` |
| XRP | Blau XRP | `#00AAE4` |

---

## 6. El sistema d'ordres

### 6.1 Tipus d'ordres suportats

El sistema suporta tots els tipus d'ordre principals de Binance:

#### Ordre de mercat (MARKET)
Executa la compra o venda immediatament al millor preu disponible. S'utilitza exclusivament per a les entrades (compres), mai per a les sortides (ja que el preu obtingut pot ser pitjor del previst en mercats volàtils).

**Quan s'usa:** En la funcionalitat "Compra directa" de l'escàner, on la velocitat d'execució és prioritària.

#### Ordre límit (LIMIT)
Ordre que s'executa únicament si el mercat arriba al preu especificat. Si el preu no s'assoleix, l'ordre queda pendent fins que es cancel·la.

**Quan s'usa:** Per a sortides manuals amb preu objectiu específic.

#### LIMIT_MAKER
Variant de l'ordre límit que garanteix que l'ordre no s'executa mai com a "taker" (consumidora de liquiditat). Sempre s'executa com a "maker" (proveïdora de liquiditat), assegurant la comissió més baixa possible.

**Quan s'usa:** Per al Take Profit (TP) dins de les OCO.

#### STOP_LOSS_LIMIT
Ordre en dos passos: quan el preu toca el "stop price" (trigger), s'activa una ordre límit al "limit price". El limit price s'estableix lleugerament per sota del stop price (normalment un 0.1% menys) per assegurar l'execució en mercats en caiguda ràpida.

**Quan s'usa:** Per al Stop Loss (SL) dins de les OCO.

#### OCO (One-Cancels-Other)
Combinació de LIMIT_MAKER (TP) i STOP_LOSS_LIMIT (SL) en una sola instrucció. Quan una de les dues s'executa, l'altra es cancel·la automàticament. És el mecanisme fonamental de gestió del risc del sistema.

**Quan s'usa:** Sempre que s'obre una posició de SELL (sortida).

### 6.2 El flux "Compra i Surt" (buy-and-exit)

Aquesta és la operació més habitual del sistema. Combina una compra de mercat amb la configuració automàtica d'una OCO:

```
1. L'usuari clica "Compra directa" a l'escàner
   └─ Selecciona el symbol (per exemple SOLUSDT)
   └─ Introdueix l'import en USDT (per exemple 50 USDT)
   └─ Confirma

2. El sistema executa una ordre de mercat BUY
   └─ Binance executa al millor preu disponible
   └─ Es rep la confirmació: preu de fill exacte i quantitat obtinguda

3. El sistema consulta els paràmetres de precisió
   └─ tickSize: mínim moviment de preu (per exemple 0.01 USDT)
   └─ stepSize: mínim moviment de quantitat (per exemple 0.001 SOL)

4. El sistema calcula els preus de TP i SL
   └─ TP = preu_fill × (1 + tpPct/100), arrodonit CAP AMUNT al tick
   └─ SL_stop = preu_fill × (1 - slPct/100), arrodonit CAP AVALL al tick
   └─ SL_limit = SL_stop × 0.999, arrodonit CAP AVALL al tick

5. Validació de preus
   └─ TP > preu_fill > SL_stop > SL_limit (condició obligatòria Binance)

6. El sistema coloca l'ordre OCO SELL
   └─ Quantity = exactament la quantitat rebuda al pas 2
   └─ aboveType = LIMIT_MAKER, abovePrice = TP
   └─ belowType = STOP_LOSS_LIMIT, belowStopPrice = SL_stop, belowPrice = SL_limit

7. Si l'estratègia inclou trailing stop, es desa la configuració
   └─ activateAt: preu al qual s'activa el trailing
   └─ distance: distància en USDT del stop mòbil
   └─ El motor de trailing monitorarà l'OCO i l'activarà automàticament
```

### 6.3 Arrodoniment de preus: per què importa

Un error comú quan es treballa amb l'API de Binance és usar l'arrodoniment matemàtic estàndard (Math.round) per als preus de les ordres. Això pot causar errors en les OCO:

**El problema:** Si el TP calculat és 97.345 USDT i el tickSize és 0.01, Math.round dona 97.35. Però si el preu de fill és 97.35, el TP és igual al preu de fill, violant la condició TP > preu_fill que exigeix Binance.

**La solució:**
- Per al TP: sempre arrodonir CAP AMUNT (Math.ceil) — assegura que el TP sempre és estrictament superior al preu d'entrada
- Per al SL: sempre arrodonir CAP AVALL (Math.floor) — assegura que el SL sempre és estrictament inferior al preu d'entrada

```typescript
// TP: sempre per sobre → Math.ceil
export function roundPriceUp(price: number, tickSize: string): string {
  const s  = parseFloat(tickSize);
  const dp = tickSize.includes(".") ? tickSize.length - tickSize.indexOf(".") - 1 : 0;
  return (Math.ceil(price / s) * s).toFixed(dp);
}

// SL: sempre per sota → Math.floor
export function roundPriceDown(price: number, tickSize: string): string {
  const s  = parseFloat(tickSize);
  const dp = tickSize.includes(".") ? tickSize.length - tickSize.indexOf(".") - 1 : 0;
  return (Math.floor(price / s) * s).toFixed(dp);
}
```

### 6.4 Modificació i cancel·lació d'ordres

El sistema permet modificar les ordres OCO obertes sense cancel·lar-les manualment:

- **Modificar TP/SL:** El sistema cancel·la l'OCO existent i en crea una de nova amb els nous preus. La quantitat es manté igual.
- **Cancel·lar:** Cancel·lació directa via l'API de Binance amb confirmació visual.

En ambdós casos, el sistema actualitza la interfície immediatament sense necessitat de refresc manual.

---

## 7. El motor de trailing stop

### 7.1 Concepte de trailing stop

Un trailing stop és un stop loss que es mou automàticament seguint el preu quan aquest es mou a favor de la posició. El stop loss s'ajusta cap amunt (per a posicions llargues/BUY) però mai cap avall.

**Exemple:**
- Entrades: 100 USDT
- Trailing distance: 2 USDT
- SL inicial: 98 USDT

Si el preu puja a 105 USDT:
- Nou pic = 105 USDT
- Nou SL = 105 - 2 = 103 USDT ✓ (s'ha actualitzat)

Si el preu baixa a 104 USDT:
- Pic = 105 USDT (no canvia)
- SL = 103 USDT (no canvia cap avall)

Si el preu baixa a 103 USDT:
- S'executa el SL → sortida a ~103 USDT → guany de 3 USDT

Sense trailing stop, si el preu hagués tornat a 100 USDT o menys, s'hauria perdut tot el guany acumulat.

### 7.2 Dos modes de trailing stop

El sistema implementa dos modes de càlcul del SL mòbil, configurables des de la tab de Settings:

#### Mode ATR (per defecte)
L'**Average True Range (ATR)** calibra el trailing dinàmicament en funció de la volatilitat:

```
trailing_distance = N × ATR(14)
```

On N és el multiplicador configurable per l'estratègia (típicament 0.5 a 2.0).

**Exemple:** ATR de BTCUSDT/1h = 500 USDT, multiplicador = 1.5 → distància = 750 USDT des del pic.

#### Mode PIVOT_LOW
En lloc d'una distància fixa des del pic, el SL es col·loca just per sota del darrer **pivot low** (mínim local significatiu) detectat en la temporalitat configurada (per defecte 1h). Es detecta com el punt on el preu baixa entre dos laterals, amb un offset configurable per evitar execucions en el tick exacte.

```
SL = pivot_low × (1 - offset_pct)
```

**Avantatge:** En tendències fortes, el PIVOT_LOW s'adapta millor a l'estructura del mercat que un offset fix des del pic. **Inconvenient:** Si no es detecta pivot, el sistema usa el mode ATR com a fallback.

El mode es pot canviar en qualsevol moment des de Settings; els trailing actius existents s'adapten al nou mode al proper cicle.

### 7.3 Condicions d'activació

El trailing stop no s'activa immediatament quan s'obre la posició. Primer cal que el preu assoleixi un nivell d'activació (activateAt), que también es calcula en funció de l'ATR:

```
activate_at = entry_price + (M × ATR(14))
```

On M és el multiplicador d'activació (típicament 1.0 a 2.0, superior al multiplicador de distància).

**Lògica:** No té sentit activar el trailing stop si la posició no té guanys. Activant-lo només quan el preu ha superat N ATR des de l'entrada, ens assegurem que el trailing comença des d'una posició de guany.

### 7.4 El bucle de monitoratge

El motor de trailing stop executa un bucle cada **30 segons**:

```
Per cada trailing_suggestion activa:
  1. Obtenir el preu actual del symbol
  2. Comprovar si el preu ha superat el activateAt
  3. Si sí → activar el trailing:
     a. Cancel·lar l'OCO existent (SL fix)
     b. Crear una nova ordre STOP_LOSS_LIMIT al preu calculat
     c. Desar l'estat actiu a la base de dades
     d. Anotar al journal (TRAIL_ACTIVE)

Per cada trailing_active:
  1. Consultar l'estat de l'ordre SL a Binance
  2. Si FILLED → marcar com completat, anotar al journal (EXIT_TRAILING)
  3. Si CANCELED/EXPIRED → si cancel_auto_sell actiu, vendre a mercat
  4. Si OPEN i preu > pic → calcular nou SL (ATR o PIVOT_LOW)
  5. Si nou SL > SL actual:
     a. Cancel·lar l'ordre SL anterior
     b. Col·locar la nova ordre SL (dins del mateix try → si falla, cap SL actiu)
     c. Actualitzar pic i SL a la BD
```

### 7.5 Robustesa i seguretat de les operacions atòmiques

El motor inclou gestió d'errors exhaustiva:

**Race condition cancel+replace eliminada:** La cancel·lació del SL antic i la col·locació del nou SL es fan dins del **mateix bloc `try`**. Si la col·locació del nou SL falla (error Binance, timeout), el trailing es marca com `error` i s'atura per a aquell actiu, evitant que la posició quedi sense cap protecció de forma silenciosa. L'unlock del lock de concurrència (`trailingSlUnlock`) es fa sempre al `finally`.

**Backoff per errors consecutius:** Cada trailing actiu té un comptador d'errors independent. Quan arriba a 3 errors seguits, el trailing es posa en pausa (exponential backoff, màxim 30 minuts) per evitar crides en bucle a una API que no respon.

**AbortSignal en totes les crides externes:** Tots els `fetch` a Binance porten `signal: AbortSignal.timeout(10_000)` per garantir que cap crida bloqueja el cicle indefinidament.

**Notificacions no bloquejants:** Totes les crides a `notifyX()` de Telegram usen `.catch(err => log.trailing.warn(...))` — un error de Telegram no atura el cicle del motor ni perd la traçabilitat.

---

## 8. Anàlisi tècnica automatitzada

### 8.1 Principis de l'anàlisi tècnica

L'anàlisi tècnica és l'estudi dels moviments del preu i del volum per predir la direcció futura del mercat. Es basa en tres premisses fonamentals:

1. **El mercat descuenta tot:** Tota la informació disponible (fonamental, psicològica, política) ja es reflecteix en el preu.
2. **Els preus es mouen en tendències:** Un preu en tendència alcista tendeix a continuar pujant fins que quelcom el freni.
3. **La història es repeteix:** Els patrons de comportament dels participants del mercat tendeixen a repetir-se al llarg del temps.

### 8.2 Els indicadors tècnics usats

El sistema implementa cinc estratègies basades en els indicadors tècnics més robustos i provats al llarg de dècades:

#### Indicadors de tendència

**EMA (Exponential Moving Average)**
Mitjana mòbil que dona més pes als preus recents. El sistema usa les EMAs de 9, 20, 50 i 200 períodes. Quan l'EMA9 > EMA20 > EMA50, es confirma una tendència alcista forta.

**MACD (Moving Average Convergence Divergence)**
Indicador de moment que mesura la diferència entre dues EMAs (típicament 12 i 26 períodes) i la senyalitza amb una "línia de senyal" (EMA9 del MACD). Un creuament del MACD per sobre de la línia de senyal és un senyal de compra.

#### Indicadors de força i volum

**RSI (Relative Strength Index)**
Oscil·lador (0-100) que mesura la velocitat i magnitud dels moviments de preu. Valors > 70 indiquen sobrecompra, < 30 sobrevenuda. Per a estratègies de compra, el sistema cerca RSI entre 40 i 65 (tendència alcista sense sobrecompra extrema).

**Volume Surge (puja de volum)**
Compara el volum actual amb la mitjana dels últims 20 períodes. Un volum superior a 1.5× la mitjana en moviments alcistes confirma la força de la tendència.

#### Indicadors de volatilitat

**ATR (Average True Range)**
Ja descrit a la secció del trailing stop. S'usa per calibrar els nivells de TP/SL en funció de la volatilitat real del mercat, no d'un percentatge fix arbitrari.

**Bollinger Bands**
Dues bandes (superior i inferior) calculades com ±2 desviacions estàndard de la SMA20. Un preu proper a la banda inferior en tendència alcista pot indicar una oportunitat de compra.

### 8.3 Les cinc estratègies implementades

#### Estratègia 1: Trend Following Alcista (TF↑)

**Concepte:** Seguir la tendència alcista establerta.

**Condicions d'activació:**
- EMA9 > EMA20 (tendència de curt termini alcista)
- EMA20 > EMA50 (tendència de mitjà termini alcista)
- MACD per sobre de la línia de senyal (momentum positiu)
- RSI entre 45 i 70 (força alcista sense sobrecompra)

**TP:** fillPrice × (1 + 2 × ATR / fillPrice × 100)%
**SL:** fillPrice × (1 - 1.5 × ATR / fillPrice × 100)%

**Perfil:** Alta confiança quan les tres condicions coincideixen en múltiples temporalitats.

#### Estratègia 2: Trend Following Bajista (TF↓)

**Concepte:** Evitar o vendre en tendències bajistes.

**Condicions d'activació (AVOID):**
- EMA9 < EMA20 < EMA50 (tendència bajista a tots els terminis)
- MACD negatiu
- RSI en zona feble (< 45)

Quan aquesta estratègia és activa, el sistema recomana AVOID: no obrir posicions llargues.

#### Estratègia 3: Reversió Alcista (Rev↑)

**Concepte:** Identificar un possible gir de bajista a alcista.

**Condicions d'activació:**
- RSI per sota de 35 (sobrevenuda)
- EMA9 creuant per sobre de l'EMA20 per primera vegada
- Reducció del volum en la caiguda (exhauriment dels venedors)

**TP:** 1.5 × ATR per sobre de l'entrada
**SL:** 1.0 × ATR per sota de l'entrada

**Perfil:** Confiança moderada. Major risc que TF↑ però potencialment major recompensa.

#### Estratègia 4: Reversió Bajista (Rev↓)

**Concepte:** Identificar agotament d'un moviment alcista.

**Condicions d'activació (WAIT/AVOID):**
- RSI per sobre de 75 (sobrecompra extrema)
- MACD divergència: el preu fa nous màxims però el MACD no
- Volum decreixent en la pujada

En aquest cas el sistema recomana WAIT: esperar millor punt d'entrada.

#### Estratègia 5: Breakout Alcista (BRK)

**Concepte:** Capturar la ruptura d'un nivell de resistència important.

**Condicions d'activació:**
- El preu supera la banda superior de Bollinger
- Volum superior a 2× la mitjana (confirma la ruptura)
- RSI en acceleració (50-70)
- EMA50 en tendència alcista (pendent positiva)

**TP:** 2.5 × ATR per sobre del breakout
**SL:** Per sota de la banda superior de Bollinger (ara suport)

**Perfil:** Menys freqüent que TF↑ però amb major potencial de guany.

### 8.4 El sistema de puntuació i veredicte

Cada estratègia activa contribueix a una puntuació total (0-100). La puntuació es calcula ponderant:

- Nombre d'estratègies alcistes actives
- Nivell de confiança de cada una (alta: 10 pts, moderada: 5 pts, baixa: 2 pts)
- Confluència entre temporalitats: si BUY en 5m, 1h i 4h alhora → bonus +15 pts

El veredicte final:
- **BUY:** puntuació ≥ 60 i almenys una estratègia alcista activa d'alta confiança
- **WAIT:** puntuació 30-59 o senyals mixtos
- **AVOID:** puntuació < 30 o estratègia bajista dominant activa

### 8.5 El càlcul de probabilitat

Per a les "Top Oportunitats", el sistema calcula una probabilitat estimada d'èxit:

```
probabilitat = (score × 0.7) + bonus_interval + bonus_confiança + bonus_confluència
```

On:
- `bonus_interval`: 4h → +10, 1h → +5, 5m → 0 (major temporalitat = senyal més fiable)
- `bonus_confiança`: alta → +10, moderada → +5
- `bonus_confluència`: (n_intervals_BUY - 1) × 5

El valor màxim és 95% (mai 100%, perquè no existeix certesa en trading).

---

## 9. L'escàner d'estratègies — Strategy Matrix

### 9.1 Visió general

L'escàner és la vista de descobriment d'oportunitats. Analitza tots els parells configurats (per defecte: BTC, ETH, BNB, SOL, LTC, ADA, DOT, AVAX, LINK, XRP) en tres temporalitats (5m, 1h, 4h), resultant en fins a 30 anàlisis simultànies.

La matriu es refresca a petició de l'usuari. Donada la quantitat d'anàlisis, el sistema les executa en paral·lel (quatre fils concurrents) i va omplint la matriu progressivament a mesura que arriben els resultats.

### 9.2 Interpretació de la matriu

Cada cel·la de la matriu mostra:
- **Veredicte:** BUY (verd) / WAIT (groc) / EVIT (vermell)
- **Puntuació:** 0-100
- **Punts de les estratègies:** cinc punts de colors (verd = bullish activa, vermell = bearish activa, gris = inactiva)

La lectura ràpida permet identificar:
- Files amb molts BUY: moneda en tendència alcista en múltiples temporalitats
- Files amb molts EVIT: moneda en tendència bajista, millor evitar
- Files mixtes: mercat indecís, esperar confirmació

### 9.3 Les targetes d'oportunitat

Dalt de la matriu, les cinc millors oportunitats es mostren com targetes visuals que inclouen:
- Gràfica de preu (corba de les últimes 48 veles)
- Probabilitat en gran amb codi de colors
- Nom de l'estratègia dominant
- Preu actual, TP i SL suggerits amb percentatge de distància

### 9.4 La funcionalitat d'auto-compra

El sistema inclou una funcionalitat opcional d'auto-compra: quan la probabilitat supera el 80% (configurable), executa automàticament la compra sense confirmació de l'usuari.

**Avís important:** Aquesta funcionalitat s'ha de usar amb extrema precaució. Recomanem:
- Activar-la únicament amb imports petits (5-10 USDT per operació)
- Monitorar activament les primeres setmanes
- Desactivar-la en períodes d'alta volatilitat o incertesa macroeconòmica

---

## 10. El sistema de multi-bot auto-trader

### 10.1 Visió general

L'auto-trader permet configurar múltiples **bots d'auto-trading** que operen de manera autònoma, cadascun amb la seva pròpia configuració de símbols, capital, horari i límits diaris. Tots els bots comparteixen el master switch `auto_trade_enabled` (configurable des de Settings).

### 10.2 Arquitectura del bot

Cada bot és un registre a la taula `bots` de SQLite amb els camps:

| Camp | Descripció | Exemple |
|------|-----------|---------|
| `name` | Nom identificador | "Scalper 5m BTC/ETH" |
| `simId` | ID de la configuració de simulació assignada | "sim_20260308_abc12" |
| `enabled` | Bot actiu/inactiu | `true` |
| `budgetUsdt` | Capital màxim del bot en USDT | `500` |
| `maxDaily` | Màxim d'operacions per dia | `3` |
| `hoursFrom` | Hora UTC d'inici de la finestra de trading | `8` |
| `hoursTo` | Hora UTC de fi de la finestra de trading | `22` |
| `requireMultiTf` | Requereix confirmació del TF superior | `true` |

La configuració de trading (símbols, interval, ATR per a TP/SL/trailing) prové del fitxer de simulació associat (`simulation/{simId}.json`). Això permet reutilitzar configuracions validades per backtesting directament en trading real.

### 10.3 El cicle de poll global

El motor globalPoll s'executa cada **60 segons** al servidor:

```
1. Comprovar master switch (auto_trade_enabled)
2. Obtenir tots els bots enabled
3. Per cada bot:
   a. Carregar la configuració de simulació (simId validat contra path traversal)
   b. Comprovar si la candle del seu interval acaba de tancar (últims 60s)
   c. Si sí → runBotScan(bot, simConfig) en paral·lel (no bloqueja altres bots)
```

### 10.4 El scan per bot (runBotScan)

```
Per cada symbol de la configuració:
  1. Comprovar finestra horària UTC (hoursFrom ≤ nowHour < hoursTo)
  2. Comprovar límit diari (comptador en memòria, reset a mitjanit UTC)
  3. Comprovar pressupost (ordres OCO obertes × USDT/op ≤ budgetUsdt)
  4. fetchAndAnalyze(symbol, interval):
     - Crida directa a Binance API (250 candles)
     - Retry automàtic fins a 3 vegades en cas de 429 (backoff exponencial: 1s, 2s, 4s)
  5. Si score ≥ minScore i verdict = "BUY":
     a. Si requireMultiTf: confirmar en el TF superior
     b. executeBuy(): compra a mercat + OCO + trailing suggestion + journal
     c. Incrementar comptador diari
     d. Espera 2s entre compres per evitar flooding de l'API
```

### 10.5 Seguretat i validació

- **Path traversal previngut:** El `simId` es valida amb `/^[a-zA-Z0-9_-]+$/` i es verifica que el path resolt és dins de `simulation/`. Un `simId` com `../../.env.local` retorna `null` immediatament.
- **Paràmetres validats:** `budgetUsdt > 0`, `maxDaily ≥ 1`, `hoursFrom/hoursTo` entre 0 i 23 (validat tant a l'API com al store).
- **Comptadors en memòria** (no persistents): Es reinicien si el servidor es reinicia. Disseny intencionat per evitar bloquejos accidentals de bots.

---

## 11. El monitor de crash BTC

### 11.1 Funcionament

El crash monitor observa el preu de BTCUSDT cada **60 segons** i manté un historial de fins a 60 minuts de punts de preu. Quan detecta una caiguda que supera un llindar configurable, activa una **cancel·lació d'emergència** de totes les ordres obertes.

### 11.2 Llindars de detecció

| Finestra | Llindar per defecte | Variable d'entorn |
|----------|--------------------|--------------------|
| 5 minuts | 5% de caiguda | `CRASH_PCT_5M` |
| 15 minuts | 8% de caiguda | `CRASH_PCT_15M` |
| 60 minuts | 12% de caiguda | `CRASH_PCT_60M` |

Les variables d'entorn es validen en l'arrencada: si no és un número finit positiu, es fa servir el valor per defecte (cap error silenciós).

### 11.3 Acció d'emergència

Quan es detecta un crash:
1. Registre a logs i notificació Telegram d'alerta
2. **Cancel·lació directa via `binance-auth`** (sense crida HTTP interna que requeriria sessió):
   - `getOpenOrders()` → llista totes les ordres obertes
   - Per a cada OCO: `cancelOcoOrder()` (una vegada per `orderListId`)
   - Per a ordres individuals: `cancelOrder()`
3. Notificació Telegram de confirmació amb nombre d'ordres cancel·lades
4. Cooldown de 30 minuts entre alertes (per evitar floods en volatilitat extrema)

**Important:** El monitor cancel·la ordres però **NO ven posicions** per defecte (massa risc en caigudes ràpides). L'usuari pot fer la venda manual amb el "botó de pànic" del dashboard.

---

## 12. Sistema de notificacions Telegram

### 12.1 Arquitectura de notificacions

El sistema usa un bot de Telegram per enviar notificacions i informes al trader. La configuració requereix:
1. Crear un bot via @BotFather a Telegram
2. Obtenir el token del bot (API_KEY)
3. Obtenir el Chat ID del canal/grup destí
4. Configurar les variables d'entorn `TELEGRAM_BOT_TOKEN` i `TELEGRAM_CHAT_ID`

### 10.2 Tipus de notificacions

#### Informe horari de P&L
Enviat cada hora en punt (00:00, 01:00, 02:00...).

Contingut:
```
📊 Informe P&L — 15:00

Portfolio total: 5,234.67 USDT
△ Última hora: +47.32 USDT (+0.91%)

Top actius:
BTC:  2,456.23 USDT (+0.54%)
ETH:   987.45 USDT (+1.23%)
SOL:   456.78 USDT (+2.11%)
USDT:  334.21 USDT

Ordres obertes: 3
```

#### Resum diari a les 7:30
Enviat cada matí a les 7:30, ideal per revisar al despertar.

Contingut:
```
🌅 Resum 24h — Diumenge 8 març 2026

Portfolio total: 5,234.67 USDT
△ Últimes 24h: +123.45 USDT (+2.41%)

Evolució per actiu:
📈 SOL:  +4.23% (+19.34 USDT)
📈 ETH:  +2.11% (+20.89 USDT)
📈 BTC:  +1.87% (+45.97 USDT)
📉 LTC:  -0.54% (-3.12 USDT)
📉 ADA:  -1.23% (-5.67 USDT)

Ordres executades avui: 2
  ✅ SOLUSDT: TP +3.45%
  ✅ ETHUSDT: TP +1.89%
```

#### Notificació d'execució d'ordre
Quan una ordre s'executa (TP o SL), el sistema ho notifica immediatament:

```
✅ Take Profit executat
SOLUSDT — 0.542 SOL
Entrada: 187.23 USDT
Sortida: 193.67 USDT
Guany: +6.44 USDT (+3.44%)
Durada: 4h 23m
```

#### Notificació d'auto-compra
Quan l'auto-buy s'activa:

```
⚡ Auto-compra executada
BTCUSDT — probabilitat 84%
Estratègia: Trend Following Alcista
Import: 50 USDT
Fill: 97,234.56 USDT/BTC
OCO: TP 99,456.78 / SL 95,678.90
```

### 10.3 La planificació de les notificacions

El sistema de notificacions usa un planificador (scheduler) que calcula exactament quan s'ha d'enviar cada notificació:

```typescript
// Notificació horària: alineada a la pròxima hora en punt
const now = new Date();
const msToNextHour = (60 - now.getMinutes()) * 60_000
                   - now.getSeconds() * 1000
                   - now.getMilliseconds();
setTimeout(() => {
  sendHourlyReport();
  setInterval(sendHourlyReport, 3_600_000); // cada 60 minuts
}, msToNextHour);

// Notificació diària: alineada a les 7:30
function msToNext730() {
  const now = new Date();
  const target = new Date();
  target.setHours(7, 30, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target.getTime() - now.getTime();
}
```

---

## 13. Gestió de logs i monitoratge en temps real

### 13.1 El sistema de logging

El sistema usa **Pino**, una de les biblioteques de logging més ràpides per a Node.js. Els logs es generen a dos destinació simultànies:

1. **Consola** (durant el desenvolupament): Format humà llegible amb colors, timestamps i format simplificat
2. **Fitxer diari**: Un fitxer per dia a la carpeta `/logs/YYYY-MM-DD.log` en format JSON, apte per a processament automàtic

Els logs en fitxer no es perden mai entre reinicis del servidor, proporcionant un historial permanent de totes les operacions.

### 13.2 Nivells de log

| Nivell | Valor | Ús |
|--------|-------|-----|
| TRACE | 10 | Molt detallat, únicament per debugging |
| DEBUG | 20 | Informació de debugging (desactivat en producció) |
| INFO | 30 | Operacions normals (ordres, notificacions, etc.) |
| WARN | 40 | Situacions inesperades però no crítiques |
| ERROR | 50 | Errors que requereixen atenció |
| FATAL | 60 | Errors que invaliden el funcionament del sistema |

### 13.3 Mòduls de log

Cada component del sistema té el seu propi "canal" de logs:

```
orders       → Execució, cancel·lació i modificació d'ordres
binance      → Comunicació amb l'API de Binance (peticions/respostes)
trailing     → Motor de trailing stop (activacions, actualitzacions)
monitor      → Monitor d'ordres (detecció d'execucions)
auto         → Motor d'auto-trading multi-bot
telegram     → Enviament de notificacions
analysis     → Anàlisi tècnica (càlculs d'indicadors)
cache        → Gestió de la caché SQLite
scheduler    → Planificador de notificacions periòdiques
```

### 13.4 SSE: events en temps real

El sistema implementa un **Server-Sent Events (SSE) stream** (`/api/stream`) que permet al navegador rebre events del servidor sense polling:

| Event | Dades | Quan |
|-------|-------|------|
| `snapshot` | Darrers 50 errors + 50 logs | En connectar |
| `log:new` | Objecte de log (JSON) | Cada log nou de nivell ≥ INFO |
| `error:new` | Objecte d'error | Cada error nou |
| `error:clear` | — | En esborrar errors |
| `order:fill` | `{ symbol, side, price, qty }` | Quan una ordre s'executa |
| `trailing:sl_moved` | `{ symbol, oldSl, newSl }` | Quan el SL es mou |
| `trailing:activated` | `{ symbol, initialSl }` | Quan el trailing s'activa |
| `heartbeat` | `{ ts }` | Cada 30s (keep-alive) |

**Límit de connexions simultànies:** màxim 10 clients SSE (`MAX_SSE_CLIENTS`). Si se supera, el servidor retorna 503 per evitar creixement il·limitat del `Set` de clients.

### 13.5 El visualitzador de logs a la interfície

El panell de logs de la interfície mostra events en temps real via SSE:
- Filtrar per nivell mínim (DEBUG+, INFO+, WARN+, ERROR+)
- Filtrar per mòdul específic
- Veure els últims registres en ordre cronològic invers (el més recent primer)
- Expandir cada entrada per veure les dades addicionals en format JSON
- Indicador de connexió SSE activa/inactiva

---

## 14. Autenticació i seguretat

### 14.1 Autenticació de la interfície web

L'aplicació usa autenticació basada en sessió amb contrasenya:

1. L'usuari accedeix a `/login` i introdueix la contrasenya
2. El servidor verifica la contrasenya contra la variable d'entorn `DASHBOARD_PASSWORD`
3. Si és correcta, crea un cookie de sessió xifrat (HTTP-only, SameSite=Strict)
4. El middleware de Next.js protegeix totes les rutes: sense cookie vàlid, redirigeix a `/login`

Les API Routes (endpoints del servidor) també estan protegides pel middleware: cap endpoint és accessible sense autenticació prèvia.

### 14.2 Autenticació amb l'API de Binance

Binance usa autenticació HMAC-SHA256 per a totes les operacions:

```typescript
function sign(params: Record<string, string | number>): string {
  const query = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)])
  ).toString();

  const sig = createHmac("sha256", process.env.BINANCE_SECRET_KEY!)
    .update(query)
    .digest("hex");

  return `${query}&signature=${sig}`;
}
```

La `BINANCE_SECRET_KEY` mai surt del servidor: el client de Binance sempre s'executa al costat del servidor, no al navegador. Això és fonamental per a la seguretat.

### 14.3 Variables d'entorn sensibles

| Variable | Funció |
|----------|--------|
| `BINANCE_API_KEY` | Clau pública d'API Binance |
| `BINANCE_SECRET_KEY` | Clau secreta HMAC Binance |
| `DASHBOARD_PASSWORD` | Contrasenya del dashboard |
| `TELEGRAM_BOT_TOKEN` | Token del bot de Telegram |
| `TELEGRAM_CHAT_ID` | ID del canal/grup de Telegram |
| `NEXT_PUBLIC_BASE_URL` | URL base de l'aplicació |

Totes aquestes variables s'han de configurar en un fitxer `.env.local` que **mai s'ha de pujar a cap repositori públic**.

### 14.4 Consideracions de seguretat addicionals

- **HTTPS obligatori en producció:** Tot el tràfic ha d'anar xifrat. En entorns locals (localhost) el HTTP és acceptable.
- **Permissions de l'API Key Binance:** Es recomana crear una API Key amb únicamente permisos de lectura de compte i trading. **Mai habilitar retirades de fons via API.**
- **Rate limiting:** El sistema respecta els límits d'API de Binance per evitar bloquejos. Les dades es cachegen per minimitzar les peticions.

### 14.5 Mesures de seguretat implementades (v2.0)

Les actualitzacions de seguretat implementades en la versió 2.0:

#### Path Traversal previngut (A5)
`loadSimConfig(simId)` valida que `simId` compleixi `/^[a-zA-Z0-9_-]+$/` i verifica que el path resultant comenci per `path.resolve(SIM_DIR)`. Un valor com `../../.env.local` és rebutjat abans d'accedir al sistema de fitxers.

#### Whitelist de claus de configuració (A6)
`POST /api/settings` accepta únicament claus definides a `SETTING_DEFAULTS`. Qualsevol altra clau retorna `400 clau no permesa`. Els errors interns retornen un missatge genèric (`Error intern`) sense exposar stack traces.

#### Cancel·lació d'emergència sense HTTP intern (A7)
El crash monitor cridia internament `POST /api/orders/cancel-all`, que requeria una sessió i fallava silenciosament en producció. Ara crida directament `getOpenOrders()`, `cancelOcoOrder()` i `cancelOrder()` de `binance-auth.ts`, eliminant la dependència de la sessió.

#### Codis d'error HTTP correctes (A8)
`GET /api/klines` retornava `HTTP 200` amb un array buit quan Binance fallava, enganyant els clients. Ara retorna `HTTP 502` amb `{ error: "Binance HTTP ..." }`, permetent als clients distingir "sense dades" de "error upstream".

#### Validació de símbols (C7)
Els endpoints `GET /api/klines` i `GET /api/exchange-info` validen que el symbol compleixi `/^[A-Z0-9]{3,20}$/` abans de fer cap crida a Binance.

#### Timeouts en totes les crides externes (B7)
Tots els `fetch` a Binance inclouen `signal: AbortSignal.timeout(10_000)`. Cap crida pot bloquejar un motor background indefinidament.

#### Errors de notificació visibles (B6)
Tots els `.catch(() => {})` silenciats als motors i components s'han substituït per `.catch(err => log.X.warn(...))` o `console.warn(...)`. Els errors de Telegram o Binance ara apareixen als logs.

#### Variables d'entorn amb valors invàlids (C5)
Les variables `CRASH_PCT_*` es validen en l'arrencada del crash monitor. Si el valor no és un número finit positiu, s'usa el valor per defecte i es continua operant.

---

## 15. Persistència de dades

### 15.1 Per què SQLite i no PostgreSQL o MongoDB?

Per a un sistema d'ús personal o semi-professional, SQLite presenta avantatges clars sobre bases de dades client-servidor:

**Simplicitat:** No requereix instal·lar ni configurar un servidor de base de dades separat. La base de dades és un sol fitxer (`cache.db`) que es pot copiar, fer backup i transferir fàcilment.

**Rendiment suficient:** Per a la càrrega d'aquest sistema (desenes de consultes per minut, no milers), SQLite és perfectament adequat. Els benchmarks demostren que SQLite supera PostgreSQL en lectures simples per a bases de dades petites (< 1 GB).

**Integración amb better-sqlite3:** La biblioteca `better-sqlite3` usa l'API síncrona de SQLite, eliminant la complexitat de les promeses i el manatge d'errors asíncrons en consultes de base de dades.

### 15.2 Estratègia de caché i TTL

Cada entrada de la caché té un temps de vida (TTL — Time To Live) adequat al tipus de dada:

| Tipus de dada | TTL | Motiu |
|---------------|-----|-------|
| Preu ticker actual | 30 segons | Necessita ser fresc per a decisions |
| Veles (candles) 1m | 30 segons | Molt volàtil |
| Veles 1h | 5 minuts | Canvien menys sovint |
| Veles 4h | 10 minuts | Canvien molt menys |
| Info d'exchange (tickSize) | 24 hores | Quasi estàtic |
| Anàlisi tècnica | 2-5 minuts | Balanceja frescor vs càrrega |

### 15.3 Taules principals de la BD

A banda de la caché genèrica, la base de dades conté:

| Taula | Contingut |
|-------|-----------|
| `cache` | Clau-valor amb TTL (tickers, klines, exchange-info) |
| `trailing_suggestions` | Trailing stops pendents d'activació (lligats a OCO) |
| `trailing_active` | Trailing stops actius amb SL actual i pic de preu |
| `order_meta` | Metadades per ordre: codi de trade, interval, notes de sortida |
| `journal` | Registre intern de totes les operacions (ENTRY/EXIT/TRAIL) |
| `portfolio_snapshots` | Valor del portfolio cada 15 minuts (per a la gràfica d'evolució) |
| `settings` | Configuració de l'aplicació (clau-valor) |
| `bots` | Configuració de bots d'auto-trading |

### 15.4 Backup de dades

Es recomana fer backup diari del fitxer `data/cache.db`. Atès que conté trailing stops actius i configuració d'estratègies, perdre'l implicaria perdre la traçabilitat de posicions obertes.

Un script de backup simple:
```bash
cp data/cache.db backups/cache-$(date +%Y%m%d).db
# Mantenir els últims 30 dies
find backups/ -name "cache-*.db" -mtime +30 -delete
```

---

## 16. El portfolio i la gestió del capital

### 16.1 La vista de portfolio

El portfolio és la vista que mostra l'estat actual de tots els actius del compte. Inclou:

**Ticker superior (`TopbarTicker`):** Barra animada amb BTC actual, volum 24h, major guanyador, major perdedor i P&L per períodes (24h / 7d / 1m / 1a).

**Gràfic de pastís:** Distribució visual del capital per actiu amb colors de marca oficials. Al costat, la divisió crypto vs estables.

**Gràfica d'evolució:** Corba de valor del portfolio al llarg del temps (dades dels snapshots de 15 minuts). Permet visualitzar el creixement o la davallada en qualsevol subperíode.

**Taula de posicions:** Per a cada actiu amb saldo:
- Preu actual de mercat i canvi 24h
- Quantitat total (lliure + en ordres)
- Valor en USDT
- Cost mitjà (FIFO) i P&L no realitzat
- Botó de venda directa amb confirmació
- Per a actius bloquejats en OCO: botó de cancel·lar OCO + vendre

**Cost basis (FIFO):** Per a cada actiu, el sistema calcula el cost mitjà ponderat de les compres històriques via `GET /api/cost-basis`. Permet veure el P&L no realitzat de cada posició.

**Guanys realitzats:** Panel amb P&L realitzat per períodes (24h / 7d / 30d / tot), obtingut de `GET /api/pnl`.

**Valor total:** Suma de tots els actius convertits a USDT al preu de mercat actual, amb el P&L total del dia.

### 16.2 Snapshots per al càlcul de P&L

Per poder calcular el P&L (guany o pèrdua) de les últimes hora i 24 hores, el sistema desa periòdicament un "snapshot" del portfolio: el valor total de cada actiu i el valor total del portfolio en un moment concret.

Quan cal calcular el P&L:
1. Es busca el snapshot de fa exactament (o aproximadament) 1 hora / 24 hores
2. Es compara el valor actual amb el valor al snapshot
3. La diferència és el P&L del període

### 16.3 La relació entre portfolio i ordres obertes

Els actius bloquejats en ordres obertes apareixen en el balance (com "Locked") i per tant al portfolio. Tanmateix, és important distingir:

- **Capital actiu en posicions:** Ha estat invertit i pot guanyar o perdre en funció del mercat
- **Capital lliure (USDT):** Disponible per a noves operacions

Un bon trader manté sempre un percentatge de capital lliure per aprofitar oportunitats imprevistes i per no estar sobreexposat.

---

## 17. Estratègies de trading implementades

### 15.1 Resum de les estratègies predefinides

A part de les estratègies d'anàlisi tècnica automàtica, el sistema permet etiquetar cada ordre oberta amb una "estratègia" personalitzada. Això facilita el seguiment del rendiment per estratègia en el historial.

Les etiquetes predefinides:

| Etiqueta | Color | Descripció |
|----------|-------|-----------|
| Scalp | Taronja | Operació ràpida (minuts a hores) |
| Swing | Blau | Operació de 1-7 dies |
| Posicional | Verd | Posició de setmanes a mesos |
| DCA | Lila | Dollar-Cost Averaging (compres periòdiques) |
| Breakout | Groc | Ruptura de resistència |

### 15.2 Recomanacions operatives per a cada estratègia

#### Scalp (intradiaria)
- **Temporalitat d'anàlisi:** 5m, màxim 15m
- **Ràtio TP/SL recomanat:** 1.5:1 mínim (ex: TP 1.5%, SL 1%)
- **Durada màxima:** 4 hores. Si no es mou, sortir
- **Sessions recomanades:** Alta volatilitat (obertura europea 8-10h, obertura americana 14:30-16:30)
- **Risc màxim per operació:** 0.5% del capital total

#### Swing
- **Temporalitat d'anàlisi:** 1h confirmat amb 4h
- **Ràtio TP/SL recomanat:** 2:1 mínim (ex: TP 4%, SL 2%)
- **Durada màxima:** 7 dies. Revisar tesi diàriament
- **Risc màxim per operació:** 1-2% del capital total

#### Posicional
- **Temporalitat d'anàlisi:** 4h confirmat amb 1D
- **TP/SL:** Flexible. Usar trailing stop agressiu
- **Durada:** Sense límit mentre la tendència segueixi
- **Risc màxim per operació:** 2-3% del capital total

#### DCA (Dollar-Cost Averaging)
No és un trade actiu sinó una estratègia d'acumulació: es compra una quantitat fixa cada setmana/mes independentment del preu. Redueix el risc de timing però tampoc maximitza el rendiment.

**Implementació al sistema:** Crear una ordre de compra límit a preus lleugerament per sota del mercat (ex: -1% a -3%) i reposar-la cada cop que s'executa.

#### Breakout
- **Prerequisit:** Identificar un nivell de resistència clar (màxim anterior significatiu)
- **Entrada:** Quan el preu supera la resistència amb volum elevat (>1.5× la mitjana)
- **TP:** 2-3× l'amplada del rang previ al breakout
- **SL:** Per sota del nivell roto (ara suport)
- **Temporalitat:** 1h com a mínim

### 15.3 Gestió activa de les posicions

#### Millora de l'entrada (averaging down)
Quan una posició va en contra però la tesi segueix sent vàlida, alguns traders afegeixen a la posició per reduir el preu mig d'entrada. **Risc elevat.** Recomanem NO fer averaging down com a norma general: si la tesi és errònia, en realitat s'amplifica la pèrdua.

#### Move to breakeven
Quan la posició guanya un cert percentatge (ex: +1.5%), moure el SL al preu d'entrada. D'aquesta manera, en el pitjor cas, es surt sense pèrdua.

Implementació al sistema: Editar l'OCO des de la interfície i ajustar el SL al preu d'entrada.

#### Take partial profits
Quan es guanya un objectiu intermedi, tancar una part de la posició (ex: 50%) per assegurar guanys, i deixar la resta córrer amb el SL a breakeven.

Implementació: Cancel·lar l'OCO, executar una venda parcial de mercat, i crear una nova OCO per la quantitat restant.

---

## 18. Gestió del risc

### 16.1 Per què la gestió del risc és l'element més important

El trading és un joc de probabilitats, no de certeses. Fins i tot les millors estratègies fallen el 30-40% de les vegades. La clau per ser rendible a llarg termini és que les operacions guanyadores siguin significativament majors que les perdedores.

**Regla d'or:** Una estratègia amb 55% de taxa d'encert i ràtio profit/loss de 2:1 és molt més rentable que una amb 70% d'encert i ràtio 1:1.

Exemple numèric (10 operacions, risc 1% per operació, capital 10.000 USDT):

| Escenari | Wins (55% de 10) | Losses (45%) | Resultat |
|----------|-----------------|--------------|----------|
| 55% TP, ratio 2:1 | 5.5 × 2% = +11% | 4.5 × 1% = -4.5% | **+6.5% net** |
| 70% TP, ratio 1:1 | 7 × 1% = +7% | 3 × 1% = -3% | **+4% net** |

### 16.2 Regles de gestió del risc

#### La regla del 1-2%
Mai arriscar més del 1-2% del capital total en una sola operació. Si el capital és 10.000 USDT, el risc màxim per operació és 100-200 USDT.

Càlcul de la mida de posició:
```
Mida posició (USDT) = Capital total × Risc% / Distància al SL%
```

Exemple:
- Capital: 10.000 USDT
- Risc: 1% = 100 USDT
- SL al 2% per sota de l'entrada
- Mida posició = 100 / 0.02 = 5.000 USDT (50% del capital en una sola operació)

**Atenció:** Si la mida calculada supera el 20-30% del capital, reduir el percentatge de risc.

#### La regla del drawdown màxim
Si el portfolio perd un 10% en un mes, parar d'operar i revisar l'estratègia. Si perd un 20% en total, parar fins que s'entengui el que ha anat malament.

#### La diversificació
No concentrar tot el capital en un sol actiu ni en un sol trade. Mantenir com a mínim 30-40% en USDT per a oportunitats futures i com a coixí de seguretat.

#### La regla de la correlació
BTC, ETH, SOL i la majoria d'altcoins estan altament correlacionats: quan BTC cau bruscament, quasi tot el mercat cau. Tenir quatre posicions obertes en quatre altcoins durant un crash de BTC equival a tenir una sola posició molt gran.

En períodes d'incertesa macro o caiguda de BTC, reduir exposició general.

### 16.3 El rol del Stop Loss automàtic

El sistema força l'ús de Stop Loss en totes les posicions via les OCO. No és possible tenir una posició oberta sense SL configurat.

Avantatges:
1. **Execució emocional:** El SL s'executa automàticament sense intervenció humana, eliminant la temptació de "deixar-lo córrer una mica més"
2. **Disponibilitat 24/7:** El mercat opera 24 hores. Un SL automàtic protegeix durant les hores de son
3. **Consistència:** El pla de gestió del risc s'executa sempre, fins i tot quan l'usuari no pot monitorar el mercat

### 16.4 Psicologia del trading

Fins i tot amb un sistema ben configurat, la psicologia és un factor crític. Els errors psicològics més comuns:

**FOMO (Fear Of Missing Out):** Entrar en una posició perquè el preu ja ha pujat molt i no es vol perdre el moviment. Solució: el sistema de puntuació t'ajuda a objectivar si l'oportunitat és real o si s'ha perdut.

**Revenge trading:** Intentar recuperar pèrdues fent operacions ràpides i arriscades. Solució: regla del drawdown màxim. Si has perdut el 5% en un dia, para.

**Sobretrading:** Obrir masses posicions simultànies per "estar actiu". Solució: qualitat sobre quantitat. 2-3 posicions ben gestionades superen 10 posicions mal analitzades.

**Mover el Stop Loss:** Quan el preu s'apropa al SL, moure'l cap avall per "donar-li espai". Solució: si has d'ajustar el SL és perquè la mida de la posició era massa gran. Reduir la mida, no moure el SL.

---

## 19. Historial i anàlisi de rendiment

### 17.1 Estructura del historial

El sistema desa totes les ordres executades i cancel·lades, consultant-les directament de l'API de Binance. Cada operació completada mostra:

- **Data i hora** d'entrada i sortida
- **Preu d'entrada** (avg fill de la compra de mercat)
- **Preu de sortida** (avg fill del TP o SL)
- **P&L absolut** (en USDT)
- **P&L percentual**
- **Durada** de la posició
- **Comissions** totals pagades
- **Estratègia** etiquetada

Per a les OCO que deriven en trailing stop, la card mostra la cadena completa: compra → OCO activa → trailing activat → sortida final.

### 17.2 Mètriques de rendiment clau

#### Win Rate (taxa d'encert)
Percentatge d'operacions guanyadores sobre el total de closes. Mostrat a la barra de resum del historial.

**Interpretació:**
- < 40%: L'estratègia té problemes o el ràtio TP/SL és insuficient
- 40-55%: Acceptable si el ràtio profit/loss és > 1.5:1
- 55-65%: Bo
- > 65%: Excel·lent (però sospitós si és massa alt — pot ser overfitting)

#### Profit Factor
Suma de tots els guanys dividit per la suma de totes les pèrdues. Un profit factor > 1.5 indica un sistema rentable.

#### Maximum Drawdown
La màxima caiguda des d'un màxim fins al mínim subsequiente. Un drawdown > 20% és senyal d'alerta.

#### Sharpe Ratio
Rendiment ajustat per risc. Difícil de calcular directament, però com a aproximació: si el rendiment mensual supera la volatilitat mensual, el Sharpe és > 1 (bo).

### 17.3 Anàlisi per temporalitat

El sistema etiqueta cada ordre amb la temporalitat de l'anàlisi que va generar la senyal. Esto permet analitzar quin timeframe genera millors resultats:

En general, les temporalitats majors (4h, 1D) generen menys senyals però de més qualitat. Les temporalitats menors (5m, 15m) generen molts senyals però amb major percentatge de falsos positius.

---

## 20. Flux de treball diari

### 18.1 La rutina del trader

Per aprofitar al màxim el sistema, recomanem la següent rutina diària:

**7:30 – Al despertar (5-10 minuts)**
- Llegir el resum diari de Telegram
- Revisar si s'han executat ordres durant la nit
- Comprovar l'estat general del mercat (BTC com a indicador)

**09:00 – Sessió matinal (15-30 minuts)**
- Obrir el dashboard
- Revisar les posicions obertes: estan dins dels paràmetres esperats?
- Si alguna posició ha tocat el SL durant la nit, avaluar si reobrir
- Llançar l'escàner i revisar les Top Oportunitats

**12:00 – Revisió intermèdia (5-10 minuts)**
- Comprovar si les posicions s'han mogut significativament
- Revisar les notificacions Telegram de les últimes hores
- Si hi ha oportunitats noves a l'escàner amb alta probabilitat, avaluar entrada

**16:00 – Sessió tarde / obertura americana (15-30 minuts)**
- L'obertura dels mercats americans (14:30-15:30 hora europea) genera molta volatilitat
- Bon moment per recalibrar posicions: moure SL a breakeven si ja esteu en guanys
- Revisar l'escàner de nou

**21:00 – Tancament del dia (10-15 minuts)**
- Revisar el P&L del dia (informe Telegram de les 21:00)
- Assegurar-se que totes les posicions obertes tenen SL adequats per a la nit
- No obrir noves posicions grans a última hora si no es pot monitorar

**Temps total:** 50-85 minuts/dia

### 18.2 Comportament en situacions especials

**Crash de mercat repentí (-10% o més en 1h)**
1. No entrar en pànic
2. Verificar si les posicions obertes han tocat el SL (haurien d'haver-se executat automàticament)
3. No "comprar la caiguda" immediatament — esperar confirmació de sòl (mínim 1-2 hores)
4. Si el mercat és molt dolent, desactivar l'auto-compra

**Anunci macroeconòmic important (inflació EUA, decisió Fed, etc.)**
1. El mercat sol moure's bruscament en les 30-60 minuts posteriors
2. Evitar obrir posicions noves
3. Revisa els stops actuals i considera reduir-los

**Bug o problema tècnic del sistema**
1. Verificar primer a l'app de Binance (no al dashboard) que les ordres estan en ordre
2. Revisar els logs del servidor per entendre el problema
3. No operar fins que el sistema estigui estable

---

## 21. Integració amb Binance

### 19.1 L'API de Binance

Binance proporciona una de les APIs de trading més completes del sector. El sistema usa exclusivament els endpoints REST (no WebSocket) per simplicitat i fiabilitat.

**Endpoints principals usats:**

| Endpoint | Funció |
|----------|--------|
| `GET /api/v3/ticker/price` | Preu actual d'un symbol |
| `GET /api/v3/account` | Informació del compte (balanços) |
| `GET /api/v3/openOrders` | Ordres obertes |
| `GET /api/v3/allOrders` | Historial d'ordres |
| `GET /api/v3/myTrades` | Historial de trades executats |
| `GET /api/v3/klines` | Dades de veles (OHLC) |
| `GET /api/v3/exchangeInfo` | Informació de parells (tickSize, etc.) |
| `POST /api/v3/order` | Crear ordre (market, limit, stop) |
| `POST /api/v3/orderList/oco` | Crear ordre OCO |
| `DELETE /api/v3/orderList` | Cancel·lar OCO |
| `DELETE /api/v3/order` | Cancel·lar ordre individual |

### 19.2 Rate limits de l'API

Binance imposa límits de peticions per evitar l'abús:

- **Peticions per segon:** Límit de "weight" (pes) de 1.200 per minut. Cada endpoint té un pes diferent (usualment 1-10).
- **Ordres per segon:** Màxim 10 ordres per segon, 100.000 ordres per 24 hores.

El sistema respecta aquests límits cachejant les dades i no fent peticions innecessàries.

### 19.3 Testnet vs Producció

El sistema opera per defecte en la **testnet de Binance** (demo): `https://demo-api.binance.com`. La testnet és idèntica en funcionament a la producció però usa diners virtuals.

Per migrar a producció:
1. Canviar la URL base de `demo-api.binance.com` a `api.binance.com`
2. Configurar les API Keys de producció (compte real)
3. Verificar en un primer moment amb imports molt petits (5-10 USDT)

**Recomanació:** Operar almenys 3 mesos en testnet abans de migrar a producció. No és urgent posar capital real en risc.

---

## 22. Línies futures de desenvolupament

### 22.1 Millores a curt termini (1-3 mesos)

> **Nota:** Les funcionalitats de backtesting/simulació integrada, historial de P&L amb gràfica, diario de trading (JournalTab) i auto-trading multi-bot han estat **implementades a la v2.0**. Les línies pendents s'actualitzen a continuació.

#### 22.1.1 Alertes de preu personalitzades
Permetre a l'usuari configurar alertes de tipus:
- "Notifica'm quan BTC superi 100.000 USDT"
- "Notifica'm quan SOL baixi de 150 USDT"
- "Notifica'm quan l'RSI de ETH/1h sigui < 35"

Implementació: Un mòdul de gestió d'alertes amb emmagatzematge SQLite i verificació integrada al monitor d'ordres.

#### 22.1.2 Calculadora de mida de posició
Una eina integrada que donats el capital total, el percentatge de risc desitjat i la distància al SL, calculi automàticament l'import òptim a invertir. Evita errors de càlcul manual i assegura una gestió del risc consistent.

#### 22.1.3 Telegram bidireccional (comandes)
Permetre enviar comandes al bot de Telegram (`/status`, `/orders`, `/buy SYMBOL 100`) amb confirmació interactiva. **Consideració de seguretat:** Verificar que les comandes vinguin del Chat ID autoritzat.

### 22.2 Millores a mitjà termini (3-9 mesos)

#### 22.2.1 Suport multi-exchange
Ampliar el suport a altres exchanges: Kraken, Coinbase Pro, Bybit. Cada exchange té la seva pròpia API amb particularitats. L'arquitectura actual del sistema (amb el client de Binance com a mòdul separat) facilita aquesta extensió.

**Benefici:** Diversificació del risc operacional (si Binance té problemes tècnics) i accés a parells que Binance no ofereix.

#### 22.2.2 Paper trading en temps real
Mode de simulació en temps real: el sistema "executa" ordres simulades als preus reals de mercat sense diners reals. Permet provar noves configuracions sense risc.

Diferent del backtesting: el paper trading opera en temps real, exposant l'estratègia a les condicions actuals del mercat (liquiditat, spreads, latència).

#### 22.2.3 Millores a l'anàlisi tècnica
- **Reconeixement de patrons de candlestick:** Martell, Doji, Engulfing, Morning Star, etc.
- **Nivells de suport i resistència automàtics:** Detectar els màxims i mínims significatius de les últimes N veles
- **Fibonacci retracements:** Calcular automàticament els nivells de retrocés de Fibonacci per a cada moviment important
- **VWAP (Volume Weighted Average Price):** Un indicador molt usat per traders institucionals

#### 22.2.4 Integració amb dades on-chain
Per a les majors criptomonedes (BTC, ETH), les dades on-chain (moviments de grans wallets, flows d'exchanges, mètriques de xarxa) poden proporcionar senyals complementaris a l'anàlisi tècnica.

APIs públiques: Glassnode (de pagament), The Graph (gratuït per a alguns tokens), Etherscan.

### 22.3 Millores a llarg termini (9-24 mesos)

#### 22.3.1 Machine Learning per a la classificació de senyals
Usar un model de classificació (Random Forest, Gradient Boosting, o una xarxa neuronal lleugera) entrenat sobre dades històriques per predir la probabilitat d'èxit de cada senyal de trading.

L'input del model podria ser:
- Valors dels indicadors tècnics en el moment de la senyal
- Temporalitat
- Hora del dia / dia de la setmana
- Fase del mercat (bull market, bear market, sideways)

El model complementaria l'anàlisi basada en regles actuals, potencialment millorant la taxa d'encert un 5-10%.

#### 22.3.2 Gestió del capital dinàmica (Kelly Criterion)
El Criteri de Kelly és una fórmula matemàtica que calcula la mida òptima de cada aposta per maximitzar el creixement exponencial del capital:

```
f* = (bp - q) / b
```

On:
- `f*` = fracció del capital a arriscar
- `b` = ràtio guany/pèrdua de l'estratègia
- `p` = probabilitat d'èxit
- `q` = 1 - p

En la pràctica s'usa la "fracció de Kelly" (half-Kelly o quarter-Kelly) per reduir la volatilitat del compte.

#### 22.3.3 Estratègies de cobertura (hedging)
Per a traders que mantenen posicions llargues en criptomonedes (HODLers), el sistema podria suggerir estratègies de cobertura:
- Obrir posicions curtes (SELL) en futurs per protegir la posició llarga spot
- Comprar opcions PUT per assegurar un preu mínim de venda

**Nota:** Binance Futures és un producte diferent i requereix implementació separada.

#### 22.3.4 Interfície mòbil nativa
Una aplicació mòbil (React Native o similar) que ofereixi les funcionalitats essencials:
- Visualització de posicions
- Aprovació/rebuig de senyals auto-buy
- Notificació push (addicional al Telegram)
- Cancel·lació d'emergència d'ordres

#### 22.3.5 Mode multi-compte
Suport per gestionar diversos comptes de Binance (per exemple, comptes familiars o de diversos inversors) des d'un sol dashboard, amb vista agregada del portfolio total.

---

## 23. Previsió de guanys i anàlisi econòmica

### 21.1 Metodologia de la previsió

Aquesta secció presenta projeccions financeres basades en:
1. Rendiments típics de l'anàlisi tècnica en mercats de criptomonedes documentats per traders retails
2. Backtesting teòric de les estratègies implementades
3. Ajustos per comissions, slippage i errors d'execució

**Advertència important:** Les projeccions financeres en criptomonedes estan subjectes a un alt grau d'incertesa. Els resultats passats no garanteixen resultats futurs. Les xifres presentades representen escenaris possibles basats en supòsits raonables, no promeses de rendiment.

### 21.2 Supòsits base

Per a les projeccions, usem els següents supòsits:

| Paràmetre | Valor base | Rang |
|-----------|-----------|------|
| Capital inicial | 5.000 USDT | 1.000 - 50.000 |
| Comissions Binance (Maker) | 0.10% per operació | 0.05-0.10% |
| Nombre d'operacions/mes | 15-20 | 8-30 |
| Import mig per operació | 300 USDT | 100-1.000 |
| Win rate | 55% | 45-65% |
| TP mig (quan guanya) | +2.5% | 1.5-4% |
| SL mig (quan perd) | -1.5% | 1-2.5% |
| Mercat | Mercat lateral a alcista | — |

### 21.3 Escenari conservador

**Condicions:** Mercat lateral, 8-10 operacions/mes, win rate 50%, TP 2% / SL 1.5%

**Per operació:**
- 50% guanyadores: +2% net de comissions ≈ +1.8% net
- 50% perdedores: -1.5% + comissions ≈ -1.7%
- Expectativa per operació: (0.5 × 1.8%) + (0.5 × -1.7%) = **+0.05%**

**Per mes (10 operacions):** +0.5%
**Per any:** +6.17% (compost)

Amb 5.000 USDT inicials: **+308 USDT el primer any**

### 21.4 Escenari base (el més probable)

**Condicions:** Mercat lateral a lleugerament alcista, 15 operacions/mes, win rate 55%, TP 2.5% / SL 1.5%

**Per operació:**
- 55% guanyadores: +2.3% net
- 45% perdedores: -1.7% net
- Expectativa: (0.55 × 2.3%) + (0.45 × -1.7%) = **+0.51%**

**Per mes (15 operacions):** +7.65%
**Per any (compost):** +142%

Nota: Aquesta xifra és la projeccció teòrica. En pràctica, no tots els mesos seran igual de bons. Una estimació més conservadora per a l'escenari base seria **+30-50% anual**.

| Any | Capital inicial | Rendiment anual | Capital final |
|-----|----------------|-----------------|---------------|
| 1   | 5.000 USDT     | +35%            | 6.750 USDT    |
| 2   | 6.750 USDT     | +35%            | 9.113 USDT    |
| 3   | 9.113 USDT     | +35%            | 12.302 USDT   |
| 4   | 12.302 USDT    | +35%            | 16.608 USDT   |
| 5   | 16.608 USDT    | +35%            | 22.421 USDT   |

Amb 5.000 USDT inicials i reinversió constant dels guanys: **22.421 USDT als 5 anys (+348%).**

### 21.5 Escenari optimista

**Condicions:** Bull market, 20-25 operacions/mes, win rate 60%, TP 3.5% / SL 1.5%, trailing stop actiu en posicions guanyadores

**Per operació:**
- 60% guanyadores: TP +3.5% net + trailing booster ≈ +4% net
- 40% perdedores: SL -1.5% + comissions ≈ -1.7%
- Expectativa: (0.60 × 4%) + (0.40 × -1.7%) = **+1.72%**

**Per mes (22 operacions):** +37.8%
**Per any (compost):** +5.800% teòric

En pràctica, ajustat per la impossibilitat de mantenir aquest ritme de manera consistent: **+80-150% en un bon any de bull market.**

| Any | Capital inicial | Rendiment anual | Capital final |
|-----|----------------|-----------------|---------------|
| 1   | 5.000 USDT     | +100%           | 10.000 USDT   |
| 2   | 10.000 USDT    | +80%            | 18.000 USDT   |
| 3   | 18.000 USDT    | +60%            | 28.800 USDT   |

### 21.6 Escenari pessimista

**Condicions:** Bear market prolongat, errors d'execució freqüents, mercat en caiguda lliure

**Per operació:**
- 40% guanyadores: +2% net
- 60% perdedores: -2% + comissions ≈ -2.2%
- Expectativa: (0.40 × 2%) + (0.60 × -2.2%) = **-0.52%**

**Per mes (10 operacions):** -5.2%
**Per any:** -47%

Amb 5.000 USDT inicials: **2.650 USDT al final de l'any** (-2.350 USDT de pèrdua)

**Mesures per evitar aquest escenari:**
1. Aturar el trading actiu quan BTC perd > 20% en 30 dies
2. No fer trading durant bears markets prolongs
3. La regla del drawdown màxim: parar si el capital cau > 15%

### 21.7 L'impacte de les comissions

Les comissions de Binance poden semblar petites (0.10% per operació) però s'acumulen significativament:

Per a 20 operacions/mes, cada operació té dos llegs (compra + venda):
- 20 compres × 0.10% = 2% del capital operat/mes en comissions d'entrada
- 20 vendes × 0.10% = 2% del capital operat/mes en comissions de sortida
- **Total: 4% del capital operat/mes en comissions**

Si el capital operat cada mes és 6.000 USDT (ex: 20 operacions × 300 USDT):
- Comissions mensuals: 6.000 × 4% = **240 USDT/mes = 2.880 USDT/any**

Formes de reduir les comissions:
1. **Usar BNB per pagar comissions:** Binance ofereix un 25% de descompte si les comissions es paguen en BNB
2. **Tiered fee structure:** A partir d'un cert volum mensual (> 500.000 USDT/mes), les comissions baixen al 0.08%, 0.06%, etc.
3. **Usar ordres Maker:** Les ordres Limit (que no s'executen immediatament) paguen la comissió "maker" (0.10%), mentre que les ordres Market (immediates) paguen la "taker" (0.10% o superior)

### 21.8 Comparativa amb altres alternatives d'inversió

| Instrument | Rendiment anual esperat | Risc | Liquiditat |
|-----------|------------------------|------|-----------|
| Compte d'estalvi (EUR) | 1-3% | Molt baix | Molt alta |
| Bons del govern | 3-4% | Baix | Alta |
| ETF d'accions diversificat | 8-12% | Moderat | Alta |
| Bitcoin (HODLing) | 50-150% en bull / -50-80% en bear | Molt alt | Alta |
| **Aquest sistema (base)** | **30-50% anual** | **Moderat-alt** | **Alta** |
| Fons de capital risc (VC) | 15-25% anual | Alt | Molt baixa |
| Inversió en immobles | 6-10% net | Moderat | Molt baixa |

### 21.9 L'efecte del reinvestiment (interès compost)

Una de les característiques més poderoses del sistema és la capacitat de reinvertir els guanys immediatament:

**Sense reinvestiment (retira guanys cada mes):**
- Capital: 5.000 USDT constant
- Guany mensual: 2% = 100 USDT/mes
- Guany anual: 1.200 USDT
- 5 anys: 6.000 USDT de guanys totals

**Amb reinvestiment (interès compost):**
- Any 1: 5.000 → 6.000 USDT (+24%)
- Any 3: 9.200 USDT
- Any 5: 14.200 USDT
- Guanys a 5 anys: 9.200 USDT (53% més que sense reinvestiment)

**La clau:** Mantenir els guanys al compte i augmentar gradual·ment la mida de les posicions a mesura que el capital creix.

### 21.10 Gestió fiscal dels guanys

A Espanya i Catalunya, els guanys derivats del trading de criptomonedes tributen com a guanys patrimonials a l'IRPF:

| Guany anual | Tipus impositiu (2026) |
|-------------|----------------------|
| Fins a 6.000 € | 19% |
| 6.001 - 50.000 € | 21% |
| Més de 50.000 € | 23-28% |

Exemple: 10.000 € de guanys → ~2.100 € d'impostos → 7.900 € nets.

Recomanem consultar un assessor fiscal especialitzat en criptomonedes. Les normatives canvien freqüentment i la correcta declaració és obligatòria.

---

## 24. Apèndix tècnic

### 24.1 Requisits del sistema

**Mínims:**
- Node.js 18 o superior
- 2 GB de RAM
- 10 GB d'espai en disc (per a logs i base de dades)
- Connexió a Internet estable

**Recomanats:**
- Node.js 20 LTS
- 4 GB de RAM
- 50 GB d'espai en disc (per a logs de 1+ any)
- Connexió a Internet de menys de 50ms de latència a Binance

**Sistema operatiu:** Windows 10/11, macOS 12+, o Linux (Ubuntu 22.04 recomanat per a producció)

### 24.2 Variables d'entorn necessàries

```bash
# Fitxer .env.local

# Binance API
BINANCE_API_KEY=la_teva_api_key
BINANCE_SECRET_KEY=la_teva_secret_key

# Dashboard
DASHBOARD_PASSWORD=contrasenya_segura_aqui

# Telegram (opcional però recomanat)
TELEGRAM_BOT_TOKEN=123456789:AABBccdd...
TELEGRAM_CHAT_ID=-100123456789

# URL base (per a l'API interna — usada per notificacions i crash monitor)
NEXT_PUBLIC_BASE_URL=http://localhost:3000

# Crash monitor — llindars de caiguda de BTC (opcional, valors per defecte: 5, 8, 12)
CRASH_PCT_5M=5
CRASH_PCT_15M=8
CRASH_PCT_60M=12
```

### 24.3 Instal·lació i execució

```bash
# Clonar el repositori
git clone [url-del-repositori]
cd crypto_dashboard

# Instal·lar dependències
npm install

# Configurar variables d'entorn
cp .env.example .env.local
# Editar .env.local amb les teves credencials

# Mode desenvolupament
npm run dev

# Mode producció
npm run build
npm run start
```

### 22.4 Desplegar en un servidor dedicat

Per a operació 24/7 amb màxima fiabilitat, recomanem desplegar en un VPS (Virtual Private Server):

**Proveidors recomanats:**
- **Hetzner:** Excel·lent relació qualitat-preu. Servidors a Frankfurt (baixa latència a Binance)
- **DigitalOcean:** Fàcil de gestionar, bona documentació
- **Vultr:** Bon rendiment per a aplicacions Node.js

**Configuració bàsica en Ubuntu 22.04:**

```bash
# Instal·lar Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Instal·lar PM2 (gestor de processos)
npm install -g pm2

# Executar l'aplicació amb PM2
pm2 start npm --name "crypto-dashboard" -- start
pm2 startup
pm2 save

# Configurar Nginx com a proxy invers (HTTPS)
sudo apt-get install -y nginx certbot python3-certbot-nginx
# Configurar el teu domini i certificat SSL
```

### 22.5 Configuració de l'API Key de Binance

**Pas a pas per crear una API Key segura:**

1. Accedir a Binance → Account → API Management
2. Crear nova API Key → "System generated"
3. **Activar:** Enable Reading, Enable Spot & Margin Trading
4. **NO activar:** Enable Withdrawals, Enable Futures (no necessari)
5. Restringir per IP: afegir la IP del teu servidor (recomanat fortament)
6. Guardar la API Key i Secret Key de manera segura (no als fitxers del projecte)

### 22.6 Format dels fitxers de log

Cada línia del fitxer de log és un objecte JSON independent (format NDJSON):

```json
{"level":30,"time":1741420234567,"module":"orders","msg":"OCO col·locada","symbol":"SOLUSDT","side":"SELL","tpPrice":"193.67","slStopPrice":"181.23","orderListId":12345}
{"level":30,"time":1741420298123,"module":"trailing","msg":"Trailing stop activat","symbol":"SOLUSDT","slOrderId":67890,"currentSl":"183.45","peakPrice":"195.12"}
{"level":50,"time":1741420398456,"module":"binance","msg":"Error API Binance","code":-1013,"error":"The relationship of the prices for the orders is not correct"}
```

Per llegir els logs de manera llegible:
```bash
cat logs/2026-03-08.log | npx pino-pretty
```

---

## 23. Glossari

**ATR (Average True Range):** Indicador de volatilitat que mesura l'amplitud mitjana de les veles en N períodes.

**Bear market:** Mercat en tendència bajista sostenuda (caiguda > 20% des del màxim).

**Breakout:** Ruptura d'un nivell de suport o resistència significatiu.

**Bull market:** Mercat en tendència alcista sostenuda (pujada > 20% des del mínim).

**Candlestick (vela):** Representació gràfica del preu en un període. Mostra l'obertura, tancament, màxim i mínim del període.

**Comissió Maker:** Comissió pagada quan una ordre no s'executa immediatament sinó que "fa mercat" (queda pendent a l'order book).

**Comissió Taker:** Comissió pagada quan una ordre s'executa immediatament "prenent" liquiditat de l'order book.

**Drawdown:** Reducció de capital des d'un màxim fins al mínim subsegüent.

**EMA (Exponential Moving Average):** Mitjana mòbil que dona més pes als preus recents.

**Fill / Fill Price:** Preu al qual una ordre ha estat realment executada.

**HODLing:** Estratègia d'inversió passiva: comprar i mantenir a llarg termini sense operar.

**MACD:** Indicador de moment basat en la diferència de dues EMAs.

**Maker / Taker:** Termes que descriuen si una ordre "fa" (afegeix) o "pren" (elimina) liquiditat de l'order book.

**OCO (One-Cancels-Other):** Ordre doble en la qual quan una s'executa, l'altra es cancel·la automàticament.

**Order Book:** Registre de totes les ordres de compra i venda pendents a un exchange.

**P&L (Profit and Loss):** Guanys i pèrdues. P&L positiu = guanys, negatiu = pèrdues.

**Profit Factor:** Suma de guanys totals dividit per suma de pèrdues totals. > 1 = sistema rendible.

**RSI (Relative Strength Index):** Oscil·lador de força relativa. 0-100, on > 70 = sobrecompra i < 30 = sobrevenuda.

**Slippage:** Diferència entre el preu esperat d'execució i el preu real d'execució. Major en mercats poc líquids o en ordres molt grans.

**SL (Stop Loss):** Ordre automàtica de venda per limitar les pèrdues en una posició.

**Spread:** Diferència entre el preu de compra (ask) i el preu de venda (bid).

**Testnet:** Entorn de proves que imita la producció però amb diners virtuals.

**Tick Size:** El mínim increment de preu permès per a un par de divises.

**TP (Take Profit):** Ordre automàtica de venda per assegurar guanys en una posició.

**Trailing Stop:** Stop loss que es mou automàticament seguint el preu en la direcció favorable.

**Volatilitat:** Mesura de la dispersió dels retorns. Alta volatilitat = grans moviments de preu.

**Volume Surge:** Pic de volum de transaccions molt superior a la mitjana habitual.

**Win Rate:** Percentatge d'operacions que acaben en guany sobre el total.

---

## 24. Consideracions legals i fiscals

### 24.1 Marc legal a Espanya i Catalunya

El trading de criptomonedes és **legal a Espanya**. No existeix cap prohibició sobre la compra, venda o trading de criptomonedes per a particulars.

Tanmateix, existeixen obligacions:

**Declaració d'impostos:** Els guanys de criptomonedes s'han de declarar a l'IRPF com a "Guanys i pèrdues patrimonials". No fer-ho pot resultar en sancions de fins al 150% de la quantitat no declarada.

**Declaració de béns a l'estranger (Modelo 720):** Si el valor de les criptomonedes en exchanges estrangers supera els 50.000 €, cal declarar-les al Modelo 720 (Declaració de Béns a l'Estranger).

**IVA:** El trading de criptomonedes per a particulars **no genera IVA** (no és una activitat econòmica empresarial).

### 24.2 Classificació fiscal dels guanys

- **Trading actiu (buy-sell):** Guany o pèrdua patrimonial. S'integra a la base imponible de l'estalvi.
- **Comissions guanyades:** Podrien considerar-se rendiments del capital mobiliari.
- **Pèrdues:** Compensables amb guanys patrimonials del mateix exercici o dels 4 exercicis posteriors.

**Recomanació:** Exportar l'historial complet de trades de Binance i usar eines especialitzades (Koinly, TaxDown) per calcular la base imposable anual.

### 24.3 Registre de totes les operacions

El sistema, gràcies al historial de Binance i als logs propis, facilita enormement la documentació de les operacions per a efectes fiscals. Cada operació queda registrada amb:
- Data i hora exactes
- Preu d'entrada i sortida
- Quantitat
- Comissions pagades

### 24.4 Avis legal

**Aquest document no constitueix assessorament financer ni fiscal.** Les projeccions de rendiment presentades son estimacions teòriques amb finalitats il·lustratives. La inversió en criptomonedes comporta un risc significatiu de pèrdua de capital. L'autor no es fa responsable de les pèrdues derivades de l'ús d'aquest sistema. Consulta sempre un professional financer i un assessor fiscal abans de prendre decisions d'inversió.

---

## Epíleg: Reflexions finals

Aquest projecte neix de la convicció que la tecnologia pot democratitzar eines que fins ara eren accessibles únicament a fons d'inversió i traders professionals. Un sistema que combina anàlisi tècnica automatitzada, gestió del risc integrada i notificacions intel·ligents pot proporcionar a un inversor individual un avantatge informacional significatiu sobre el mercat retail.

Tanmateix, cal mantenir una perspectiva realista. El trading, per molt automatitzat que estigui, segueix sent una activitat d'alt risc on no existeix garantia de guanys. El sistema és una eina que amplifica les capacitats del trader, però no substitueix el judici humà, la disciplina emocional ni la gestió responsable del capital.

La millor estratègia és sempre la que l'usuari entén completament i pot seguir amb consistència. Usar el sistema com a suport a la decisió, no com a caixa negra màgica que genera diners.

Bona sort, i que els mercats t'acompanyin.

---

*Document generat el 8 de març de 2026. Versió 1.0.*
*Propietat privada. Distribució no autoritzada.*

---

**Fi del document — TOTELSISTEMA.md**

*Total de seccions: 24 | Total d'apartats: 87 | Taules: 18 | Exemples de codi: 24*
