# Gestió de sessions a Claude Code

## Principi bàsic

**Una sessió = una tasca.** Cada sessió ha de tenir un nom mental clar abans de començar. Si no pots descriure la tasca en una frase, és que és massa gran — divideix-la.

---

## Nomenclatura de sessions

Usa aquest format per identificar cada sessió:

```
[ÀREA] — [ACCIÓ] — [OBJECTE]
```

### Exemples per a aquest projecte

| Nom de sessió | Contingut |
|---------------|-----------|
| `[BUG] — Corregir — entrySource TypeScript` | Resoldre errors de compilació |
| `[FEAT] — Afegir — trailing activation line al chart` | Nova funcionalitat al gràfic |
| `[UI] — Restyling — trailing stop panel` | Canvis visuals d'un component |
| `[REFACTOR] — Moure — Entrada/Sortida a primera columna` | Reorganitzar JSX |
| `[REVIEW] — Revisar — app/api/ seguretat` | Revisió de codi |
| `[FIX] — Validar — preus TP/SL a orders/new` | Correcció puntual |
| `[CONFIG] — Crear — skill agent-reviewer` | Configuració d'eines |
| `[INFRA] — Actualitzar — CLAUDE.md` | Documentació interna |

### Prefixos estàndard

| Prefix | Quan usar-lo |
|--------|--------------|
| `[BUG]` | Corregir un error existent |
| `[FEAT]` | Afegir funcionalitat nova |
| `[UI]` | Canvis visuals / CSS / components |
| `[REFACTOR]` | Reorganitzar codi sense canviar comportament |
| `[FIX]` | Correccions menors (validació, tipus, etc.) |
| `[REVIEW]` | Revisió i diagnosi de codi |
| `[CONFIG]` | Configuració d'eines, skills, settings |
| `[INFRA]` | Scripts, CI, servidors, desplegament |
| `[DOCS]` | Documentació |
| `[PERF]` | Optimització de rendiment |

---

## Cicle de vida d'una sessió

```
1. DEFINIR    → Escriu mentalment el nom de la sessió
2. INICIAR    → Obre Claude Code (o /clear si continuava una altra)
3. TREBALLAR  → Tasques relacionades ÚNICAMENT amb aquest objectiu
4. COMPACTAR  → /compact si la sessió s'allarga (+25 torns)
5. TANCAR     → /clear quan l'objectiu està assolit
```

---

## Quan fer `/clear` (nova sessió)

✅ Quan la tasca actual està **completament acabada**
✅ Quan comences una tasca **no relacionada** amb l'anterior
✅ Al principi de cada dia de treball (context netedat)
✅ Després d'una revisió massiva de codi

❌ No facis `/clear` si has llegit fitxers importants que necessitaràs aviat
❌ No facis `/clear` enmig d'un refactor a mig fer

---

## Quan fer `/compact` (mateixa sessió)

✅ Quan portes +25 torns de conversa
✅ Quan has llegit molts fitxers grans
✅ Quan Claude comença a "oblidar" decisions prèvies
✅ Cada vegada que canvies de subtasca dins la mateixa sessió

Exemple amb instrucció preservadora:
```
/compact recorda: estem al [FEAT] trailing activation line,
ja hem modificat OcoProgressChart.tsx i OrdersPanel.tsx,
el pròxim pas és ajustar el CSS
```

---

## Sessions tipus per a aquest projecte

### Sessió de revisió setmanal
```
[REVIEW] — Revisió general — codi i seguretat
```
1. Executa `/agent-reviewer`
2. Prioritza els crítics 🔴
3. Crea una sessió `[FIX]` per a cada grup de correccions

---

### Sessió de nova funcionalitat
```
[FEAT] — Afegir — [nom de la funcionalitat]
```
1. Explica l'objectiu en 1–2 frases
2. Fes-ho en ordre: lògica backend → API route → component React → CSS
3. Comprova amb `npx tsc --noEmit` al final

---

### Sessió de correcció de bugs
```
[BUG] — Corregir — [descripció del bug]
```
1. Explica el comportament actual vs. l'esperat
2. Adjunta logs o captures si en tens
3. No amplies l'abast — corregeix NOMÉS el bug

---

### Sessió de UI / estils
```
[UI] — [Restyling/Afegir/Corregir] — [component]
```
1. Claude llegirà `globals.css` i `dashboard.css` automàticament (agent_styler)
2. Adjunta captures si descrius problemes visuals
3. Verifica a la pantalla real abans de tancar la sessió

---

## Plantilla d'inici de sessió

Copia i adapta quan comences una sessió nova:

```
Sessió: [PREFIX] — [ACCIÓ] — [OBJECTE]

Objectiu: [Una frase clara de què volem aconseguir]

Context rellevant:
- [Fitxers afectats]
- [Restriccions o decisions prèvies]
- [Estat actual del problema]

Criteri d'èxit: [Com sabré que la sessió ha acabat bé]
```

### Exemple real
```
Sessió: [FEAT] — Afegir — activació trailing al gràfic OCO

Objectiu: Mostrar una línia horitzontal discontínua al chart
que indiqui el preu d'activació del trailing stop.

Context rellevant:
- Fitxers: OcoProgressChart.tsx, OrdersPanel.tsx
- sugg.activateAt conté el preu d'activació
- La línia ha d'aparèixer des del punt d'entrada

Criteri d'èxit: La línia "Trail" apareix al gràfic
en les ordres OCO amb trailing configurat
```

---

## Resum visual

```
CADA DIA
  └── /clear al matí (pissarra neta)
       └── Sessió 1: [PREFIX] — tasca A
            ├── /compact si s'allarga
            └── /clear quan acaba
       └── Sessió 2: [PREFIX] — tasca B
            └── ...
```
