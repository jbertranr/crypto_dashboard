# Guia d'Agents, Skills i Artefactes — CryptDesk

> Document de referència per millorar l'aplicació fent servir les eines d'IA disponibles.
> Actualitzat: 2026-04-07

---

## TL;DR — Punt d'entrada únic

No cal saber quin agent usar. Hi ha **un sol comando** que detecta el context automàticament:

| Eina | Comando | Quan usar-lo |
|------|---------|--------------|
| Claude Code | `/check` | Sempre. Detecta automàticament què cal revisar. |
| GitHub Copilot | `@check` | Equivalent, des del chat de Copilot. |
| Copilot (UI nova) | `@agent_styler [descripció]` | Únic cas on cal triar manualment: crear/modificar UI. |

**Flux mínim:**
1. Fas canvis al codi
2. Escrius `/check` (o `@check`)
3. L'agent et diu exactament què cal fer

---

## Índex

1. [Mapa general](#1-mapa-general)
2. [Agents de GitHub Copilot](#2-agents-de-github-copilot)
3. [Agents i Commands de Claude Code](#3-agents-i-commands-de-claude-code)
4. [Skills de Claude Code](#4-skills-de-claude-code)
5. [Artefactes del projecte](#5-artefactes-del-projecte)
6. [Guia pràctica: com millorar l'aplicació](#6-guia-practica-com-millorar-laplicacio)
7. [Taula de decisió ràpida](#7-taula-de-decisio-rapida)

---

## 1. Mapa general

```
CryptDesk — Eines d'IA disponibles
│
├── GitHub Copilot  (VS Code, mode Agèntic)
│   ├── .github/agents/agent_reviewer.md   ← revisor de codi
│   └── .github/agents/agent_styler.md     ← guardià de disseny
│
└── Claude Code  (CLI / extensió VS Code)
    ├── Commands (slash)
    │   └── .claude/commands/agent_reviewer.md   ← /agent_reviewer
    ├── Skills
    │   └── .claude/skills/agent-reviewer/       ← skill invocable
    └── Skills globals del sistema
        ├── /simplify      ← revisió de qualitat post-edició
        ├── /loop          ← tasques recurrents
        ├── /schedule      ← agents remots programats
        ├── /update-config ← hooks i settings automatitzats
        ├── /keybindings-help
        └── /claude-api
```

---

## 2. Agents de GitHub Copilot

Ubicació: `.github/agents/`  
Com s'activen: **VS Code → Copilot Chat → Mode Agent → `@agent_reviewer` / `@agent_styler`**

---

### 2.1 `agent_reviewer` — Revisor de codi

**Fitxer**: [.github/agents/agent_reviewer.md](.github/agents/agent_reviewer.md)

Agent de **lectura i anàlisi** que revisa el projecte i genera un informe Markdown. **No modifica cap fitxer.**

#### Cobertura de la revisió

| Pas | Categoria | Què comprova |
|-----|-----------|--------------|
| 1 | Anàlisi estàtica | `tsc --noEmit` + ESLint |
| 2a | Seguretat | Endpoints sense autenticació (`getIronSession`) |
| 2b | Seguretat | Secrets de servidor exposats a components client |
| 2c | Seguretat | SQL injection (interpolació en comptes de paràmetres `?`) |
| 3a | Trading — crític | Crides a Binance sense `try/catch` |
| 3b | Trading — crític | Promises `.then()` sense `.catch()` |
| 3c | Trading — crític | Validació de preus (TP > preu, SL < preu, NaN, <= 0) |
| 3d | Trading — crític | Idempotència del trailing engine (activació concurrent) |
| 4 | React/Next.js | `useEffect` infinits, `.map()` sense `key`, fetch en loops |
| 5 | Arquitectura | Inversió de deps, lògica de negoci en components, hex hardcoded |

#### Com fer-lo servir (Copilot)

```
@agent_reviewer                          # revisió completa
@agent_reviewer app/lib/trailing-engine.ts   # un fitxer concret
@agent_reviewer app/api/                 # tots els endpoints
```

#### Format del report generat

```markdown
# Informe de Revisió de Codi
**Data**: 2026-04-07  **Àmbit**: complet

## Resum
**2 crítics** 🔴 · **3 advertències** 🟡 · **1 informatiu** 🔵

## Crític 🔴
### [TRADING] Promise no capturada a order-monitor
- **Fitxer**: `app/lib/order-monitor.ts:87`
- **Problema**: .then() sense .catch() — si Binance retorna error, el procés cau silenciosament
- **Risc**: ordre perduda sense alerta

## ✅ Passa sense errors
- TypeScript: 0 errors
- ESLint: 0 warnings
```

---

### 2.2 `agent_styler` — Guardià del disseny UI

**Fitxer**: [.github/agents/agent_styler.md](.github/agents/agent_styler.md)

Agent **implementador** que escriu JSX + CSS respectant estrictament el sistema de disseny *Indigo Fintech* del projecte. **Sí modifica fitxers** (components i `dashboard.css`).

#### Principis del sistema de disseny que enforça

| Regla | Detall |
|-------|--------|
| **Color escàs** | Color NOMÉS per a: icones d'estat, valors +/-, franja superior de card, pills de % |
| **Tokens CSS obligatoris** | Mai hex directe. Sempre `var(--accent)`, `var(--green)`, `var(--text-1)`… |
| **Badges text-only** | Absolutament prohibit: `background + border` en badges d'estat |
| **Cards de contingut** | `border-radius ≤ 8px`. Reservat `12px` per a modals |
| **BEM** | Naming: `block__element--modifier`. Un sol CSS: `dashboard.css` |
| **Tipografia** | Inter (cos) + JetBrains Mono per a preus i quantitats (`.mono`) |
| **Estructura de pàgina** | Sempre 3 stat cards (`.portfolio__cards`) + seccions |

#### Patrons de components que coneix

- `portfolio__card` — Stat cards amb franja de color superior
- `jcell` / `jcell--right` / `jcell--icon` — Cel·les de dues línies (taules denses)
- `metric-row` — Fila amb franja d'accent semàntic (`--row-color`)
- `pct-pill` — L'únic pill permès (fons transparent, sense vora)
- `signal` / `signal__dot` — Indicadors d'estat amb punt de color
- `data-row` — Files de llista (hover sobre fons transparent)
- `analysis-section--flush` — Secció edge-to-edge sense padding
- `btn-primary` / `btn-secondary` / `btn-danger` — Botons estandarditzats

#### Com fer-lo servir (Copilot)

```
@agent_styler nova pestanya d'Alertes que mostri alertes de preu activades
@agent_styler afegir columna "Durada" a la taula del journal
@agent_styler convertir el panel de riscos a grid de metric-rows
```

#### Pre-flight checklist que executa automàticament

Abans de fer commit, l'agent verifica:
- [ ] Pàgina obre amb `portfolio__cards` (3 cards)
- [ ] Títols de secció usen `portfolio__section-title`
- [ ] Zero badges amb background + border
- [ ] Valors monetaris amb classe `.mono`
- [ ] Cap hex directe al CSS
- [ ] `npx tsc --noEmit` passa sense errors

---

## 3. Agents i Commands de Claude Code

### 3.1 `/agent_reviewer` — Command de revisió (Claude Code)

**Fitxer**: [.claude/commands/agent_reviewer.md](.claude/commands/agent_reviewer.md)  
**Com s'activa**: escrivint `/agent_reviewer` al chat de Claude Code

Equivalent funcional de l'agent de GitHub Copilot, però executat per Claude Code com a subagent autònom amb accés a `Read`, `Grep`, `Glob` i `Bash`.

```
/agent_reviewer                    # tot el projecte
/agent_reviewer app/lib/           # àmbit: directori
/agent_reviewer app/api/journal/route.ts   # un fitxer
```

**Diferència respecte al Copilot**: Claude Code pot executar `tsc` i `lint` directament i llegir el resultat en temps real dins la mateixa sessió.

---

## 4. Skills de Claude Code

Les skills s'invoquen amb `/nom-skill` al chat. Algunes són globals del sistema, una és específica del projecte.

---

### 4.1 `agent-reviewer` — Skill de revisió (projecte)

**Fitxer**: [.claude/skills/agent-reviewer/SKILL.md](.claude/skills/agent-reviewer/SKILL.md)  
**Eines**: `Read`, `Grep`, `Glob`, `Bash`

Mateixa lògica que el command `/agent_reviewer`, però empaquetat com a **skill reutilitzable** que accepta `$ARGUMENTS` per filtrar l'àmbit.

---

### 4.2 `/simplify` — Revisió de qualitat post-edició  *(global)*

S'activa **després** de fer canvis al codi. Analitza el codi modificat i detecta:
- Duplicació de lògica (oportunitats de reutilització)
- Abstraccions prematures o innecessàries
- Ineficiències de rendiment

**Quan fer-lo servir**: després de qualsevol refactorització o feature nova, abans de fer commit.

```
/simplify
```

---

### 4.3 `/loop` — Tasques recurrents  *(global)*

Executa un prompt o slash command a intervals regulars.

```
/loop 5m /agent_reviewer app/lib/order-monitor.ts
/loop 10m comprova si hi ha errors nous als logs
```

**Cas d'ús CryptDesk**: monitorar errors de TypeScript mentre es desenvolupa, o revisar logs periòdicament durant una sessió de trading.

---

### 4.4 `/schedule` — Agents remots programats  *(global)*

Crea, llista i gestiona agents remots amb cron schedule. A diferència de `/loop` (funciona mentre la sessió és oberta), els agents programats s'executen de forma autònoma.

```
/schedule                          # llista els agents programats
/schedule create "revisió diària" 0 9 * * * /agent_reviewer
```

**Cas d'ús CryptDesk**: revisió de seguretat automàtica cada matí a les 9h.

---

### 4.5 `/update-config` — Hooks i configuració automàtica  *(global)*

Configura comportaments automatitzats a `settings.json` mitjançant hooks. Permet executar accions de Claude Code quan es produeix un event (pre-commit, post-edit, etc.).

```
/update-config sempre que editi app/api/ executa /agent_reviewer sobre el fitxer modificat
```

---

### 4.6 `/claude-api` — Apps amb l'Anthropic SDK  *(global)*

S'activa automàticament quan el codi importa `anthropic` o `@anthropic-ai/sdk`. Ajuda a construir features que usen la Claude API directament (anàlisi de mercat amb IA, generació de resums, etc.).

---

## 5. Artefactes del projecte

Els "artefactes" en aquest context són els fitxers de definició dels agents i les seves instruccions: documents que codifiquen el coneixement del domini i les regles del projecte en un format que un agent d'IA pot executar autònomament.

| Artefacte | Ubicació | Eina | Propòsit |
|-----------|----------|------|----------|
| `agent_reviewer.md` | `.github/agents/` | GitHub Copilot | Revisió de codi (Copilot Agent) |
| `agent_styler.md` | `.github/agents/` | GitHub Copilot | Implementació UI (Copilot Agent) |
| `agent_reviewer.md` | `.claude/commands/` | Claude Code | Revisió de codi (slash command) |
| `SKILL.md` | `.claude/skills/agent-reviewer/` | Claude Code | Revisió de codi (skill) |
| `CLAUDE.md` | `/` | Claude Code | Context del projecte per a Claude |

### Crear nous artefactes

Per afegir un nou agent de GitHub Copilot:

```markdown
---
name: agent_nom
description: "Descripció breu"
argument-hint: "Hint de l'argument opcional"
tools: ['read', 'edit', 'grep', 'bash']
---

[instruccions de l'agent]
```

Desar a `.github/agents/agent_nom.md`.

Per afegir un nou command de Claude Code: desar a `.claude/commands/nom.md`.  
Per afegir un nou skill de Claude Code: crear `.claude/skills/nom/SKILL.md` amb frontmatter `name`, `description`, `allowed-tools`.

---

## 6. Guia pràctica: com millorar l'aplicació

### Flux de treball recomanat

```
┌─────────────────────────────────────────────────────────────┐
│  1. PLANIFICAR  →  Claude Code (chat directe)              │
│     "Vull afegir una pestanya d'alertes de preu"           │
│                                                             │
│  2. REVISAR ESTAT ACTUAL  →  /agent_reviewer               │
│     Detecta problemes existents abans de modificar res     │
│                                                             │
│  3. IMPLEMENTAR BACKEND  →  Claude Code (chat directe)     │
│     Escriu l'endpoint, la lògica de lib/, la BD            │
│                                                             │
│  4. IMPLEMENTAR UI  →  @agent_styler (Copilot)             │
│     Genera JSX + CSS respectant el sistema de disseny      │
│                                                             │
│  5. REVISAR QUALITAT  →  /simplify                         │
│     Detecta duplicació i ineficiències en el codi nou      │
│                                                             │
│  6. REVISIÓ FINAL  →  /agent_reviewer [fitxers nous]       │
│     Verifica seguretat i gestió d'errors                   │
│                                                             │
│  7. COMMIT                                                  │
└─────────────────────────────────────────────────────────────┘
```

---

### Casos d'ús concrets

#### A. Afegir una nova feature de trading

1. **Planifica** amb Claude Code: descriu la feature, demana un pla
2. **Backend**: Claude Code implementa `app/api/` i `app/lib/`
3. **Revisió d'errors de trading**: `/agent_reviewer app/api/[nova-ruta]/`  
   → Comprova try/catch a crides Binance, validació de preus
4. **UI**: `@agent_styler [descripció del component nou]` a Copilot Chat
5. **Qualitat**: `/simplify`

#### B. Refactoritzar components de UI existents

1. **Identifica violacions**: `@agent_reviewer app/components/` a Copilot  
   → Detecta badges amb background, hex hardcoded, useEffect infinits
2. **Corregeix disseny**: `@agent_styler corregeix [ComponentName] per seguir el sistema de disseny`
3. **Verifica**: `/agent_reviewer app/components/[NomComponent].tsx`

#### C. Auditoria de seguretat

```
/agent_reviewer app/api/
```
→ Comprova tots els endpoints: autenticació, SQL injection, secrets

Per a una auditoria completa periòdica:
```
/schedule create "auditoria setmanal" 0 9 * * 1 /agent_reviewer
```

#### D. Monitorar la qualitat durant el desenvolupament

```
/loop 5m /agent_reviewer app/lib/trailing-engine.ts
```
→ Re-analitza el fitxer cada 5 minuts mentre es treballa

#### E. Crear una nova pàgina mòbil (`public/www/`)

Copilot no té accés directe als fitxers HTML/JS estàtics, però:
1. Demana a Claude Code que creï l'estructura HTML seguint el patró de `orders.html`
2. Usa `@agent_styler` per als components React del dashboard equivalent

---

### Tokens CSS essencials per recordar

Quan demanes a qualsevol agent que generi UI, pots especificar:

```
Usa els tokens CSS del projecte:
- Fons: var(--bg-card), var(--bg-card-2), var(--bg-page)
- Text: var(--text-1), var(--text-2), var(--text-3)
- Accent: var(--accent), var(--green), var(--red), var(--yellow)
- Vores: var(--border), var(--border-mid)
```

---

## 7. Taula de decisió ràpida

| Tasca | Eina recomanada |
|-------|----------------|
| Revisar codi abans de modificar-lo | `/agent_reviewer` (Claude Code) |
| Revisar en mode chat Copilot | `@agent_reviewer` (Copilot) |
| Crear component UI nou | `@agent_styler` (Copilot) |
| Corregir disseny d'un component existent | `@agent_styler` (Copilot) |
| Implementar lògica de backend/API | Claude Code (chat directe) |
| Revisar qualitat post-canvis | `/simplify` |
| Monitorar periòdicament | `/loop` o `/schedule` |
| Automatitzar revisió en cada edició | `/update-config` amb hook |
| Auditoria de seguretat completa | `/agent_reviewer` (àmbit `app/api/`) |
| Feature amb Claude API / IA generativa | `/claude-api` |
| Revisar trading race conditions | `/agent_reviewer app/lib/` |

---

## Apèndix: estructura dels fitxers d'agent

### Format GitHub Copilot (`.github/agents/`)

```markdown
---
name: nom_agent
description: "Descripció per a la UI de Copilot"
argument-hint: "Hint opcional"
tools: ['read', 'edit', 'grep', 'bash', 'search']
---

[Prompt de l'agent en Markdown]
```

### Format Claude Code Command (`.claude/commands/`)

```markdown
[Prompt de l'agent. Pot usar $ARGUMENTS per l'argument passat.]
```

### Format Claude Code Skill (`.claude/skills/nom/SKILL.md`)

```markdown
---
name: nom-skill
description: "Descripció per al sistema de skills"
allowed-tools: Read Grep Glob Bash Edit
---

[Prompt de la skill. Pot usar $ARGUMENTS.]
```
