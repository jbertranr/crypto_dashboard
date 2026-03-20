# Crypto Dashboard

Dashboard de trading de criptomonedes connectat a Binance (testnet/demo). Permet monitoritzar el portfolio, gestionar ordres OCO i LIMIT, analitzar mercats amb indicadors tècnics i rebre notificacions automàtiques via Telegram.

---

## Índex

1. [Característiques](#característiques)
2. [Stack tecnològic](#stack-tecnològic)
3. [Requisits previs](#requisits-previs)
4. [Instal·lació](#installació)
5. [Configuració](#configuració)
6. [Estructura del projecte](#estructura-del-projecte)
7. [Pestanyes de l'aplicació](#pestanyes-de-laplicació)
8. [API Routes](#api-routes)
9. [Base de dades](#base-de-dades)
10. [Motors de servidor](#motors-de-servidor)
11. [Integració Telegram](#integració-telegram)
12. [Desenvolupament](#desenvolupament)

---

## Característiques

### Portfolio
- Visualització de tots els assets del compte Binance en taula compacta
- Distribució crypto vs stablecoins amb gràfic de pastís
- Cost mig d'entrada per asset (calculat a partir de l'historial de trades)
- P&L no realitzat per asset (preu actual vs cost d'entrada)
- P&L realitzat per períodes: 24h, 7 dies, 1 mes, 1 any
- Gràfic d'evolució del portfolio en el temps (snapshots cada 15 min)
- Gràfic de distribució donut amb colors de marca per cada moneda

### Gestió d'ordres
- Visualització d'ordres obertes (LIMIT i OCO) amb progress chart
- Creació d'ordres: LIMIT, OCO, Market Buy + Exit automàtic
- Modificació i cancel·lació d'ordres en temps real
- Assignació d'estratègies per ordre (Swing, Scalp, DCA, Breakout, Hedge)
- Historial d'ordres amb disseny visual: Take Profit ✓ / Stop Loss ✗ / Cancel·lat
- Win rate i estadístiques de l'historial

### Trailing Stop
- Motor de servidor que activa trailing stops automàticament
- S'activa quan el preu supera el nivell configurat (`activateAt`)
- Mou el SL progressivament seguint el preu (nous màxims per SELL, nous mínims per BUY)
- Backoff exponencial en cas d'errors d'API (fins a 30 min de pausa)
- Persistència a SQLite (sobreviu reinicis del servidor)

### Anàlisi tècnica
- Indicadors: RSI, MACD, EMA 20/50/200, Bollinger Bands, ATR, Stochastic, Williams %R, CCI, OBV, VWAP
- Puntuació 0–100 i veredicte: BUY / WAIT / AVOID
- Estratègies proposades per timeframe: Trend Following, Reversió, Breakout
- Gràfic de veles interactiu amb nivells TP/SL/Trailing
- Intervals: 5m, 1h, 4h
- Cancel·lació automàtica de peticions obsoletes (AbortController)

### Escàner de mercat (Matrix)
- Taula de senyals per tots els parells × intervals simultàniament
- Detecció d'oportunitats amb probabilitat estimada
- Obertura directa d'ordres OCO des de l'escàner

### Notificacions Telegram
- Alerta automàtica quan s'executa una ordre (TP, SL, compra, venda)
- Alerta quan s'activa un trailing stop
- Informe manual del portfolio des del botó ✈ del panell

---

## Stack tecnològic

| Capa | Tecnologia |
|------|-----------|
| Framework | [Next.js 16](https://nextjs.org) (App Router) |
| Llenguatge | TypeScript 5 |
| UI | React 19 |
| Gràfics | [Recharts 3](https://recharts.org) |
| Base de dades | [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) |
| Icones | [Font Awesome 6](https://fontawesome.com) (CDN) |
| Estils | CSS personalitzat (`app/styles/dashboard.css`) |
| Exchange | [Binance Demo API](https://demo-api.binance.com/api/v3) (testnet) |
| Notificacions | [Telegram Bot API](https://core.telegram.org/bots/api) |

---

## Requisits previs

- **Node.js** ≥ 18
- **npm** (o yarn / pnpm / bun)
- Compte a [Binance Testnet](https://testnet.binance.vision) amb API Key i Secret
- (Opcional) Bot de Telegram creat via [@BotFather](https://t.me/BotFather)

---

## Instal·lació

```bash
# 1. Clona el repositori
git clone <url-del-repo>
cd crypto_dashboard

# 2. Instal·la les dependències
npm install

# 3. Copia i configura les variables d'entorn
cp .env.local.example .env.local
# Edita .env.local amb les teves credencials

# 4. Arranca en mode desenvolupament
npm run dev
```

Obre [http://localhost:3000](http://localhost:3000) al navegador.

---

## Configuració

Edita el fitxer `.env.local` a l'arrel del projecte:

```env
# ── Binance Testnet ─────────────────────────────────────────────
# Credencials de https://testnet.binance.vision
BINANCE_API_KEY=la_teva_api_key
BINANCE_SECRET_KEY=el_teu_secret_key

# ── Telegram Bot (opcional) ─────────────────────────────────────
# 1. Escriu /newbot a @BotFather per crear el bot i obtenir el TOKEN
# 2. Escriu /start al bot i consulta:
#    https://api.telegram.org/bot<TOKEN>/getUpdates
#    per obtenir el CHAT_ID
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

> **Nota:** Si `TELEGRAM_BOT_TOKEN` o `TELEGRAM_CHAT_ID` estan buits, les notificacions s'ignoren silenciosament. La resta de l'aplicació funciona amb normalitat.

---

## Estructura del projecte

```
crypto_dashboard/
├── app/
│   ├── api/                        # API Routes (Next.js Route Handlers)
│   │   ├── analysis/               # Anàlisi tècnica amb indicadors
│   │   ├── balance/                # Saldo del compte Binance
│   │   ├── cache/invalidate/       # Invalidació de la caché SQLite
│   │   ├── cost-basis/             # Cost mig d'entrada per asset
│   │   ├── exchange-info/          # Informació de parells (tick size, etc.)
│   │   ├── klines/                 # Veles OHLCV (amb caché)
│   │   ├── klines-range/           # Veles per rang de dates
│   │   ├── orders/
│   │   │   ├── route.ts            # GET ordres obertes
│   │   │   ├── new/                # POST nova ordre (LIMIT / OCO)
│   │   │   ├── cancel/             # DELETE cancel·lar ordre
│   │   │   ├── modify/             # PUT modificar ordre
│   │   │   ├── history/            # GET historial d'ordres
│   │   │   ├── buy-and-exit/       # POST market buy + OCO de sortida
│   │   │   ├── replace-oco/        # POST reemplaça OCO existent
│   │   │   └── trailing/           # GET/POST gestió trailing stops
│   │   │       └── activate/       # POST activa trailing manualment
│   │   ├── pnl/                    # P&L realitzat per períodes
│   │   ├── portfolio-snapshot/     # POST desa snapshot de valor total
│   │   ├── strategies/             # GET/POST estratègies per ordre
│   │   ├── telegram/report/        # POST envia informe a Telegram
│   │   └── trades/                 # GET historial de trades executats
│   │
│   ├── components/                 # Components React (client-side)
│   │   ├── DashboardShell.tsx      # Shell principal amb nav i layout
│   │   ├── Nav.tsx                 # Barra de navegació i pestanyes
│   │   ├── OrdersPanel.tsx         # Panell central (totes les pestanyes)
│   │   ├── PortfolioTab.tsx        # Pestanya de portfolio
│   │   ├── AnalysisTab.tsx         # Pestanya d'anàlisi tècnica
│   │   ├── StrategyMatrix.tsx      # Escàner de mercat
│   │   ├── NewOrderModal.tsx       # Modal per crear ordres
│   │   ├── OcoProgressChart.tsx    # Gràfic de progrés d'ordres OCO
│   │   ├── PortfolioChart.tsx      # Gràfic d'evolució del portfolio
│   │   ├── PnlStats.tsx            # Estadístiques de P&L
│   │   ├── CoinSidebar.tsx         # Barra lateral amb preus en temps real
│   │   ├── CoinTable.tsx           # Taula de monedes
│   │   ├── CoinModal.tsx           # Modal de detall d'una moneda
│   │   ├── CoinIcon.tsx            # Icona de moneda (via CryptoIcons CDN)
│   │   ├── Sparkline.tsx           # Mini gràfic de línia 7 dies
│   │   ├── StatCard.tsx            # Targeta de estadística
│   │   └── TopbarTicker.tsx        # Ticker de preus a la topbar
│   │
│   ├── lib/                        # Lògica de servidor i utilitats
│   │   ├── binance-auth.ts         # Client autenticat de l'API Binance
│   │   ├── cache-store.ts          # SQLite: caché, snapshots, trailing
│   │   ├── indicators.ts           # Càlcul d'indicadors tècnics (pure functions)
│   │   ├── trailing-engine.ts      # Motor de trailing stop (servidor)
│   │   ├── order-monitor.ts        # Detecció de fills i notificacions
│   │   ├── telegram.ts             # Integració Telegram Bot API
│   │   ├── snapshot-store.ts       # Gestió de snapshots de portfolio
│   │   ├── strategy-store.ts       # Persistència d'estratègies per ordre
│   │   ├── format.ts               # Formatadors de moneda i nombre
│   │   └── api.ts                  # Helpers de fetch client-side
│   │
│   ├── styles/
│   │   └── dashboard.css           # Tots els estils de l'aplicació
│   │
│   ├── layout.tsx                  # Layout global (fonts, meta)
│   └── page.tsx                    # Pàgina principal (SSR inicial)
│
├── data/
│   └── cache.db                    # Base de dades SQLite (auto-generada)
│
├── public/                         # Assets estàtics
├── .env.local                      # Variables d'entorn (no al repo)
├── package.json
└── README.md
```

---

## Pestanyes de l'aplicació

### Portfolio
Mostra tots els assets del compte amb dues taules costat a costat:
- **Cryptos** — valor, variació 24h, preu, P&L real vs cost d'entrada
- **Distribució** — gràfic de pastís crypto vs stablecoins
- **Stablecoins** — valor total de cada stable

A dalt de la secció: targetes de resum (valor total, P&L 24h, ordres obertes), gràfic donut de distribució, evolució temporal del portfolio i P&L realitzat per períodes.

### Open Orders
Llista d'ordres obertes amb:
- Gràfic de progrés per ordres OCO (mostra distància al TP i SL)
- Assignació d'estratègia per ordre (color-coded)
- Botó de cancel·lació i modificació individual
- Trailing stop configurable per cada ordre

### History
Historial d'ordres executades amb disseny visual modern:
- Barra de win rate (TP vs SL)
- Cards amb codi de color: verd (TP), vermell (SL), blau (compra), lila (venda)
- Agrupació d'ordres OCO (mostra la cama executada i la cancel·lada)
- Comissions detallades per ordre

### Anàlisi
Per a BTC, ETH, BNB, SOL i XRP en intervals 5m, 1h i 4h:
- Puntuació 0–100 i veredicte BUY / WAIT / AVOID
- Estratègies proposades amb gràfic de veles, nivells TP/SL i trailing
- Taula d'indicadors tècnics agrupats (tendència, momentum, volatilitat, volum)

### Escàner (Matrix)
- Taula de tots els parells vs intervals amb el seu veredicte
- Llista d'oportunitats ordenades per probabilitat
- Apertura directa d'ordres des de l'escàner

---

## API Routes

Totes les rutes estan a `app/api/` i segueixen la convenció de Next.js App Router.

| Mètode | Ruta | Descripció |
|--------|------|-----------|
| `GET` | `/api/orders` | Ordres obertes |
| `POST` | `/api/orders/new` | Crea ordre LIMIT o OCO |
| `DELETE` | `/api/orders/cancel` | Cancel·la una ordre |
| `PUT` | `/api/orders/modify` | Modifica una ordre |
| `GET` | `/api/orders/history` | Historial d'ordres per símbols |
| `POST` | `/api/orders/buy-and-exit` | Market buy + OCO de sortida |
| `POST` | `/api/orders/replace-oco` | Reemplaça una OCO existent |
| `GET/POST` | `/api/orders/trailing` | Llegeix / crea trailing stop |
| `POST` | `/api/orders/trailing/activate` | Activa trailing manualment |
| `GET` | `/api/balance` | Saldo del compte |
| `GET` | `/api/trades` | Trades executats recents |
| `GET` | `/api/analysis` | Anàlisi tècnica d'un parell |
| `GET` | `/api/klines` | Veles OHLCV (amb caché 5 min) |
| `GET` | `/api/klines-range` | Veles per rang de dates |
| `GET` | `/api/exchange-info` | Info de símbol (tick size, lot size) |
| `GET` | `/api/cost-basis` | Cost mig d'entrada per asset |
| `GET` | `/api/pnl` | P&L realitzat per períodes |
| `POST` | `/api/portfolio-snapshot` | Desa snapshot de valor total |
| `GET/POST` | `/api/strategies` | Llegeix / desa estratègia per ordre |
| `DELETE` | `/api/cache/invalidate` | Invalida caché per prefix |
| `POST` | `/api/telegram/report` | Envia informe de portfolio a Telegram |

---

## Base de dades

SQLite local a `data/cache.db`, gestionada amb `better-sqlite3`. S'autocrea en el primer arrancament.

### Taules

| Taula | Descripció |
|-------|-----------|
| `api_cache` | Caché de respostes de l'API Binance (klines, analysis). TTL configurable |
| `snapshots` | Historial de valor total del portfolio (un punt cada 15 min) |
| `strategies` | Estratègia assignada a cada ordre (key: `oco:ID` o `ord:ID`) |
| `trailing_active` | Trailing stops actius gestionats pel motor de servidor |
| `order_trailing` | Suggerències de trailing pendents d'activació automàtica |

---

## Motors de servidor

Dos processos singleton que s'inicien en el primer request i continuen executant-se mentre el servidor està actiu. Utilitzen globals de Node.js per sobreviure els hot-reloads en desenvolupament.

### TrailingEngine (`app/lib/trailing-engine.ts`)

S'executa cada **30 segons**:
1. Comprova si algun trailing pendent ha de ser activat (preu ha superat `activateAt`)
2. Si s'activa: cancel·la l'OCO original i col·loca un nou SL
3. Per als trailing actius: si el preu fa nous màxims, mou el SL amunt (cancel·la i reemplaça)
4. En detectar un fill del SL: envia notificació Telegram

**Backoff exponencial:** després de 3 errors consecutius per un parell, fa pausa creixent fins a 30 minuts màxim.

### OrderMonitor (`app/lib/order-monitor.ts`)

S'executa cada **35 segons** (desfasat del TrailingEngine):
1. Obté la llista actual d'ordres obertes
2. Compara amb la llista anterior (coneguda)
3. Per cada ordre que ha desaparegut: consulta el seu estat a Binance
4. Si `status === FILLED`: envia notificació Telegram amb el resultat (TP / SL / compra / venda)
5. Les cancel·lacions (altra cama d'un OCO) s'ignoren

---

## Integració Telegram

### Configuració del bot

1. Obre Telegram i escriu a [@BotFather](https://t.me/BotFather)
2. Executa `/newbot` i segueix les instruccions → obtindràs el **TOKEN**
3. Escriu `/start` al teu nou bot
4. Consulta `https://api.telegram.org/bot<TOKEN>/getUpdates` → busca `"chat":{"id":...}` → és el teu **CHAT_ID**
5. Afegeix ambdós valors a `.env.local`

### Tipus de notificacions

**Fill d'ordre:**
```
🟢 Take Profit executat ✓

📊 BTC/USDT
📌 Preu exec.: $95,420
📦 Quantitat:  0.0884 BTC
💵 Valor:       $8,435
🔗 OCO #12345
⏰ 7 mar 2026 · 14:32
```

**Informe de portfolio** (botó ✈ al panell o `POST /api/telegram/report`):
```
📊 Informe de portfolio
━━━━━━━━━━━━━━━━━━━━

💼 Valor total:    $15,420
📈 P&L 24h:  +$342 (+2.3%)
📋 Ordres obertes: 5 (3 OCO · 2 LIMIT)

🏆 Top assets:
  • BTC: $8,420  54.6%  +2.3%
  • ETH: $3,180  20.6%  -1.1%

⏰ 7 mar 2026 · 14:00
```

---

## Desenvolupament

```bash
# Mode desenvolupament (hot-reload)
npm run dev

# Build de producció
npm run build
npm run start

# Lint
npm run lint
```

### Variables d'entorn en producció

Per desplegar a Vercel o similar, afegeix `BINANCE_API_KEY`, `BINANCE_SECRET_KEY`, `TELEGRAM_BOT_TOKEN` i `TELEGRAM_CHAT_ID` a les variables d'entorn del projecte al tauler de la plataforma.

> **Atenció:** L'aplicació connecta al **testnet de Binance** (`demo-api.binance.com`). Per usar-la amb fons reals caldria canviar la URL base a `binance-auth.ts` i assegurar-se de revisar la gestió de riscos.

---

## Llicència

Ús privat. No redistribuir sense permís.
