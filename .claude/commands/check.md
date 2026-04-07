Ets un orquestrador de qualitat per al projecte CryptDesk. El teu objectiu és analitzar l'estat actual i decidir automàticament quines comprovacions cal fer — l'usuari no ha de pensar-ho.

## Pas 1 — Detecta l'estat actual

Executa:
```bash
cd "c:/Users/jbert/claude/crypto_dashboard" && git diff --name-only HEAD 2>/dev/null; git diff --name-only --cached 2>/dev/null; git status --short 2>/dev/null | awk '{print $2}'
```

Classifica cada fitxer modificat en categories:
- **API** → `app/api/**`
- **LIB** → `app/lib/**`
- **COMPONENT** → `app/components/**`
- **CSS** → `app/styles/**` o `*.css`
- **MÒBIL** → `public/www/**`
- **CONFIG** → `*.json`, `*.ts` a l'arrel, `middleware.ts`

Si no hi ha fitxers modificats (HEAD net), revisa tot el projecte.

Si s'ha passat un argument (`$ARGUMENTS`), limita l'anàlisi a aquell fitxer o directori.

---

## Pas 2 — Executa les comprovacions rellevants

### Sempre (independentment dels fitxers)
```bash
cd "c:/Users/jbert/claude/crypto_dashboard" && npx tsc --noEmit 2>&1 | head -40
```
```bash
cd "c:/Users/jbert/claude/crypto_dashboard" && npm run lint 2>&1 | head -40
```

### Si hi ha fitxers API o LIB modificats → Revisió de seguretat i trading

Per cada fitxer `app/api/**/route.ts` modificat, comprova:
- Que importi `getIronSession` (excepte `auth/login` i `auth/logout`)
- Que les crides a Binance (`placeOcoOrder`, `placeMarketBuy`, `cancelOcoOrder`, `getTickerPrice`) estiguin dins `try/catch`
- Que els errors es propaguin via `apiError()`

Per fitxers `app/lib/`:
- Cerca `.then(` sense `.catch(` — promises no capturades
- Si és `trailing-engine.ts`, comprova protecció contra activació concurrent

### Si hi ha fitxers COMPONENT o CSS modificats → Revisió de disseny

Per cada component `.tsx` modificat:
- `useEffect(` sense segon argument → risc d'execució infinita
- `.map(` sense `key=` estable
- Importacions de `binance-auth`, `better-sqlite3`, `cache-store` → lògica de negoci al lloc incorrecte

Per fitxers CSS:
- Hex directes fora dels tokens aprovats: `#0f172a #475569 #94a3b8 #e2e8f0 #cbd5e1 #f8fafc #f1f5f9 #4f46e5 #059669 #dc2626 #2563eb #d97706 #b91c1c #4338ca #16a34a #ffffff #fff #4338ca rgba(79,70,229,0.08) rgba(5,150,105,0.08) rgba(220,38,38,0.07) rgba(37,99,235,0.08) rgba(217,119,6,0.12)`
- Badges amb `background` + `border` + `border-radius` conjuntament → violació del sistema de disseny
- `border-radius` > 8px en cards de contingut (12px reservat per a modals)

---

## Pas 3 — Genera el report consolidat

```markdown
# Informe CryptDesk — [data]

## Fitxers analitzats
[llista de fitxers modificats per categoria]

## TypeScript / ESLint
[✅ o errors trobats]

## 🔴 Crític
[problemes que requereixen acció immediata]

## 🟡 Advertència
[problemes importants però no urgents]

## 🔵 Informatiu
[millores de qualitat opcionals]

## ✅ Tot correcte
[categories sense problemes]

---

## Recomanació d'acció
[Una o dues frases: què hauria de fer l'usuari ara — res si tot és correcte]
```

La secció **"Recomanació d'acció"** és la més important: ha de ser concreta i accionable. Exemples:
- "Afegeix `try/catch` a `placeOcoOrder` a `orders/new/route.ts:34` i verifica la validació de preus."
- "El component `OrdersPanel` té un `useEffect` sense dependències a la línia 87 — afegeix `[]`."
- "Tot correcte. Pots fer commit."
- "Per a la UI, recorda demanar `@agent_styler` a Copilot si cal crear components nous."

**Important**: Mai modifiquis cap fitxer. El teu output és exclusivament l'informe.
