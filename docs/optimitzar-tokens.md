# Optimitzar l'ús de tokens a Claude Code

## El problema

Claude Code consumeix tokens en cada missatge: tot el context de la conversa (historial, fitxers llegits, resultats d'eines) s'envia a cada torn. Com més llarga és la sessió, més tokens es consumeixen per missatge.

---

## Estratègies per allargar la sessió

### 1. `/compact` — La més important

Comprimeix tota la conversa en un resum breu. Usa-la quan:
- La sessió porta més de 30–40 intercanvis
- Has llegit molts fitxers grans
- Veus que les respostes es tornen lentes o menys precises

```
/compact
```

Pots afegir instruccions per preservar context clau:
```
/compact recorda que estem refactoritzant el trailing engine i que no hem de tocar orders/new
```

---

### 2. `/clear` — Nova pissarra

Esborra tot l'historial. Usa-la quan:
- Acabes una tasca i en comences una de nova no relacionada
- Vols assegurar-te que Claude no arrossega context incorrecte

```
/clear
```

---

### 3. Llegir fitxers amb precisió

**Malament** — llegeix tot el fitxer (molts tokens):
> "mira el fitxer OrdersPanel.tsx"

**Bé** — demana la part concreta:
> "mira les línies 600–650 d'OrdersPanel.tsx"
> "busca la funció `fetchOpen` a OrdersPanel.tsx"

Claude té eines `Grep` i `Glob` per localitzar primer, i `Read` amb `offset`/`limit` per llegir només el que cal.

---

### 4. Tasques atòmiques, sessions curtes

En lloc d'una sessió llarga amb 10 tasques:
- Fes `/clear` entre tasques no relacionades
- Cada sessió hauria de tenir **un objectiu clar**

Exemple:
```
Sessió 1: corregir errors TypeScript
/clear
Sessió 2: afegir nova funcionalitat al chart
```

---

### 5. Mode Fast (`/fast`)

Activa el mode ràpid que optimitza per a velocitat. Ideal per a:
- Tasques repetitives (correccions menors, formatació)
- Preguntes ràpides sobre codi

```
/fast
```

Desactiva'l per a tasques complexes que requereixen raonament profund.

---

### 6. CLAUDE.md — Evita explicar el projecte cada vegada

Un bon `CLAUDE.md` evita que hagis d'explicar l'arquitectura a cada sessió nova. Claude el llegeix automàticament.

Inclou-hi:
- Estructura del projecte
- Patrons i convencions
- Decisions d'arquitectura importants
- Comandes d'inici habituals

---

### 7. Agents en background per a tasques llargues

Per a tasques que requereixen llegir molts fitxers (com `/agent-reviewer`), els agents s'executen en un context separat i no contaminen la sessió principal.

```
/agent-reviewer app/api/
```

Això preserva el teu context principal intacte.

---

### 8. Evita adjuntar fitxers grans innecessàriament

Quan fas una pregunta, no passis fitxers sencers si no cal. En lloc de:
> "aquí tens el fitxer complet, que en penses?"

Millor:
> "a `app/lib/trailing-engine.ts`, la funció `runCycle` té un problema de race condition?"

Claude trobarà i llegirà exactament el que necessita.

---

## Senyals d'alerta

- Les respostes es tornen genèriques o imprecises → **fes `/compact`**
- Claude "oblida" decisions prèvies → context massa llarg → **fes `/compact`**
- Missatge d'error de límit → espera el reset (cada 5h) o continua l'endemà

---

## Resum ràpid

| Situació | Acció |
|----------|-------|
| Sessió llarga (+30 torns) | `/compact` |
| Nova tasca no relacionada | `/clear` |
| Tasques simples/ràpides | `/fast` |
| Llegir codi | Especifica línies o funcions concretes |
| Explicar arquitectura | Manté `CLAUDE.md` actualitzat |
| Tasca de revisió massiva | Usa agents (`/agent-reviewer`) |
