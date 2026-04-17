# 10 — Agents i eines d'IA

CryptDesk té un ecosistema d'agents d'IA configurat per a dos entorns: **Claude Code** (CLI + extensió VS Code) i **GitHub Copilot** (mode agèntic). Cada agent té un rol específic i no s'han de barrejar.

---

## Mapa general

```
CryptDesk — Eines d'IA
│
├── Claude Code  (CLI / extensió VS Code)
│   ├── CLAUDE.md                            ← Context del projecte (sempre carregat)
│   ├── Commands (slash)
│   │   ├── .claude/commands/check.md        → /check
│   │   └── .claude/commands/agent_reviewer.md → /agent_reviewer
│   ├── Skills del projecte
│   │   └── .claude/skills/agent-reviewer/SKILL.md
│   └── Skills globals del sistema
│       ├── /simplify      ← revisió de qualitat post-edició
│       ├── /check         ← orquestrador de qualitat (context-aware)
│       ├── /loop          ← tasques recurrents mentre la sessió és oberta
│       ├── /schedule      ← agents remots amb cron
│       ├── /update-config ← configuració de hooks automàtics
│       ├── /keybindings-help
│       └── /claude-api
│
└── GitHub Copilot  (VS Code, mode Agèntic)
    ├── .github/agents/agent_reviewer.md    → @agent_reviewer
    ├── .github/agents/agent_styler.md      → @agent_styler
    └── .github/agents/check.md             → @check
```

---

## Punt d'entrada únic: `/check`

Per a la majoria de casos, **un sol comando** és suficient:

```
/check
```

L'agent `/check` detecta automàticament quins fitxers s'han modificat i decideix quines comprovacions fer. No cal saber quin agent usar ni quin àmbit analitzar.

| Eina | Comando | Equivalent |
|------|---------|-----------|
| Claude Code | `/check` | Sempre. Detecció automàtica de context |
| GitHub Copilot | `@check` | Equivalent des del chat de Copilot |

---

## Fitxers de definició dels agents

### Ubicació i format

| Fitxer | Eina | Propòsit |
|--------|------|---------|
| `.claude/commands/check.md` | Claude Code | Orquestrador de qualitat (`/check`) |
| `.claude/commands/agent_reviewer.md` | Claude Code | Revisió de codi (`/agent_reviewer`) |
| `.claude/skills/agent-reviewer/SKILL.md` | Claude Code | Skill de revisió (invocable programàticament) |
| `.github/agents/agent_reviewer.md` | GitHub Copilot | Revisió de codi (`@agent_reviewer`) |
| `.github/agents/agent_styler.md` | GitHub Copilot | Implementació UI (`@agent_styler`) |
| `.github/agents/check.md` | GitHub Copilot | Orquestrador (`@check`) |
| `CLAUDE.md` | Claude Code | Context persistent del projecte |

---

## Agents disponibles

### `/check` — Orquestrador de qualitat

**Fitxer:** `.claude/commands/check.md`  
**Eina:** Claude Code  
**Modifica fitxers:** ❌ No

L'agent més important del flux de treball. Analitza l'estat del repositori i decideix automàticament quines comprovacions fer:

```
Pas 1 → git diff → classifica fitxers modificats (API / LIB / COMPONENT / CSS / MÒBIL)
Pas 2 → executa TypeScript + ESLint sempre
Pas 3 → si API o LIB: revisa try/catch a Binance, promises no capturades
Pas 4 → si COMPONENT o CSS: revisa useEffect infinits, violations de disseny
Pas 5 → genera report consolidat amb recomanació d'acció concreta
```

**Ús:**
```
/check                    # analitza tot el que ha canviat
/check app/lib/           # limita l'anàlisi a un directori
```

**Output:** informe Markdown amb seccions 🔴 Crític / 🟡 Advertència / 🔵 Informatiu + **Recomanació d'acció** concreta.

---

### `/agent_reviewer` — Revisió de codi

**Fitxers:** `.claude/commands/agent_reviewer.md` + `.claude/skills/agent-reviewer/SKILL.md`  
**Eina:** Claude Code  
**Modifica fitxers:** ❌ No

Revisió exhaustiva del projecte en 5 passos:

| Pas | Categoria | Què comprova |
|-----|-----------|-------------|
| 1 | Anàlisi estàtica | `tsc --noEmit` + ESLint |
| 2a | Seguretat | Endpoints sense `getIronSession` (auth) |
| 2b | Seguretat | Secrets de servidor en components `"use client"` |
| 2c | Seguretat | SQL injection (interpolació vs paràmetres `?`) |
| 3a | Trading — crític | Crides a Binance sense `try/catch` |
| 3b | Trading — crític | `.then()` sense `.catch()` (promises no capturades) |
| 3c | Trading — crític | Validació de preus (TP > preu, SL < preu, NaN, ≤ 0) |
| 3d | Trading — crític | Activació concurrent del trailing (idempotència) |
| 4 | React/Next.js | `useEffect` infinits, `.map()` sense `key`, fetch en loops |
| 5 | Arquitectura | Inversió de deps, lògica de negoci en components, hex hardcoded |

**Ús:**
```
/agent_reviewer                               # tot el projecte
/agent_reviewer app/api/                      # àmbit: directori
/agent_reviewer app/lib/trailing-engine.ts    # fitxer concret
```

---

### `@agent_reviewer` — Revisió de codi (Copilot)

**Fitxer:** `.github/agents/agent_reviewer.md`  
**Eina:** GitHub Copilot (Mode Agèntic)  
**Modifica fitxers:** ❌ No

Equivalent funcional de `/agent_reviewer` per a GitHub Copilot. Mateixa lògica de revisió en 5 passos. Útil quan es treballa des del chat de Copilot sense obrir Claude Code.

**Ús:**
```
@agent_reviewer                          # revisió completa
@agent_reviewer app/lib/order-monitor.ts # un fitxer
@agent_reviewer app/api/                 # tots els endpoints
```

**Diferència respecte a Claude Code:** Claude Code pot executar `tsc` i `lint` directament i llegir el resultat en temps real. Copilot delega en l'extensió de VS Code.

---

### `@agent_styler` — Implementació d'UI

**Fitxer:** `.github/agents/agent_styler.md`  
**Eina:** GitHub Copilot (Mode Agèntic)  
**Modifica fitxers:** ✅ Sí (components `.tsx` i `dashboard.css`)

Agent especialitzat en la generació de JSX + CSS que respecta estrictament el sistema de disseny **Indigo Fintech** del projecte. És l'únic agent que escriu codi de UI.

#### Principis del sistema de disseny que enforça

| Regla | Detall |
|-------|--------|
| **Color escàs** | Color ÚNICAMENT per a: icones d'estat, valors +/−, franja superior de card, pills de % |
| **Tokens CSS obligatoris** | Mai hex directe. Sempre `var(--accent)`, `var(--green)`, `var(--text-1)`… |
| **Badges text-only** | Prohibit `background + border` en badges d'estat |
| **Cards** | `border-radius ≤ 8px`. Reservat `12px` per a modals |
| **BEM** | Naming `block__element--modifier`. Un sol CSS: `dashboard.css` |
| **Tipografia** | Inter (cos) + JetBrains Mono per a preus i quantitats (`.mono`) |

#### Patrons de components que coneix

| Classe | Propòsit |
|--------|---------|
| `portfolio__card` | Stat cards amb franja de color superior |
| `jcell` / `jcell--right` / `jcell--icon` | Cel·les de dues línies (taules denses) |
| `metric-row` | Fila amb franja d'accent semàntic (`--row-color`) |
| `pct-pill` | L'únic pill permès (fons transparent, sense vora) |
| `signal` / `signal__dot` | Indicadors d'estat amb punt de color |
| `data-row` | Files de llista (hover sobre fons transparent) |
| `btn-primary` / `btn-secondary` / `btn-danger` | Botons estandarditzats |

**Ús:**
```
@agent_styler nova pestanya d'Alertes que mostri alertes de preu activades
@agent_styler afegir columna "Durada" a la taula del journal
@agent_styler convertir el panel de riscos a grid de metric-rows
```

**Pre-flight checklist** que executa automàticament:
- [ ] Pàgina obre amb `portfolio__cards` (3 stat cards)
- [ ] Títols de secció usen `portfolio__section-title`
- [ ] Zero badges amb background + border
- [ ] Valors monetaris amb classe `.mono`
- [ ] Cap hex directe al CSS
- [ ] `npx tsc --noEmit` passa sense errors

---

### Skills globals del sistema

| Skill | Quan usar-la |
|-------|-------------|
| `/simplify` | Després de fer canvis. Detecta duplicació, abstraccions prematures, ineficiències |
| `/loop N /cmd` | Executa un command cada N minuts mentre la sessió és oberta |
| `/schedule` | Crea agents remots amb cron (s'executen sense la sessió oberta) |
| `/update-config` | Configura hooks a `settings.json` (ex: revisar en cada edició d'un fitxer) |
| `/claude-api` | S'activa automàticament si el codi importa `anthropic` o `@anthropic-ai/sdk` |

---

## Flux de treball recomanat

```
┌─────────────────────────────────────────────────────────────────┐
│  1. PLANIFICAR     → Claude Code (chat directe)                 │
│     Descriu la feature, demana un pla d'implementació           │
│                                                                 │
│  2. REVISAR ESTAT  → /check (o @check)                          │
│     Detecta problemes existents abans de modificar res          │
│                                                                 │
│  3. IMPLEMENTAR    → Claude Code (chat directe)                 │
│     Backend: endpoints, app/lib/, migracions de BD              │
│                                                                 │
│  4. UI             → @agent_styler (Copilot)                    │
│     JSX + CSS respectant el sistema de disseny Indigo Fintech   │
│                                                                 │
│  5. QUALITAT       → /simplify                                  │
│     Detecta duplicació i ineficiències en el codi nou           │
│                                                                 │
│  6. REVISIÓ FINAL  → /check (o /agent_reviewer [fitxers nous])  │
│     Verifica seguretat, gestió d'errors, trading race conditions│
│                                                                 │
│  7. COMMIT                                                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Casos d'ús concrets

### Afegir una nova feature de trading

```
1. Claude Code: "Vull afegir alertes de preu per OCO" → pla d'implementació
2. Claude Code: implementa app/api/ + app/lib/
3. /agent_reviewer app/api/[nova-ruta]/  → comprova try/catch, validació preus
4. @agent_styler component d'alertes al dashboard
5. /simplify
```

### Auditoria de seguretat

```
/agent_reviewer app/api/
```
Comprova tots els endpoints: autenticació, SQL injection, secrets exposats.

Per a auditoria periòdica automàtica:
```
/schedule create "auditoria setmanal" 0 9 * * 1 /agent_reviewer
```

### Monitorar errors durant el desenvolupament

```
/loop 5m /agent_reviewer app/lib/trailing-engine.ts
```
Re-analitza el fitxer cada 5 minuts mentre es treballa en ell.

### Revisar disseny d'un component existent

```
@agent_reviewer app/components/OrdersPanel.tsx   → identifica violacions
@agent_styler corregeix OrdersPanel per seguir el sistema de disseny
```

---

## Taula de decisió ràpida

| Tasca | Eina |
|-------|------|
| Revisar abans de modificar | `/check` |
| Revisar en mode Copilot | `@check` |
| Revisió exhaustiva d'un fitxer | `/agent_reviewer [fitxer]` |
| Crear component UI nou | `@agent_styler` (Copilot) |
| Corregir disseny existent | `@agent_styler` (Copilot) |
| Implementar lògica backend/API | Claude Code (chat directe) |
| Revisar qualitat post-canvis | `/simplify` |
| Repetir revisió periòdicament | `/loop` |
| Revisió automàtica sense sessió | `/schedule` |
| Automatitzar en cada edició | `/update-config` + hook |
| Feature amb Claude API / IA | `/claude-api` |

---

## Crear nous agents

### Format GitHub Copilot (`.github/agents/`)

```markdown
---
name: nom_agent
description: "Descripció per a la UI de Copilot"
argument-hint: "Hint de l'argument opcional"
tools: ['read', 'edit', 'grep', 'bash', 'search']
---

[Prompt de l'agent en Markdown]
```

### Format Claude Code Command (`.claude/commands/`)

```markdown
[Prompt de l'agent. Usa $ARGUMENTS per a l'argument passat.]
```

### Format Claude Code Skill (`.claude/skills/nom/SKILL.md`)

```markdown
---
name: nom-skill
description: "Descripció per al sistema de skills"
allowed-tools: Read Grep Glob Bash Edit
---

[Prompt de la skill. Usa $ARGUMENTS.]
```

---

## `CLAUDE.md` — Context persistent

El fitxer `CLAUDE.md` a l'arrel del projecte es carrega automàticament en cada sessió de Claude Code. Conté:

- Instruccions d'arrencada del sistema (`start.sh`, ports, background)
- Arquitectura de seguretat (ports 3000/3001, Cloudflare)
- Estructura del projecte
- Notes sobre trading real (Mainnet)

**Regla:** qualsevol instrucció a `CLAUDE.md` té prioritat sobre les instruccions en la conversa. Si un agent i `CLAUDE.md` entren en conflicte, guanya `CLAUDE.md`.

Quan cal actualitzar `CLAUDE.md`: si canvia l'arquitectura, els scripts d'arrencada, o les convencions del projecte.

---

## Memòria persistent entre sessions

Claude Code té un sistema de memòria persistent a:

```
C:\Users\jbert\.claude\projects\c--Users-jbert-claude-crypto-dashboard\memory\
```

Els fitxers de memòria s'organitzen per tipus:
- `user_*.md` — Perfil i preferències de l'usuari
- `feedback_*.md` — Correccions i validacions de comportament
- `project_*.md` — Context del projecte (servidor de producció, decisions tècniques)
- `reference_*.md` — Punteres a recursos externs
- `MEMORY.md` — Índex de tota la memòria (carregat automàticament)

Aquesta memòria permet que futures sessions de Claude Code tinguin context sobre el projecte sense haver de re-explicar res.
