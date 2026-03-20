"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import type { SimConfig, SimStats, ExitMode, EntryMode, CapitalMode } from "../api/simulation/run/route";
import {
  PARAM_DEFS, metricValue,
  createAdaptiveSampler, adaptiveSample, buildDefaultRanges,
} from "../lib/sim-optimizer";

/* ── Constants ──────────────────────────────────────────────────────────────── */

const WARMUP_ITERS = 3;   // iterations per archetype in phase 1
const TOP_K_PCT    = 0.20; // fraction of pool to refine in phase 2

const ALL_EXITS:    ExitMode[]    = ["TRAILING", "BREAK_EVEN", "LET_RUN", "MOON"];
const ALL_ENTRIES:  EntryMode[]   = ["ANALYSIS", "PUMP", "CANDLES"];
const ALL_INTERVALS                = ["15m", "1h", "4h", "1d"] as const;
const ALL_CAP_MODES: CapitalMode[] = ["FIXED", "PCT", "RISK_PCT", "ANTI_MARTINGALE"];

/* ── Types ─────────────────────────────────────────────────────────────────── */

interface SavedConfig {
  id: string; name: string; savedAt: string; config: SimConfig;
}

interface Archetype {
  key:        string;
  symbol:     string;
  exitMode:   ExitMode;
  entryMode:  EntryMode;
  interval:   string;
  capitalMode: CapitalMode;
}

interface ArchResult {
  key:          string;
  symbol:       string;
  exitMode:     ExitMode;
  entryMode:    EntryMode;
  interval:     string;
  capitalMode:  CapitalMode;
  phase:        "warmup" | "refining" | "validating" | "done" | "error";
  analysisPnl:  number | null;
  valPnl:       number | null;
  profitFactor: number | null;
  maxDrawdown:  number | null;
  totalTrades:  number | null;
  promoted:     boolean;
  promotedName?: string;
  error?:       string;
}

interface LogLine {
  t: string; msg: string; level: "info" | "ok" | "warn" | "error";
}

/* ── Helpers ────────────────────────────────────────────────────────────────── */

function parseDate(s: string): number {
  const d = new Date(s); return isNaN(d.getTime()) ? NaN : d.getTime();
}
function fmt2(n: number | null): string {
  return n === null ? "—" : n.toFixed(2);
}
function nowStr(): string {
  return new Date().toLocaleTimeString("ca-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function parseSymbols(raw: string): string[] {
  return raw.split(/[\s,;]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
}

/* ── Component ──────────────────────────────────────────────────────────────── */

export default function AutoLabTab() {
  const [configs,   setConfigs]   = useState<SavedConfig[]>([]);
  const [baseId,    setBaseId]    = useState<string>("");

  const [aFrom,     setAFrom]     = useState("2023-01-01");
  const [aTo,       setATo]       = useState("2024-12-31");
  const [bFrom,     setBFrom]     = useState("2025-01-01");
  const [bTo,       setBTo]       = useState("2025-12-31");

  const [totalIter, setTotalIter] = useState(100);
  const [budgetU,   setBudgetU]   = useState(100);

  const [symbolsRaw, setSymbolsRaw] = useState("");

  const [selExits,    setSelExits]    = useState<Set<ExitMode>>(new Set(ALL_EXITS));
  const [selEntries,  setSelEntries]  = useState<Set<EntryMode>>(new Set(ALL_ENTRIES));
  const [selTfs,      setSelTfs]      = useState<Set<string>>(new Set(["1h", "4h"]));
  const [selCapModes, setSelCapModes] = useState<Set<CapitalMode>>(new Set(["FIXED", "PCT"]));

  const [minPnl,      setMinPnl]      = useState(30);
  const [minPF,       setMinPF]       = useState(1.3);
  const [maxDD,       setMaxDD]       = useState(35);
  const [autoPromote, setAutoPromote] = useState(true);

  const [running,  setRunning]  = useState(false);
  const [results,  setResults]  = useState<ArchResult[]>([]);
  const [log,      setLog]      = useState<LogLine[]>([]);

  const abortRef  = useRef(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/simulation/configs")
      .then(r => r.json())
      .then(d => {
        const list: SavedConfig[] = Array.isArray(d) ? d : (d?.configs ?? []);
        setConfigs(list);
        if (list.length > 0 && !baseId) {
          setBaseId(list[0].id);
          setSymbolsRaw((list[0].config.symbols ?? []).join(", "));
        }
      });
  }, []);

  useEffect(() => {
    const cfg = configs.find(c => c.id === baseId);
    if (cfg) setSymbolsRaw((cfg.config.symbols ?? []).join(", "));
  }, [baseId, configs]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  const addLog = useCallback((msg: string, level: LogLine["level"] = "info") => {
    setLog(prev => [...prev.slice(-500), { t: nowStr(), msg, level }]);
  }, []);

  function updateResult(key: string, patch: Partial<ArchResult>) {
    setResults(prev => prev.map(r => r.key === key ? { ...r, ...patch } : r));
  }

  async function runSim(config: SimConfig, from: number, to: number): Promise<{ stats: SimStats }> {
    const res = await fetch("/api/simulation/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...config, from, to }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error((d as { error?: string }).error ?? `Error ${res.status}`);
    }
    return res.json();
  }

  const handleStart = useCallback(async () => {
    const base = configs.find(c => c.id === baseId);
    if (!base) { addLog("Selecciona una configuració base", "error"); return; }

    const af = parseDate(aFrom), at = parseDate(aTo);
    const bf = parseDate(bFrom), bt = parseDate(bTo);
    if (isNaN(af) || isNaN(at) || af >= at) { addLog("Periode d'anàlisi invàlid", "error"); return; }
    if (isNaN(bf) || isNaN(bt) || bf >= bt) { addLog("Periode de validació invàlid", "error"); return; }

    const symbols = parseSymbols(symbolsRaw);
    if (symbols.length === 0) { addLog("Afegeix almenys un símbol", "error"); return; }
    if (selExits.size === 0 || selTfs.size === 0) { addLog("Selecciona almenys un mode i un interval", "error"); return; }

    // Build full archetype pool
    const pool: Archetype[] = [];
    for (const sym of symbols)
      for (const em of ALL_EXITS)  { if (!selExits.has(em)) continue;
      for (const en of ALL_ENTRIES){ if (!selEntries.has(en)) continue;
      for (const tf of ALL_INTERVALS){ if (!selTfs.has(tf)) continue;
      for (const cm of ALL_CAP_MODES){ if (!selCapModes.has(cm)) continue;
        pool.push({ key: `${sym}_${em}_${en}_${tf}_${cm}`, symbol: sym, exitMode: em, entryMode: en, interval: tf, capitalMode: cm });
      }}}}

    if (pool.length === 0) { addLog("Cap combinació possible amb les opcions seleccionades", "error"); return; }

    const minItersNeeded = pool.length * WARMUP_ITERS;
    if (totalIter < minItersNeeded) {
      addLog(`⚠ ${totalIter} iteracions insuficients per al warm-up (${pool.length} arquetips × ${WARMUP_ITERS} = ${minItersNeeded}). Augmenta el pressupost.`, "warn");
    }

    // Init results table
    setResults(pool.map(a => ({
      key: a.key, symbol: a.symbol, exitMode: a.exitMode, entryMode: a.entryMode,
      interval: a.interval, capitalMode: a.capitalMode,
      phase: "warmup", analysisPnl: null, valPnl: null, profitFactor: null,
      maxDrawdown: null, totalTrades: null, promoted: false,
    })));
    setLog([]);
    setRunning(true);
    abortRef.current = false;

    addLog(`🔬 AutoLab iniciat: ${pool.length} arquetips · pressupost ${totalIter} iters`, "info");
    addLog(`Anàlisi: ${aFrom}→${aTo}  |  Validació: ${bFrom}→${bTo}`, "info");

    // ── FASE 1: Warm-up (3 iters per arquetip) ──────────────────────────────
    addLog(`— Fase 1: warm-up (${WARMUP_ITERS} iters × ${pool.length} arquetips) —`);

    const samplers = new Map<string, ReturnType<typeof createAdaptiveSampler>>();
    const bestOf   = new Map<string, { params: Partial<SimConfig>; stats: SimStats }>();

    for (const arch of pool) {
      if (abortRef.current) { addLog("Aturat per l'usuari", "warn"); setRunning(false); return; }

      const defs = PARAM_DEFS[arch.exitMode] ?? [];
      const archConfig: SimConfig = {
        ...base.config,
        symbols:     [arch.symbol],
        exitMode:    arch.exitMode,
        entryMode:   arch.entryMode,
        interval:    arch.interval,
        capitalMode: arch.capitalMode,
      };
      const ranges  = buildDefaultRanges(defs, archConfig);
      const sampler = createAdaptiveSampler(WARMUP_ITERS);
      samplers.set(arch.key, sampler);

      let best: { params: Partial<SimConfig>; stats: SimStats } | null = null;

      for (let i = 0; i < WARMUP_ITERS; i++) {
        if (abortRef.current) break;
        try {
          const params = adaptiveSample(defs, ranges, sampler, "pnlPct");
          const res    = await runSim({ ...archConfig, ...params }, af, at);
          sampler.iteration = i + 1;
          if (!best || res.stats.totalPnlPct > best.stats.totalPnlPct) {
            best = { params, stats: res.stats };
            sampler.history = [{ params, score: res.stats.totalPnlPct }];
          }
        } catch { sampler.iteration = i + 1; }
      }

      if (best) {
        bestOf.set(arch.key, best);
        updateResult(arch.key, { phase: "warmup", analysisPnl: best.stats.totalPnlPct });
      } else {
        updateResult(arch.key, { phase: "error", error: "Cap resultat al warm-up" });
      }
    }

    if (abortRef.current) { setRunning(false); return; }

    // ── FASE 2: Refinament del top-K ────────────────────────────────────────
    const K = Math.max(3, Math.ceil(pool.length * TOP_K_PCT));
    const validPool = pool.filter(a => bestOf.has(a.key));
    const sorted    = [...validPool].sort((a, b) =>
      (bestOf.get(b.key)?.stats.totalPnlPct ?? -Infinity) -
      (bestOf.get(a.key)?.stats.totalPnlPct ?? -Infinity)
    );
    const topK = sorted.slice(0, Math.min(K, sorted.length));

    const usedIter  = pool.length * WARMUP_ITERS;
    const remaining = Math.max(0, totalIter - usedIter);

    const scores    = topK.map(a => Math.max(0.01, bestOf.get(a.key)?.stats.totalPnlPct ?? 0.01));
    const sumScores = scores.reduce((a, b) => a + b, 0);

    addLog(`— Fase 2: refinant top-${topK.length} arquetips · ${remaining} iters restants —`);
    addLog(`Top-${topK.length}: ${topK.map(a => `${a.symbol} ${a.exitMode} ${a.entryMode} ${a.interval} ${a.capitalMode}`).join(" | ")}`);

    for (let idx = 0; idx < topK.length; idx++) {
      if (abortRef.current) { addLog("Aturat per l'usuari", "warn"); break; }

      const arch  = topK[idx];
      const extra = Math.round((scores[idx] / sumScores) * remaining);
      if (extra === 0) continue;

      const defs = PARAM_DEFS[arch.exitMode] ?? [];
      const archConfig: SimConfig = {
        ...base.config,
        symbols:     [arch.symbol],
        exitMode:    arch.exitMode,
        entryMode:   arch.entryMode,
        interval:    arch.interval,
        capitalMode: arch.capitalMode,
      };
      const ranges  = buildDefaultRanges(defs, archConfig);
      const sampler = samplers.get(arch.key)!;
      sampler.total    += extra;

      updateResult(arch.key, { phase: "refining" });
      addLog(`  ▶ ${arch.symbol} ${arch.exitMode} ${arch.entryMode} ${arch.interval} ${arch.capitalMode} (+${extra} iters)`);

      for (let i = 0; i < extra; i++) {
        if (abortRef.current) break;
        try {
          const params = adaptiveSample(defs, ranges, sampler, "pnlPct");
          const res    = await runSim({ ...archConfig, ...params }, af, at);
          sampler.iteration += 1;
          const cur = bestOf.get(arch.key);
          if (!cur || res.stats.totalPnlPct > cur.stats.totalPnlPct) {
            bestOf.set(arch.key, { params, stats: res.stats });
            sampler.history = [{ params, score: res.stats.totalPnlPct }, ...(sampler.history ?? [])].slice(0, 5);
          }
        } catch { sampler.iteration += 1; }
      }

      const finalBest = bestOf.get(arch.key);
      if (finalBest)
        updateResult(arch.key, { analysisPnl: finalBest.stats.totalPnlPct });
    }

    if (abortRef.current) { setRunning(false); return; }

    // ── FASE 3: Validació i promoció ────────────────────────────────────────
    addLog(`— Fase 3: validació OOS del top-${topK.length} —`);

    // Sort topK by final analysis score
    topK.sort((a, b) =>
      (bestOf.get(b.key)?.stats.totalPnlPct ?? -Infinity) -
      (bestOf.get(a.key)?.stats.totalPnlPct ?? -Infinity)
    );

    let promotedCount = 0;

    for (const arch of topK) {
      if (abortRef.current) break;
      const best = bestOf.get(arch.key);
      if (!best) continue;

      updateResult(arch.key, { phase: "validating" });
      addLog(`  Validant ${arch.symbol} ${arch.exitMode} ${arch.entryMode} ${arch.interval} ${arch.capitalMode}…`);

      try {
        const archConfig: SimConfig = {
          ...base.config,
          symbols:     [arch.symbol],
          exitMode:    arch.exitMode,
          entryMode:   arch.entryMode,
          interval:    arch.interval,
          capitalMode: arch.capitalMode,
        };
        const valRes = await runSim({ ...archConfig, ...best.params }, bf, bt);
        const vs = valRes.stats;
        const passes =
          vs.totalPnlPct  >= minPnl &&
          vs.profitFactor >= minPF  &&
          vs.maxDrawdown  <= maxDD  &&
          vs.totalTrades  >= 5;

        addLog(
          `  ${passes ? "✅" : "❌"} ${vs.totalPnlPct.toFixed(1)}% PnL · PF ${vs.profitFactor.toFixed(2)} · DD ${vs.maxDrawdown.toFixed(1)}% · ${vs.totalTrades} trades`,
          passes ? "ok" : "warn",
        );

        let promotedName: string | undefined;
        if (passes && autoPromote) {
          const cfgName = `AutoLab ${arch.symbol} ${arch.exitMode} ${arch.entryMode} ${arch.interval} ${arch.capitalMode}`;
          const cfgRes  = await fetch("/api/simulation/configs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: cfgName,
              config: { ...archConfig, ...best.params },
              pnlPct: vs.totalPnlPct,
            }),
          });
          const cfgData = await cfgRes.json() as { id?: string };
          if (!cfgData.id) throw new Error("No s'ha pogut desar la configuració");

          await fetch("/api/bots", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: cfgName, simId: cfgData.id, budgetUsdt: budgetU }),
          });
          promotedName = cfgName;
          promotedCount++;
          addLog(`  🤖 Bot creat: "${cfgName}"`, "ok");
        }

        updateResult(arch.key, {
          phase: "done",
          valPnl:       vs.totalPnlPct,
          profitFactor: vs.profitFactor,
          maxDrawdown:  vs.maxDrawdown,
          totalTrades:  vs.totalTrades,
          promoted:     !!promotedName,
          promotedName,
        });

      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        updateResult(arch.key, { phase: "error", error: msg });
        addLog(`  ✗ ${msg}`, "error");
      }
    }

    setRunning(false);
    addLog(`✅ AutoLab finalitzat. Bots creats: ${promotedCount} / ${topK.length} validats`, "ok");
  }, [configs, baseId, aFrom, aTo, bFrom, bTo, totalIter, budgetU, symbolsRaw,
      selExits, selEntries, selTfs, selCapModes, minPnl, minPF, maxDD, autoPromote, addLog]);

  /* ── Toggle helpers ─────────────────────────────────────────────────────── */

  function tog<T>(set: Set<T>, val: T): Set<T> {
    const n = new Set(set); n.has(val) ? n.delete(val) : n.add(val); return n;
  }

  /* ── Pool size display ──────────────────────────────────────────────────── */

  const symCount   = parseSymbols(symbolsRaw).length;
  const poolSize   = symCount * selExits.size * selEntries.size * selTfs.size * selCapModes.size;
  const warmupNeed = poolSize * WARMUP_ITERS;
  const budgetOk   = totalIter >= warmupNeed;

  /* ── Render ──────────────────────────────────────────────────────────────── */

  return (
    <div className="al-tab">

      {/* ── Left: config ──────────────────────────────────────────── */}
      <div className="al-col al-col--config">

        <section className="al-section">
          <h3 className="al-section__title">Configuració base</h3>
          <select className="al-select" value={baseId} onChange={e => setBaseId(e.target.value)}>
            {configs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <p className="al-hint dim">Capital, filtres i valors de partida per als paràmetres.</p>
        </section>

        <section className="al-section">
          <h3 className="al-section__title">Símbols</h3>
          <textarea className="al-textarea" rows={2}
            placeholder="BTCUSDT, ETHUSDT, SOLUSDT…"
            value={symbolsRaw} onChange={e => setSymbolsRaw(e.target.value)} />
          {symCount > 0 && <p className="al-hint dim">{symCount} símbols</p>}
        </section>

        <section className="al-section">
          <h3 className="al-section__title">Períodes</h3>
          <div className="al-date-grid">
            <label className="al-label">Anàlisi des de
              <input className="al-input" type="date" value={aFrom} onChange={e => setAFrom(e.target.value)} />
            </label>
            <label className="al-label">fins a
              <input className="al-input" type="date" value={aTo}   onChange={e => setATo(e.target.value)} />
            </label>
            <label className="al-label">Validació des de
              <input className="al-input" type="date" value={bFrom} onChange={e => setBFrom(e.target.value)} />
            </label>
            <label className="al-label">fins a
              <input className="al-input" type="date" value={bTo}   onChange={e => setBTo(e.target.value)} />
            </label>
          </div>
        </section>

        <section className="al-section">
          <h3 className="al-section__title">Pressupost</h3>
          <label className="al-label">Iteracions totals
            <input className="al-input al-input--sm" type="number" min={10} step={10}
              value={totalIter} onChange={e => setTotalIter(parseInt(e.target.value) || 100)} />
          </label>
          {poolSize > 0 && (
            <p className={`al-hint ${budgetOk ? "dim" : "al-hint--warn"}`}>
              {warmupNeed} iters warm-up ({poolSize} arquetips × {WARMUP_ITERS})
              {!budgetOk && " ⚠ insuficient"}
            </p>
          )}
          <label className="al-label">Pressupost bot (USDT)
            <input className="al-input al-input--sm" type="number" min={10} step={10}
              value={budgetU} onChange={e => setBudgetU(parseInt(e.target.value) || 100)} />
          </label>
        </section>

        <section className="al-section">
          <div className="al-dim-header">
            <h3 className="al-section__title">Dimensions a explorar</h3>
            <div className="al-dim-btns">
              <button className="al-dim-btn" onClick={() => {
                setSelExits(new Set(ALL_EXITS)); setSelEntries(new Set(ALL_ENTRIES));
                setSelTfs(new Set(ALL_INTERVALS)); setSelCapModes(new Set(ALL_CAP_MODES));
              }}>Tot</button>
              <button className="al-dim-btn" onClick={() => {
                setSelExits(new Set()); setSelEntries(new Set());
                setSelTfs(new Set()); setSelCapModes(new Set());
              }}>Cap</button>
            </div>
          </div>

          <p className="al-dim-label">Sortida</p>
          <div className="al-checks">
            {ALL_EXITS.map(em => (
              <label key={em} className="al-check">
                <input type="checkbox" checked={selExits.has(em)} onChange={() => setSelExits(tog(selExits, em))} />
                {em}
              </label>
            ))}
          </div>

          <p className="al-dim-label">Entrada</p>
          <div className="al-checks">
            {ALL_ENTRIES.map(en => (
              <label key={en} className="al-check">
                <input type="checkbox" checked={selEntries.has(en)} onChange={() => setSelEntries(tog(selEntries, en))} />
                {en}
              </label>
            ))}
          </div>

          <p className="al-dim-label">Interval</p>
          <div className="al-checks">
            {ALL_INTERVALS.map(tf => (
              <label key={tf} className="al-check">
                <input type="checkbox" checked={selTfs.has(tf)} onChange={() => setSelTfs(tog(selTfs, tf))} />
                {tf}
              </label>
            ))}
          </div>

          <p className="al-dim-label">Capital mode</p>
          <div className="al-checks">
            {ALL_CAP_MODES.map(cm => (
              <label key={cm} className="al-check">
                <input type="checkbox" checked={selCapModes.has(cm)} onChange={() => setSelCapModes(tog(selCapModes, cm))} />
                {cm}
              </label>
            ))}
          </div>

          {poolSize > 0 && (
            <p className="al-hint dim" style={{ marginTop: 6 }}>
              {poolSize} combinacions totals
            </p>
          )}
        </section>

        <section className="al-section">
          <h3 className="al-section__title">Criteris de promoció</h3>
          <label className="al-label">Min P&L validació (%)
            <input className="al-input al-input--sm" type="number" step={5}
              value={minPnl} onChange={e => setMinPnl(parseFloat(e.target.value) || 30)} />
          </label>
          <label className="al-label">Min Profit Factor
            <input className="al-input al-input--sm" type="number" step={0.1}
              value={minPF} onChange={e => setMinPF(parseFloat(e.target.value) || 1.3)} />
          </label>
          <label className="al-label">Max Drawdown (%)
            <input className="al-input al-input--sm" type="number" step={5}
              value={maxDD} onChange={e => setMaxDD(parseFloat(e.target.value) || 35)} />
          </label>
          <label className="al-check al-check--promote">
            <input type="checkbox" checked={autoPromote} onChange={e => setAutoPromote(e.target.checked)} />
            Crear bot automàticament si aprova
          </label>
        </section>

        <div className="al-run-row">
          {!running ? (
            <button className="al-btn al-btn--start" onClick={handleStart}
              disabled={poolSize === 0 || !baseId || symCount === 0}>
              <i className="fa-solid fa-wand-magic-sparkles" /> Iniciar AutoLab
              {poolSize > 0 && <span className="al-arch-count">({poolSize} · {totalIter} iters)</span>}
            </button>
          ) : (
            <button className="al-btn al-btn--stop" onClick={() => { abortRef.current = true; }}>
              <i className="fa-solid fa-stop" /> Aturar
            </button>
          )}
          {poolSize > 0 && !running && (
            <p className="al-hint dim" style={{ marginTop: 6, textAlign: "center" }}>
              Fase 1: {warmupNeed} warm-up → top-{Math.max(3, Math.ceil(poolSize * TOP_K_PCT))} refinament → validació OOS
            </p>
          )}
        </div>

      </div>

      {/* ── Right: results + log ──────────────────────────────────── */}
      <div className="al-col al-col--main">

        {results.length > 0 && (
          <div className="al-results">
            <h3 className="al-section__title">
              Resultats
              <span className="al-results__count dim">
                {" "}— {results.filter(r => r.phase === "done").length} finalitzats
                {results.filter(r => r.promoted).length > 0 &&
                  `, ${results.filter(r => r.promoted).length} promoguts`}
              </span>
            </h3>
            <table className="al-table">
              <thead>
                <tr>
                  <th>Símbol</th><th>Sortida</th><th>Entrada</th><th>TF</th><th>Capital</th><th>Fase</th>
                  <th>PnL an.</th><th>PnL val.</th><th>PF</th><th>DD%</th><th>Trades</th><th>Bot</th>
                </tr>
              </thead>
              <tbody>
                {[...results]
                  .sort((a, b) => (b.analysisPnl ?? -Infinity) - (a.analysisPnl ?? -Infinity))
                  .map(r => (
                  <tr key={r.key} className={`al-row al-row--${r.phase}`}>
                    <td><span className="al-symbol">{r.symbol}</span></td>
                    <td><span className={`al-mode al-mode--${r.exitMode.toLowerCase()}`}>{r.exitMode}</span></td>
                    <td><span className="al-entry">{r.entryMode}</span></td>
                    <td>{r.interval}</td>
                    <td><span className="al-cap">{r.capitalMode}</span></td>
                    <td>
                      {r.phase === "warmup"     && <span className="dim"><i className="fa-solid fa-spinner fa-spin" /> Warm-up</span>}
                      {r.phase === "refining"   && <><i className="fa-solid fa-spinner fa-spin" /> Refinant</>}
                      {r.phase === "validating" && <><i className="fa-solid fa-spinner fa-spin" /> Validant</>}
                      {r.phase === "done"       && (r.promoted ? "✅" : "❌")}
                      {r.phase === "error"      && <span className="al-err" title={r.error}>Error</span>}
                    </td>
                    <td>{r.analysisPnl !== null ? `${fmt2(r.analysisPnl)}%` : "—"}</td>
                    <td className={r.valPnl !== null ? (r.valPnl >= minPnl ? "al-cell--ok" : "al-cell--ko") : ""}>
                      {r.valPnl !== null ? `${fmt2(r.valPnl)}%` : "—"}
                    </td>
                    <td className={r.profitFactor !== null ? (r.profitFactor >= minPF ? "al-cell--ok" : "al-cell--ko") : ""}>
                      {fmt2(r.profitFactor)}
                    </td>
                    <td className={r.maxDrawdown !== null ? (r.maxDrawdown <= maxDD ? "al-cell--ok" : "al-cell--ko") : ""}>
                      {r.maxDrawdown !== null ? `${fmt2(r.maxDrawdown)}%` : "—"}
                    </td>
                    <td>{r.totalTrades ?? "—"}</td>
                    <td>{r.promotedName
                      ? <span className="al-bot-badge"><i className="fa-solid fa-robot" /> {r.promotedName}</span>
                      : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="al-log">
          <div className="al-log__header">
            <span className="al-section__title">Log</span>
            {log.length > 0 && (
              <button className="al-log__clear dim" onClick={() => setLog([])}>Netejar</button>
            )}
          </div>
          <div className="al-log__body">
            {log.length === 0
              ? <span className="dim">El log apareixerà aquí un cop iniciïs l'AutoLab.</span>
              : log.map((l, i) => (
                  <div key={i} className={`al-log__line al-log__line--${l.level}`}>
                    <span className="al-log__time">{l.t}</span>
                    <span>{l.msg}</span>
                  </div>
                ))
            }
            <div ref={logEndRef} />
          </div>
        </div>

      </div>
    </div>
  );
}
