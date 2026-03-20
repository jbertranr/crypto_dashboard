/**
 * cleanup-orphans.mjs
 * Elimina les entrades orfenes del journal (sense grup EXIT vinculat),
 * conservant T-0031 i T-0032 (les dues SOL vigents actives).
 *
 * Execució: node scripts/cleanup-orphans.mjs
 * Afegeix --dry-run per veure què eliminaria sense fer res.
 */

import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH   = path.join(__dirname, "../data/cache.db");
const DRY_RUN   = process.argv.includes("--dry-run");

const db = new Database(DB_PATH);

// tradeCodes a conservar sempre (ordres actives)
const KEEP_CODES = ["T-0031", "T-0032"];

// 1. Tots els tradeCodes que tenen almenys un EXIT (grups tancats legítims)
const closedCodes = new Set(
  db.prepare(`SELECT DISTINCT trade_code FROM trade_journal
              WHERE trade_code IS NOT NULL AND type LIKE 'EXIT%'`)
    .all().map(r => r.trade_code)
);

// 2. Tots els orderListIds que tenen almenys un EXIT (grups OCO tancats)
const closedListIds = new Set(
  db.prepare(`SELECT DISTINCT order_list_id FROM trade_journal
              WHERE order_list_id IS NOT NULL AND type LIKE 'EXIT%'`)
    .all().map(r => r.order_list_id)
);

// 3. Tots els orderIds que apareixen en un EXIT (per trailing)
const closedOrderIds = new Set(
  db.prepare(`SELECT DISTINCT order_id FROM trade_journal
              WHERE order_id IS NOT NULL AND type LIKE 'EXIT%'`)
    .all().map(r => r.order_id)
);

// 4. Carreguem totes les entrades que NO són EXIT ni CANCELED amb P&L
const candidates = db.prepare(`
  SELECT id, type, symbol, trade_code, order_list_id, order_id, executed_at
  FROM trade_journal
  WHERE type NOT LIKE 'EXIT%'
`).all();

const toDelete = [];

for (const e of candidates) {
  // Conserva sempre les dues SOL actives
  if (KEEP_CODES.includes(e.trade_code)) continue;

  // Conserva si el tradeCode té un EXIT associat
  if (e.trade_code && closedCodes.has(e.trade_code)) continue;

  // Conserva si el orderListId té un EXIT associat
  if (e.order_list_id && closedListIds.has(e.order_list_id)) continue;

  // Conserva si l'orderId coincideix amb un EXIT (trailing chain)
  if (e.order_id && closedOrderIds.has(e.order_id)) continue;

  toDelete.push(e);
}

console.log(`\nEntrades a eliminar: ${toDelete.length}`);
toDelete.forEach(e =>
  console.log(`  id=${e.id}  type=${e.type.padEnd(14)}  ${e.symbol.padEnd(10)}  tradeCode=${e.trade_code ?? "—"}  listId=${e.order_list_id ?? "—"}  ${new Date(e.executed_at).toLocaleString("ca-ES")}`)
);

if (DRY_RUN) {
  console.log("\n[DRY RUN] No s'ha eliminat res. Treu --dry-run per executar.");
  process.exit(0);
}

if (toDelete.length === 0) {
  console.log("Res a eliminar.");
  process.exit(0);
}

const del = db.prepare("DELETE FROM trade_journal WHERE id = ?");
const deleteAll = db.transaction(() => {
  for (const e of toDelete) del.run(e.id);
});
deleteAll();

console.log(`\n✓ ${toDelete.length} entrades eliminades.`);
