# agent_disseny.md — Instruccions de Disseny del Crypto Dashboard

> **Propòsit:** Guia de referència per a qualsevol agent (IA o humà) que hagi de fer canvis visuals o estructurals a aquest projecte. Llegeix-la sencera abans de tocar res de CSS o JSX.

---

## 1. Filosofia de disseny

**Tema:** "Indigo Fintech" — inspirat en dashboards moderns de fintech (Stripe, Linear, Vercel).

- **Estètica:** Lleuger, net, professional. Blanc pur com a base, accent índigo, grisos slate.
- **Densitat:** Dades denses però llegibles. Molta informació en poc espai, sense semblar carregat.
- **Interacció:** Subtil. Hovers, transitions de 0.15–0.2s, sense animacions exagerades.
- **Idioma de la UI:** Català. Totes les etiquetes, tooltips, missatges d'error i textos de la interfície han d'estar en català.
- **Moneda:** USD com a unitat per defecte, formatada amb `formatCurrency()` de `app/lib/format.ts`.

---

## 2. Paleta de colors (CSS variables — `app/globals.css`)

```css
/* Fons */
--bg-page:    #f8fafc   /* Slate 50  — fons general de la pàgina */
--bg-nav:     #ffffff   /* Blanc     — sidebar de navegació */
--bg-card:    #ffffff   /* Blanc     — fons de cards */
--bg-card-2:  #f8fafc   /* Slate 50  — fons de files alternes, inputs */
--bg-hover:   #f1f5f9   /* Slate 100 — hover de files i botons */
--bg-input:   #f8fafc   /* Slate 50  — camps de formulari */
--bg-1:       var(--bg-card)
--bg-2:       var(--bg-card-2)

/* Vores */
--border:     #e2e8f0   /* Slate 200 — vores normals */
--border-mid: #cbd5e1   /* Slate 300 — vores destacades */

/* Text */
--text-1:     #0f172a   /* Slate 900 — text principal */
--text-2:     #475569   /* Slate 600 — text secundari */
--text-3:     #94a3b8   /* Slate 400 — text tènue, etiquetes dim */

/* Accent — Indigo */
--accent:     #4f46e5   /* Indigo 600 — CTA, tabs actius, focus */
--accent-dim: rgba(79,70,229,0.08)

/* Semàntic */
--green:      #059669   /* Emerald 600 — profit, alcista, BUY */
--green-dim:  rgba(5,150,105,0.08)
--red:        #dc2626   /* Red 600     — loss, bajista, EVIT/AVOID */
--red-dim:    rgba(220,38,38,0.07)
--blue:       #2563eb   /* Blue 600    — info, neutral-blue */
--blue-dim:   rgba(37,99,235,0.08)
--yellow:     #d97706   /* Amber 600   — warning, WAIT */

/* Ombres */
--shadow-card: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)
--shadow-lg:   0 20px 60px rgba(0,0,0,0.12), 0 8px 20px rgba(0,0,0,0.06)

/* Layout */
--nav-w:     220px
--topbar-h:  60px
--radius:    12px
--radius-sm:  8px
```

**Regla:** Mai usar colors hardcoded al JSX. Sempre usar les variables CSS anteriors o, en cas de colors específics de cripto, com a `style={{ color: coinColor }}` on `coinColor` ve d'una constant de component.

---

## 3. Tipografia

- **Font principal:** Inter (Google Fonts, pesos 400/500/600/700)
- **Font monospace:** JetBrains Mono (per preus, valors numèrics, IDs d'ordre)
- **Mida base:** 13px (definida al `body`)
- **Escala de mides habituals:**
  - Títols de secció: 0.78–0.85rem, weight 700
  - Text de taula: 0.75–0.78rem
  - Subtext / dim: 0.65–0.72rem
  - Valors de card (destacats): 1.2–1.6rem, weight 700
  - Micro etiquetes: 0.6–0.65rem

**Classe `.mono`** → aplica JetBrains Mono. Usar-la a: preus, imports, percentatges de P&L, timestamps.

---

## 4. Estructura de layout general

```
┌─────────────────────────────────────────────────────────────┐
│  .app (100vh, flex column)                                   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  .app__body (flex row, flex:1, overflow hidden)       │   │
│  │  ┌──────────┐  ┌──────────────────────┐  ┌────────┐  │   │
│  │  │  .nav    │  │  .content            │  │        │  │   │
│  │  │ 220px    │  │  ┌────────────────┐  │  │ .coin- │  │   │
│  │  │ sidebar  │  │  │  .orders-area  │  │  │ sidebar│  │   │
│  │  │          │  │  │  (panel de     │  │  │        │  │   │
│  │  │          │  │  │   tabs)        │  │  │        │  │   │
│  │  │          │  │  └────────────────┘  │  │        │  │   │
│  │  └──────────┘  └──────────────────────┘  └────────┘  │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

- **Nav (`app/components/Nav.tsx`):** Sidebar esquerra, 220px. Marca + botons de tab.
- **Content:** Flex row, ocupa la resta. Conté `.orders-area` (panell de tabs) i `.coin-sidebar` (llista de cryptos).
- **CoinSidebar (`app/components/CoinSidebar.tsx`):** Sidebar dreta, amplada fixa, llista de preus en temps real.
- **OrdersPanel (`app/components/OrdersPanel.tsx`):** Conté el sistema de tabs. És el component principal.

---

## 5. Sistema de tabs

| Tab key       | Component               | Descripció                                    |
|---------------|-------------------------|-----------------------------------------------|
| `portfolio`   | `PortfolioTab`          | Resum de holdings, P&L multi-finestra, gràfic |
| `open`        | `OpenOrderTable`        | Ordres obertes (OCO, SL, trailing)             |
| `history`     | `HistoryTable`          | Historial d'ordres executades                 |
| `balance`     | `BalanceTable`          | Balanç de la cartera per actiu                |
| `analysis`    | `AnalysisTab`           | Anàlisi tècnica multi-timeframe per parella    |
| `matrix`      | `StrategyMatrix`        | Escàner de mercat — matriu d'estratègies      |
| `journal`     | `JournalTab`            | Diari d'operacions                            |
| `simulation`  | `SimulationTab`         | Backtest i simulació d'estratègies            |
| `bot`         | `BotTab`                | Control del bot automàtic                     |
| `logs`        | `LogsPanel`             | Logs del servidor                             |
| `errors`      | `ErrorsPanel`           | Errors del sistema                            |
| `settings`    | `SettingsTab`           | Configuració (API keys, Telegram, etc.)       |

**Renderització condicional:** Cada tab renderitza el seu component únicament quan `tab === "key"`. Aixó vol dir que cada component es munta/desmunta al canviar de tab.

---

## 6. Disseny de taules i llistes de files

Totes les taules i llistes de dades del dashboard segueixen un patró visual unificat i estricte. **Cap excepció.**

### Regles fonamentals

| Regla | Valor |
|-------|-------|
| Vores arrodonides al contenidor | `border-radius: 0` |
| Vores arrodonides a la ratlla d'accent | Cap. `border-radius: 0`, sense `border-radius` |
| Amplada | `width: 100%` — la taula ocupa tot l'espai disponible |
| Separador entre files | `border-bottom: 1px solid var(--border)` |
| Fons en hover | `var(--bg-card-2)` / `var(--bg-hover)` |
| Transició de hover | `transition: background 0.12s` |

### Ratlla de color a l'esquerra (accent stripe)

Cada fila de dades porta una **ratlla vertical de color sòlid a l'extrem esquerre**. Aquesta ratlla:

- **Amplada:** 3–4px (4px per a files principals, 2–3px per a sub-files)
- **Alçada:** ocupa el 100% de l'alçada de la fila — `align-self: stretch`
- **Sense arrodoniment:** `border-radius: 0` — mai usar `border-radius` a l'accent
- **Sense marge vertical:** mai usar `margin-block` — la línia va de dalt a baix de la fila sense separació
- **Color:** color de la cripto (`--pf-accent`, `--pf-color`) o color semàntic (verd/vermell/groc)

```css
/* Patró correcte */
.qualsevol-row__accent {
  align-self: stretch;   /* alçada completa de la fila */
  width: 4px;
  background: var(--color-de-la-cripto);
  /* NO border-radius, NO margin-block */
}
```

```css
/* Patró INCORRECTE — no fer això */
.qualsevol-row__accent {
  border-radius: 2px;   /* ❌ prohibit */
  margin-block: 5px;    /* ❌ prohibit */
}
```

### Padding de les files

Cada fila ha de tenir **padding superior i inferior** explícit per donar aire al contingut:

- **Files principals:** `padding-block: 0.4rem` (mínim) → `0.55rem` (estàndard)
- **Sub-files (ordres, derivats):** `padding-block: 0.3rem`
- **Capçaleres de taula:** `padding-block: 0.5rem`
- **Mai usar únicament `min-height` sense `padding`** — les dues coses poden coexistir

```css
/* Exemple de fila correcta */
.pf-row {
  display: grid;
  grid-template-columns: 4px [resta de columnes];
  align-items: center;
  padding: 0.4rem 1rem 0.4rem 0;   /* top right bottom left */
  border-bottom: 1px solid var(--border);
  min-height: 42px;
  transition: background 0.12s;
}
```

### Panells laterals i guies

Els panells de contingut adossats a taules (com la `StrategyGuide` a la dreta de l'Escàner) segueixen el **mateix patró visual que les taules**:
- Cap padding lateral al contenidor — el contingut va de vora a vora
- Cada secció / fila porta el seu propi `padding: Xpx 0.75rem` intern
- Sense `border-radius` a les seccions ni als "cards" interns
- Separació entre seccions via `border-bottom: 1px solid var(--border)`, mai amb `margin` o `gap`
- Cards expandibles (accordion): `border-left` de color + `border-bottom`, `border-radius: 0`
- Fons alternatiu per a seccions de capçalera: `var(--bg-card-2)`

### Contenidors de grups (agrupació de files)

Quan les files s'agrupen en seccions (BUY/WAIT/EVIT a l'Escàner, Crypto/Stables al Portfolio):
- El contenidor de grup té `border: 1px solid var(--border)` i `border-radius: 0`
- La capçalera del grup porta un fons semàntic lleuger (verd/groc/vermell al 8–10% d'opacitat)
- No usar `box-shadow` ni `border-radius` als grups

### Inventari de classes d'accent al projecte

| Classe | Taula | Amplada |
|--------|-------|---------|
| `.pf-row__accent` | Portfolio — fila principal | 4px |
| `.pf-orders-row__accent` | Portfolio — sub-fila d'ordres | 2px |
| `.pf-pnl-row__accent` | Portfolio — P&L resum | 4px |
| `.scanner-row__accent` | Anàlisi — llista de parelles | 4px |
| `.err-row__sev` | Errors del sistema | 3px |
| `.mtf-context__item-accent` | Anàlisi MTF — indicadors | variable |

---

## 7. Títols de secció — regla universal

**Tota capçalera de secció a l'app OBLIGATÒRIAMENT ha d'usar la classe `.section-title`.**
No pot existir cap títol "lliure" sense aquesta classe.

### CSS canònic

```css
.section-title {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-2);
  padding: 0 0.75rem;
  height: 32px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
  background: var(--accent-dim);   /* índigo molt suavitzat — NO bg-card-2 */
  width: 100%;
  overflow: hidden;
}
.section-title i {
  color: var(--accent);   /* SEMPRE accent — cap excepció per color d'icona */
  font-size: 0.65rem;
  flex-shrink: 0;
}
.section-title__right { margin-left: auto; display: flex; align-items: center; gap: 6px; }
```

**Regla de color d'icona:** Totes les icones de `.section-title` tenen `color: var(--accent)` **sempre**, sense cap excepció per secció ni context. No sobreescriure mai aquest color.

### Estructura JSX obligatòria

```jsx
/* Títol simple */
<div className="section-title">
  <i className="fa-solid fa-[icon]" /> Nom de la secció
</div>

/* Títol amb contingut a la dreta (botó, badge, edat...) */
<div className="section-title">
  <i className="fa-solid fa-[icon]" /> Nom de la secció
  <span className="section-title__right">
    {/* botons, counts, timestamps */}
  </span>
</div>
```

### Regles

| Regla | Detall |
|-------|--------|
| **Icona obligatòria** | Cada `.section-title` ha de tenir una `<i className="fa-solid fa-...">` |
| **Icona en accent** | La icona rep `color: var(--accent)` automàticament |
| **Sense inline styles** | No afegir `style={}` al `.section-title` directament |
| **Sub-títols niats** | Poden usar `.section-title` + una classe modificadora (ex: `.analysis-group__title`) que sobreescriu `background/padding` per a contextos niats |
| **Alias vàlid** | `.portfolio__section-title` és un alias que apunta a les mateixes regles CSS — acceptable per retrocompat, però preferir `.section-title` en codi nou |

### Icones per secció (inventari)

| Secció | Icona FA |
|--------|----------|
| Portfolio distribució | `fa-chart-pie` |
| Matriu d'estratègies | `fa-table-list` |
| Top oportunitats | `fa-star` |
| Guia d'estratègies | `fa-book-open` |
| Estratègies (guia) | `fa-diagram-project` |
| Nivells de confiança | `fa-circle-half-stroke` |
| Veredictes | `fa-gavel` |
| Markets (sidebar) | `fa-chart-mixed` |
| Gràfic de preu | `fa-chart-line` |
| Dashboard MTF | `fa-chart-bar` |
| Estratègies proposades | `fa-brain` |
| Indicadors tècnics | `fa-sliders` |
| Grups d'indicadors (niats) | `fa-layer-group` |

---

## 8. Convencions de CSS (BEM)

El fitxer `app/styles/dashboard.css` utilitza **BEM** (Block\_\_Element--Modifier).

```
.block {}
.block__element {}
.block--modifier {}
.block__element--modifier {}
```

**Exemples reals del projecte:**
- `.portfolio__card` / `.portfolio__card--green` / `.portfolio__card--red`
- `.pf-row__accent` / `.pf-row__identity` / `.pf-row__change--up`
- `.sm-guide-card` / `.sm-guide-card--open` / `.sm-guide-card__head`

**Regla:** Mai afegir estils inline excepte quan el valor és dinàmic (color de cripto, amplada de barra, etc.). Usar classes CSS per a tot el que sigui estàtic.

---

## 9. Components reutilitzables clau

### 9.1 Cards de estadística (`portfolio__card`)

**REGLA OBLIGATÒRIA:** Tota pàgina principal (tab) ha de començar amb:
1. Un `<div className="section-title">` amb la icona i títol del tab
2. Exactament **5 cards KPI** (`portfolio__cards bal-cards-row`) rellevants per al context

Els KPIs han de resumir l'estat global de la secció d'un cop d'ull. Escollir els 5 més significatius per a cada tab:

| Tab | KPIs recomanats |
|-----|----------------|
| Open orders | Posicions · OCO · Singles · Símbols · Capital en risc |
| History | Win rate · TP Guanys · SL Pèrdues · Cancel·lats · Volum operat |
| Balance | Total · Lliure · Blocat · Cryptos · Major posició |
| Portfolio | Total · Variació · P&L no realitzat · Assets · Millor/Pitjor |

```jsx
<div className="section-title">
  <i className="fa-solid fa-..." /> Títol del tab
</div>
<div className="portfolio__cards bal-cards-row">
  <div className="portfolio__card portfolio__card--green|red|blue|neutral">
    <span className="portfolio__card-label"><i className="fa-solid fa-..." /> Etiqueta</span>
    <span className="portfolio__card-value">Valor destacat</span>
    <span className="portfolio__card-sub">Subtext explicatiu</span>
  </div>
  {/* × 5 */}
</div>
```

Colors disponibles: `--green`, `--red`, `--blue`, `--neutral` (gris).

### 9.2 Botons primaris
```jsx
<button className="btn-primary">Acció principal</button>
<button className="btn-secondary">Acció secundària</button>
<button className="btn-danger">Acció destructiva</button>
```

### 9.3 Badges de senyal
```jsx
<span className="sig-badge sig-badge--bull">Alcista</span>
<span className="sig-badge sig-badge--bear">Bajista</span>
<span className="sig-badge sig-badge--neut">Neutre</span>
```

### 9.4 Icones
S'usa **Font Awesome 6.5** (solid). Format: `<i className="fa-solid fa-[icon]" />`.
Mai usar imatges per a icones genèriques. Per a logos de cryptos, usar `<CoinIcon symbol="BTC" size={16} />`.

### 9.5 CoinIcon (`app/components/CoinIcon.tsx`)
Mostra el logo de la cripto via URL externa de CoinGecko. Mida habitual: 16–36px.

---

## 10. PortfolioTab — disseny detallat

### Layout general (de dalt a baix)

```
┌──────────────────────────────────────────────────────┐
│  .section-title  "Resum del portfolio"  fa-gauge-high │
├──────┬──────┬──────┬──────┬──────┬──────────────────┤
│ Card │ Card │ Card │ Card │ Card │ Card              │  ← .portfolio__cards (flex)
├──────┴──────┴──────┴──────┴──────┴──────────────────┤
│  .portfolio__mid (flex row)                           │
│  ┌──────────────┬──────────────────┬───────────────┐ │
│  │ Donut chart  │ PortfolioChart   │ PnlSummary    │ │
│  └──────────────┴──────────────────┴───────────────┘ │
├──────────────────────────────────────────────────────┤
│  .pf-header (capçalera de taula, 13 col)             │
│  .pf-list (cryptos + sub-files d'ordres)             │
│  .pf-split-col + .pf-list--stables (Stablecoins)    │
├──────────────────────────────────────────────────────┤
│  .portfolio__dust (si hi ha dust)                    │
└──────────────────────────────────────────────────────┘
```

### 6 indicadors (`.portfolio__cards`)

Sempre es mostren els 6 indicadors. Si no hi ha dades, mostren `—` i fons neutral.

| # | Indicador | Icona | Color |
|---|-----------|-------|-------|
| 1 | Portfolio Total | `fa-wallet` | `--blue` |
| 2 | Variació (període seleccionat) | `fa-arrow-trend-up/down` | `--green/red` |
| 3 | Millor 24h (asset + $ + %) | `fa-trophy` | `--green/red` |
| 4 | Pitjor 24h (asset + $ + %) | `fa-arrow-down-wide-short` | `--green/red` |
| 5 | Ordres obertes | `fa-list-check` | `--neutral` |
| 6 | Si tanques ara (unrealized PnL) | `fa-door-open` | `--green/red` |

**Layout CSS:**
```css
.portfolio__cards { display: flex; border-bottom: 1px solid var(--border); }
.portfolio__card  { flex: 1; min-width: 0; border-right: 1px solid var(--border); }
.portfolio__card:last-child { border-right: none; }
```

### PortfolioChart

- **Títol:** `section-title pchart__header` amb `fa-chart-line` + botons de període a `section-title__right`
- **Canvas:** `height: 182px`, `padding: 2em 3em 2em 0`, `overflow: visible`
- **Margin intern recharts:** `{ top: 4, right: 20, bottom: 0, left: 0 }`
- **La fila de stats (valor, % canvi, snapshots) ha estat eliminada** — les dades ja surten als indicadors
- **Overlay BTC:** línia taronja puntejada, toggle amb botó ₿ als botons de període

### Capçalera de taula (`.pf-header`)

```css
.pf-header {
  padding: 0.55rem 1rem 0.55rem 0;
  border-bottom: 2px solid var(--border-mid);
  font-size: 0.62rem; font-weight: 800;
  color: var(--text-2);
  background: var(--accent-dim);
}
```
Columnes: `Accent · Asset · Valor · 1h · 4h · 1d · 3d · 7d · 1m · 6m · Sempre · Preu · Ordres`

**No hi ha barra d'ordenació** — eliminada. L'ordre per defecte és per valor descendent.

### Grid de la taula d'assets (13 columnes)
```css
grid-template-columns:
  4px          /* accent de color */
  150px        /* identitat (nom + badges) */
  100px        /* valor total en USD */
  64px × 7     /* P&L: 1h · 4h · 1d · 3d · 7d · 1m · 6m */
  90px         /* sempre (unrealized PnL vs cost basis) */
  88px         /* preu actual */
  130px        /* ordres obertes */
```

### Fila principal (`.pf-row`)
- Accent de color (4px, color de la cripto)
- Nom + icona + % de la cartera + badges OCO/SL
- Valor actual en USD + quantitat
- 7 cel·les de P&L per finestra temporal ($ i % en mini)
- P&L total des de compra (unrealized)
- Preu actual
- Botó venda → USDT (si hi ha saldo lliure)

### Fila d'ordres (`.pf-orders-row`)
Apareix sota la fila principal **només si hi ha quantitat bloquejada** (`locked > 0`).
Mostra el P&L de la quantitat bloquejada per cada finestra temporal.

### Capçaleres de secció dins la taula

| Element | Classe | Icona |
|---------|--------|-------|
| Stablecoins | `section-title pf-header--stable` | `fa-circle-dollar-to-slot` |
| Dust (< $10) | `section-title` (dins `.portfolio__dust`) | `fa-coins` |
| Distribució | `section-title pf-split-col__title` | `fa-chart-pie` |

### Colors de P&L
- Positiu: `var(--green)` (#059669)
- Negatiu: `var(--red)` (#dc2626)
- Neutre / sense dades: `var(--text-3)`

### Fórmula P&L (IMPORTANT — no canviar)
```
pnlX = valueUSD × changeX / (100 + changeX)
```
(No usar `valueUSD × changeX / 100`, que dóna un resultat incorrecte)

### Snapshots
El portfoli guarda un snapshot cada 15 minuts a la base de dades local.
Els càlculs de "Variació" de la card usen **snapshots**, NO el % de Binance API, per garantir coherència amb el gràfic.

---

## 11. StrategyMatrix (Escàner) — disseny detallat

### Layout: split 50/50
- **Esquerra 50% (`.strat-matrix__left`):** Matriu d'estratègies amb capçalera de llegenda, indicadors de confiança i taula agrupada per verdict.
- **Dreta 50% (`.strat-matrix__right`):** Panell `StrategyGuide` — explicació de cada estratègia, nivells de confiança i veredictes. Scrollable.

### Matriu
Files agrupades per verdict: BUY → WAIT → EVIT.
Cada fila mostra 3 dots (5m, 1h, 4h) de color verd/groc/vermell/gris segons estratègia activa i confiança.

### Estratègies
| Short | Nom                     | Color    |
|-------|-------------------------|----------|
| TF↑   | Trend Following Alcista | #16a34a  |
| TF↓   | Trend Following Bajista | #ef4444  |
| Rev↑  | Reversió Alcista        | #22c55e  |
| Rev↓  | Reversió Bajista        | #f97316  |
| BRK   | Breakout Alcista        | #a78bfa  |

### Popover de detall
- Apareix al hover sobre una fila (delay 180ms per evitar flickering).
- S'ancora al centre de la pantalla (`position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%)`).
- Clicar una fila **fixa** el popover (`pinnedCoin` state). Clicar de nou o el backdrop el tanca.
- Mostra: `OpportunityCard` (bull) i/o `OpportunityCard` (bear) per a la cripto activa.

### Auto-fetch
En muntar el component (quan s'obre el tab "Escàner"), `fetchAll()` s'executa automàticament.

---

## 12. AnalysisTab — disseny detallat

> **IMPORTANT:** No modificar aquest component sense permís explícit. Té el seu propi disseny.

### Layout actual
- **Topbar:** botons de parella (BTC, ETH, BNB, SOL, XRP) + botons d'interval (5m, 1h, 4h) + botó refresca.
- **Panel principal (`.analysis-panel`):** mostra `AnalysisView` per a la parella/interval seleccionats.

### AnalysisView
Mostra per ordre:
1. Cards de stats (preu, score, decisió MTF)
2. Gràfic de preu (SVG custom `PriceLineChart`) + panell lateral (TP/SL, ratio R:R, pros/contres, botó OCO)
3. Dashboard Multi-Timeframe (3 capes: 4h direcció, 1h context, 5m trigger)
4. Estratègies proposades (accordion de `StrategyCard`)
5. Indicadors tècnics detallats (expandibles)

---

## 13. Modals

### NewOrderModal (`app/components/NewOrderModal.tsx`)
Modal per crear/modificar ordres OCO, SL, trailing.
- Background overlay: `rgba(0,0,0,0.5)` amb blur.
- Centrat: `position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%)`.
- Sempre usar `--radius` (12px) per al `border-radius`.
- Formularis: inputs amb classe `.modal-input` o similar, fons `var(--bg-input)`, border `var(--border)`.

---

## 14. Responsive / breakpoints

- **Desktop (>= 1200px):** Layout complet de 13 columnes a PortfolioTab.
- **Tablet (768–1199px):** S'adapta però manté la majoria de columnes.
- **Mòbil (< 768px):** Layout simplificat: 5 columnes visibles a PortfolioTab, `.pf-orders-row` oculta.

---

## 15. Estructura de fitxers

```
app/
├── globals.css              ← Variables CSS, reset, tipografia
├── styles/dashboard.css     ← Tots els estils del dashboard (BEM)
├── layout.tsx               ← Root layout, carrega fonts i FA
├── page.tsx                 ← Punt d'entrada (SSR inicial de coins)
├── components/
│   ├── DashboardShell.tsx   ← Shell: refresc de mercat, passa tab
│   ├── Nav.tsx              ← Sidebar de navegació
│   ├── OrdersPanel.tsx      ← Sistema de tabs (component central)
│   ├── PortfolioTab.tsx     ← Tab portfolio
│   ├── PortfolioChart.tsx   ← Gràfic d'evolució del portfolio
│   ├── AnalysisTab.tsx      ← Tab d'anàlisi tècnica
│   ├── StrategyMatrix.tsx   ← Tab escàner / matriu d'estratègies
│   ├── CoinSidebar.tsx      ← Sidebar dreta de preus
│   ├── CoinIcon.tsx         ← Icona de cripto via URL
│   ├── NewOrderModal.tsx    ← Modal de crear/modificar ordre
│   └── ...                  ← Altres tabs i components
├── lib/
│   ├── types.ts             ← Interfaces TypeScript (CoinRow, etc.)
│   ├── api.ts               ← Clients de l'API (getMarketData, etc.)
│   ├── format.ts            ← formatCurrency, formatPct, etc.
│   ├── indicators.ts        ← Càlculs tècnics (RSI, MACD, EMA, etc.)
│   ├── cache-store.ts       ← Cache en memòria del servidor
│   └── ...
└── api/
    ├── market/              ← GET preus + canvis de Binance
    ├── analysis/            ← GET anàlisi tècnica d'una parella
    ├── orders/              ← CRUD d'ordres (new, cancel, modify...)
    ├── balance/             ← GET balanç de la cartera
    ├── klines/              ← GET candeles de Binance
    ├── portfolio-snapshot/  ← GET/POST snapshots del valor del portfolio
    ├── pnl/                 ← GET P&L calculat
    └── ...
```

---

## 16. Convencions de codi

- **TypeScript strict.** `npx tsc --noEmit` ha de donar 0 errors després de qualsevol canvi.
- **"use client"** a tots els components que usen hooks o events del browser.
- **Fetch al client:** sempre amb `try/catch` i gestió de loading/error state.
- **Fetch al servidor (API routes):** usar `AbortSignal.timeout(8_000)` i retornar `NextResponse.json(...)`.
- **Cache:** usar `cacheGet/cacheSet` de `app/lib/cache-store.ts` per evitar crides repetides a Binance.
- **No usar `any` llevat que sigui inevitable.** Preferir `unknown` + type guard.

---

## 17. Regles de disseny que NO s'han de trencar

1. **Colors semàntics:** Verd = profit/alcista. Vermell = loss/bajista. Groc = warning/espera. Blau = neutre/info.
2. **Densitat consistent:** No augmentar paddings arbitràriament. Cada pixel compta en un dashboard de dades.
3. **No modificar `AnalysisTab.tsx` sense permís.** Té un disseny i comportament propis.
4. **No usar Tailwind utilities directament al JSX.** Tot l'estil va a `dashboard.css`.
5. **Les fórmules de P&L són fixes.** No canviar la fórmula `valueUSD × c / (100 + c)`.
6. **Idioma:** Tota la UI en català. No barrejar castellà o anglès a les etiquetes.
7. **Fonts de dades de "Variació":** El panell de stats i el gràfic usen snapshots locals. NO usar el `%change24h` de Binance per a la card "Variació" (donaria resultats inconsistents).
8. **El tab "Escàner" (`matrix`) auto-fetch** en muntar. No eliminar el `useEffect` de `fetchAll`.
9. **5 KPIs obligatoris per tab:** Cada pàgina principal ha de mostrar un `section-title` + 5 cards `portfolio__card` al principi. Vegeu §9.1 per als KPIs recomanats per tab.
10. **Taules de balance:** Les cel·les amb doble valor mostren l'import en $ en gran (`bal-row__cell-main`) i la quantitat de crypto en petit (`bal-row__cell-sub`).

---

*Última actualització: 2026-03-20 (v3 — 5 KPIs obligatoris per tab, balance redesign, nav 5 categories)*
