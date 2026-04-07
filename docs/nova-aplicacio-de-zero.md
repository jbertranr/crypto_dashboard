# Com iniciar una nova aplicació de zero amb Claude Code

## Visió general del procés

```
FASE 1: DEFINICIÓ     → Saps QUÈ vols construir
FASE 2: ARQUITECTURA  → Saps COM ho construiràs
FASE 3: ARRENCADA     → El projecte existeix i compila
FASE 4: ITERACIÓ      → Afegeixes funcionalitats
FASE 5: QUALITAT      → El codi és robust i mantenible
```

Cada fase és una sessió Claude independent.

---

## FASE 1 — Definició del producte

**Sessió:** `[DOCS] — Definir — arquitectura i requisits`

### Què fer primer (sense Claude)
Abans d'obrir Claude Code, respon per escrit:

1. **Problema**: Quin problema resol l'aplicació?
2. **Usuaris**: Qui l'usarà? (tu sol, equip, públic)
3. **Stack**: Quines tecnologies coneixes / vols usar?
4. **Integracions**: APIs externes, bases de dades, serveis?
5. **Plataformes**: Web, mòbil, CLI, API?

### Aleshores demana a Claude un pla
```
Sessió: [DOCS] — Definir — arquitectura nova app

Vull construir [descripció breu].
Stack preferit: [Next.js / Node / Python / etc.]
Integracions: [Binance API / SQLite / Telegram / etc.]
Usuaris: [jo sol / equip / públic]

Crea'm un document d'arquitectura amb:
- Estructura de directoris
- Stack recomanat i justificació
- Esquema de base de dades (si cal)
- Endpoints API principals
- Components UI principals
- Decisions tècniques clau
```

Claude generarà un document `.md` que servirà com a **nord del projecte**.

---

## FASE 2 — Creació del Pla

**Sessió:** `[CONFIG] — Crear — pla d'implementació`

### Usa el mode Pla de Claude Code

El mode Pla (`/plan` o `EnterPlanMode`) permet definir els passos d'implementació abans de tocar codi. Claude presenta el pla i **espera la teva aprovació** abans d'executar res.

```
Sessió: [CONFIG] — Crear — pla implementació [nom app]

Basant-te en el document d'arquitectura que hem creat,
crea un pla d'implementació pas a pas:

Fase 1: Estructura base i configuració
Fase 2: Backend (API routes + base de dades)
Fase 3: Frontend (components principals)
Fase 4: Integracions externes
Fase 5: Tests i qualitat

Per a cada fase, indica:
- Fitxers a crear
- Dependències a instal·lar
- Ordre d'implementació
```

El pla es guarda a `.claude/plans/`. Pots referenciar-lo en sessions futures.

---

## FASE 3 — Arrencada del projecte

### 3a. Configura el CLAUDE.md PRIMER

Abans de crear cap fitxer de codi, crea el `CLAUDE.md`:

```markdown
# [Nom de l'app] — Guia per a Claude

## Arrencada
[comandes per arrencar l'app]

## Arquitectura
[descripció breu de l'estructura]

## Convencions
[patrons de codi, nomenclatura, etc.]

## Notes importants
[decisions tècniques, restriccions, etc.]
```

Aquest fitxer s'envia automàticament a Claude en cada sessió.
**És la memòria permanent del projecte.**

---

### 3b. Sessió d'arrencada

**Sessió:** `[INFRA] — Crear — estructura base del projecte`

```
Crea l'estructura base de l'aplicació seguint el pla:
- Inicialitza [Next.js / Node / etc.]
- Crea l'estructura de directoris
- Configura TypeScript, ESLint, etc.
- Instal·la les dependències principals
- Verifica que compila sense errors
```

**Criteri d'èxit:** `npm run dev` funciona i no hi ha errors TypeScript.

---

## FASE 4 — Iteració amb sessions

Cada funcionalitat = una sessió amb nom clar.

### Ordre recomanat per a cada funcionalitat

```
1. [INFRA]   → Base de dades / esquema
2. [FEAT]    → Lògica de negoci (lib/)
3. [FEAT]    → Endpoint API (api/route.ts)
4. [UI]      → Component React
5. [UI]      → Estils CSS
6. [FIX]     → Correccions i validacions
```

### Exemple real
```
Sessió 1: [INFRA] — Crear — taula orders a SQLite
Sessió 2: [FEAT] — Implementar — lògica OCO (binance-auth.ts)
Sessió 3: [FEAT] — Crear — endpoint POST /api/orders/new
Sessió 4: [UI]   — Crear — component OrderCard
Sessió 5: [UI]   — Estilitzar — OrderCard (dashboard.css)
Sessió 6: [FIX]  — Validar — preus TP/SL a orders/new
```

---

## FASE 5 — Qualitat i manteniment

### Agents propis (skills del projecte)

Crea skills específiques per al teu projecte a `.claude/skills/`:

**`/agent-reviewer`** — Revisió de codi
```
/agent-reviewer          ← revisió completa
/agent-reviewer app/api/ ← revisió parcial
```

**`/agent-styler`** — Consistència visual (si tens sistema de disseny)
```
/agent-styler
```

Com crear un nou skill:
```
.claude/skills/[nom-skill]/SKILL.md
```

---

### Agents externs (`.github/agents/`)

Per a agents que Claude usa com a **context automàtic** (no els invoca l'usuari):

```markdown
---
name: agent_styler
description: "Guia de disseny per a components UI..."
tools: ['read', 'edit', 'search']
---

[instruccions que Claude seguirà automàticament]
```

Exemples útils:
- `agent_styler.md` → Enforça el sistema de disseny CSS
- `agent_tester.md` → Convencions de tests
- `agent_security.md` → Checklist de seguretat per a endpoints

---

### Skills globals disponibles sempre

| Skill | Quan usar-la |
|-------|--------------|
| `/agent-reviewer` | Revisió setmanal de codi |
| `/simplify` | Neteja de codi recent |
| `/compact` | Sessió llarga (+25 torns) |
| `/batch` | Refactors grans en paral·lel |
| `/loop 5m /agent-reviewer` | Revisió periòdica automàtica |

---

## Estructura de fitxers recomanada per al projecte

```
nova-app/
├── CLAUDE.md                    ← OBLIGATORI, primer fitxer a crear
├── .claude/
│   ├── settings.json            ← Permisos de Claude Code
│   ├── skills/
│   │   ├── agent-reviewer/
│   │   │   └── SKILL.md
│   │   └── [altres skills]/
│   │       └── SKILL.md
│   └── plans/                   ← Plans generats per Claude
├── .github/
│   └── agents/
│       ├── agent_styler.md      ← Context automàtic per a UI
│       └── agent_reviewer.md    ← Context per a revisió
├── docs/
│   ├── arquitectura.md          ← Document de la Fase 1
│   ├── gestio-sessions.md       ← Metodologia de treball
│   └── optimitzar-tokens.md     ← Gestió del context
├── app/                         ← Codi de l'aplicació
└── logs/                        ← Logs del servidor
```

---

## Memòria persistent: els 3 nivells

```
CLAUDE.md          ← Projecte: sempre present, manual
.claude/memory/    ← Auto-memòria: preferències i patrons detectats
docs/*.md          ← Documentació: consultable sota demanda
```

### Quan usar cada nivell

| Tipus d'informació | On guardar |
|--------------------|-----------|
| Arquitectura del projecte | `CLAUDE.md` |
| Comandes d'arrencada | `CLAUDE.md` |
| Decisions tècniques permanents | `CLAUDE.md` |
| Preferències de treball | auto-memòria (automàtic) |
| Guies i tutorials | `docs/*.md` |
| Plans d'implementació | `.claude/plans/` |

---

## Checklist d'inici de projecte

```
□ Document d'arquitectura creat (Fase 1)
□ Pla d'implementació aprovat (Fase 2)
□ CLAUDE.md creat amb estructura i convencions
□ settings.json configurat amb permisos necessaris
□ Estructura base creada i compilant
□ Skill /agent-reviewer creada
□ Agent de context (agent_styler.md) si hi ha sistema de disseny
□ docs/ amb guies de sessions i tokens
□ Primera sessió de revisió passada sense crítics 🔴
```

---

## Errors habituals a evitar

| Error | Solució |
|-------|---------|
| Començar a codificar sense pla | Sempre Fase 1 → 2 → 3 |
| CLAUDE.md buit o inexistent | Emplenar-lo ABANS de la primera sessió de codi |
| Sessions massa llargues amb múltiples objectius | Una sessió = una tasca |
| No fer `/compact` en sessions llargues | Cada 25 torns aproximadament |
| Crear skills però no usar-les | Programa una revisió setmanal amb `/agent-reviewer` |
| Acumular deute tècnic | `/simplify` i `/agent-reviewer` regularment |
