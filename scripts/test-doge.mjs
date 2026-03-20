import { readFileSync } from "fs";
const buf = readFileSync(0, "utf8");
const d = JSON.parse(buf);
const s = (d.strategies || []).find(x => x.active && x.type !== "bearish");
console.log("price:", d.price, "verdict:", d.verdict, "score:", d.score);
if (s) console.log("strat:", s.name, "\ntp:", s.tp, "\nsl:", s.sl);
else console.log("cap estratègia bullish activa");
