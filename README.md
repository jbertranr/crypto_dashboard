# CryptDesk — Dashboard de Trading de Criptomonedes

Dashboard de trading connectat a Binance (Testnet + Mainnet) amb suport de **paper trading** i **real trading** en paral·lel. Inclou gestió d'ordres, anàlisi tècnica, bots automàtics, trailing stops i notificacions via Telegram.

---

## Documentació

| Fitxer | Contingut |
|--------|-----------|
| [docs/01_architecture.md](docs/01_architecture.md) | Disseny del sistema, ports, seguretat i fluxes de dades |
| [docs/02_api-reference.md](docs/02_api-reference.md) | Tots els endpoints REST amb paràmetres i respostes |
| [docs/03_database-schema.md](docs/03_database-schema.md) | Esquema SQLite complet (3 bases de dades) |
| [docs/04_trading-engine.md](docs/04_trading-engine.md) | Bots, auto-trader, trailing stops, order monitor, scheduler |
| [docs/05_configuration.md](docs/05_configuration.md) | Variables d'entorn i settings de l'aplicació |
| [docs/06_mobile-app.md](docs/06_mobile-app.md) | App pública (public/www), proxy i seguretat |
| [docs/07_deployment.md](docs/07_deployment.md) | Deploy a producció, Oracle, pm2 i rollback |
| [docs/08_integrations.md](docs/08_integrations.md) | Binance API, Telegram Bot i Cloudflare Tunnel |
| [docs/09_development-guide.md](docs/09_development-guide.md) | Guia per developers i agents IA |
| [docs/10_ai-agents.md](docs/10_ai-agents.md) | Agents d'IA: Claude Code, Copilot, skills i flux de treball |

---

## Arrencada ràpida

```bash
# Instal·la dependències
npm install

# Configura credencials
cp .env.local.example .env.local
# edita .env.local

# Arrenca tot (Next.js + servidor públic + túnel Cloudflare)
bash start.sh
```

Accés local: [http://localhost:3000](http://localhost:3000)

---

## Ports

| Port | Servidor | Accés extern |
|------|----------|-------------|
| 3000 | Next.js — dashboard + API completa | ❌ Mai exposat |
| 3001 | `server-public.mjs` — app mòbil + proxy API | ✅ Via Cloudflare Tunnel |

---

## Stack tecnològic

| Capa | Tecnologia |
|------|-----------|
| Framework | Next.js 16 (App Router) + TypeScript 5 |
| UI | React 19 + TailwindCSS 4 |
| Gràfics | Recharts 3 |
| Base de dades | SQLite amb better-sqlite3 |
| Logging | Pino (structured JSON) |
| Exchange | Binance API (Testnet + Mainnet) |
| Notificacions | Telegram Bot API |
| Accés remot | Cloudflare Tunnel |
| Auth | iron-session |

---

## Modes de trading

- **PAPER** (per defecte): opera al Testnet de Binance, sense risc real
- **REAL**: opera al Mainnet de Binance amb diners reals — requereix `BINANCE_API_KEY_REAL` al `.env.local`

El toggle **PAPER | REAL** a la barra lateral controla el mode actiu. Cada bot pot tenir el seu propi mode independent.

Documentació completa: [docs/04_trading-engine.md](docs/04_trading-engine.md)

---

## Llicència

Ús privat. No redistribuir sense permís.
