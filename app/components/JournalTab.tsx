"use client";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { STRATEGIES } from "./OrdersPanel";
import CoinIcon from "./CoinIcon";

// ── Types ─────────────────────────────────────────────────────────────────────

interface JournalEntry {
  id: number;
  type: string;
  symbol: string;
  side: string;
  qty: string;
  price: string;
  quoteQty: string | null;
  commission: string;
  commissionAsset: string;
  entryPrice: string | null;
  pnlUsdt: number | null;
  pnlPct: number | null;
  orderId: number | null;
  orderListId: number | null;
  strategy: string | null;
  interval: string | null;
  entryType: string | null;
  trailingMode: string | null;
  exitReason: string | null;
  capitalUsdt: number | null;
  capitalMode: string | null;
  notes: string | null;
  tradeCode: string | null;
  source: string;
  executedAt: number;
  createdAt: number;
}

interface JournalStats {
  totalEntries: number;
  totalPnlUsdt: number;
  wins: number;
  losses: number;
  totalCommission: number;
  biggestWin: number;
  biggestLoss: number;
  avgPnl: number;
}

interface JournalResponse {
  entries: JournalEntry[];
  stats: JournalStats;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(ts: number) {
  return new Date(ts).toLocaleString("ca-ES", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function fmtPnl(v: number | null) {
  if (v === null) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)} USDT`;
}

function fmtPct(v: number | null) {
  if (v === null) return null;
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function pnlColor(v: number | null): string {
  if (v === null) return "var(--text-3)";
  return v >= 0 ? "var(--green)" : "var(--red)";
}

const TYPE_LABELS: Record<string, string> = {
  ENTRY_BUY:     "Compra",
  ENTRY_OCO:     "OCO",
  TRAIL_ACTIVE:  "Trailing actiu",
  EXIT_TP:       "TP",
  EXIT_SL:       "SL",
  EXIT_TRAILING: "Trailing exit",
  EXIT_MARKET:   "Market",
  MANUAL:        "Manual",
  CANCELED:      "Cancel\u00b7lat",
};

const TYPE_COLORS: Record<string, string> = {
  ENTRY_BUY:     "var(--accent)",
  ENTRY_OCO:     "var(--accent)",
  TRAIL_ACTIVE:  "#f59e0b",
  EXIT_TP:       "var(--green)",
  EXIT_SL:       "var(--red)",
  EXIT_TRAILING: "#d97706",
  EXIT_MARKET:   "var(--text-2)",
  MANUAL:        "var(--text-3)",
  CANCELED:      "var(--text-3)",
};

const KNOWN_SYMBOLS = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "LTCUSDT"];

// ── Manual entry default ──────────────────────────────────────────────────────

const BLANK_FORM = {
  type: "MANUAL", symbol: "BTCUSDT", side: "BUY",
  qty: "", price: "", quoteQty: "", commission: "0",
  commissionAsset: "BNB", entryPrice: "", pnlUsdt: "", pnlPct: "",
  strategy: "", interval: "1h", entryType: "LIMIT", trailingMode: "",
  exitReason: "", capitalUsdt: "", capitalMode: "FIXED", notes: "",
};

const TYPE_ICONS: Record<string, string> = {
  ENTRY_BUY:     "fa-arrow-down-to-line",
  ENTRY_OCO:     "fa-arrow-down-to-line",
  TRAIL_ACTIVE:  "fa-diamond-turn-right",
  EXIT_TP:       "fa-circle-check",
  EXIT_SL:       "fa-shield-halved",
  EXIT_TRAILING: "fa-chart-line",
  EXIT_MARKET:   "fa-bolt",
  MANUAL:        "fa-pen",
  CANCELED:      "fa-xmark",
};

// ── JournalTimeline sub-component ─────────────────────────────────────────────

function JournalTimeline({
  related,
  anchorId,
}: {
  related: JournalEntry[] | "loading" | undefined;
  anchorId: number;
}) {
  if (!related) return null;

  if (related === "loading") {
    return (
      <div className="jtimeline-wrap">
        <div className="jtimeline-title">
          <i className="fa-solid fa-clock-rotate-left" /> Historial de l&apos;operació
        </div>
        <div className="state-empty" style={{ padding: "0.5rem 0" }}>
          <i className="fa-solid fa-spinner fa-spin" /> Carregant…
        </div>
      </div>
    );
  }

  if (related.length <= 1) return null;

  return (
    <div className="jtimeline-wrap">
      <div className="jtimeline-title">
        <i className="fa-solid fa-clock-rotate-left" /> Historial de l&apos;operació
        <span className="jtimeline-title__count">{related.length} events</span>
        {related[0]?.tradeCode && (
          <span className="order-card__tc-badge" style={{ marginLeft: "auto" }}>{related[0].tradeCode}</span>
        )}
      </div>
      <div className="jtimeline">
        {related.map((ev, idx) => {
          const isAnchor = ev.id === anchorId;
          const typeClr  = TYPE_COLORS[ev.type] ?? "var(--text-3)";
          const pColor   = pnlColor(ev.pnlUsdt);
          const icon     = TYPE_ICONS[ev.type] ?? "fa-circle";
          const isLast   = idx === related.length - 1;

          return (
            <div
              key={ev.id}
              className={`jtimeline__event${isAnchor ? " jtimeline__event--anchor" : ""}`}
            >
              {/* Left: dot + vertical connector */}
              <div className="jtimeline__dot-col">
                <div
                  className="jtimeline__dot"
                  style={{ background: `${typeClr}1a`, color: typeClr }}
                >
                  <i className={`fa-solid ${icon}`} />
                </div>
                {!isLast && <div className="jtimeline__connector" />}
              </div>

              {/* Center: label + meta */}
              <div className="jtimeline__body">
                <span className="jtimeline__label" style={{ color: isAnchor ? "var(--text-1)" : "var(--text-2)" }}>
                  {TYPE_LABELS[ev.type] ?? ev.type}
                  {ev.exitReason && (
                    <span className="jtimeline__reason"> · {ev.exitReason.replace(/_/g, " ").toLowerCase()}</span>
                  )}
                </span>
                <span className="jtimeline__meta">
                  {fmtDate(ev.executedAt)}
                  {ev.trailingMode && ` · ${ev.trailingMode}`}
                </span>
              </div>

              {/* Right: price + P&L */}
              <div className="jtimeline__right">
                <span className="jtimeline__price mono">
                  {parseFloat(ev.price).toFixed(2)}
                </span>
                {ev.pnlUsdt !== null && (
                  <span className="jtimeline__pnl mono" style={{ color: pColor }}>
                    {ev.pnlUsdt >= 0 ? "+" : ""}{ev.pnlUsdt.toFixed(2)} $
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Trade group type ───────────────────────────────────────────────────────────

interface TradeGroup {
  tradeCode: string;
  entries: JournalEntry[];
  netPnl: number;
  symbol: string;
  firstAt: number;
  lastAt: number;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function JournalTab({ onNewOrder }: { onNewOrder?: () => void }) {
  const [entries,   setEntries  ] = useState<JournalEntry[]>([]);
  const [stats,     setStats    ] = useState<JournalStats | null>(null);
  const [loading,   setLoading  ] = useState(true);
  const [error,     setError    ] = useState<string | null>(null);
  const [expanded,   setExpanded  ] = useState<number | null>(null);
  const [relatedMap, setRelatedMap] = useState<Record<number, JournalEntry[] | "loading">>({});
  const [editNotes,  setEditNotes ] = useState<Record<number, string>>({});
  const [showModal, setShowModal] = useState(false);
  const [form,      setForm     ] = useState({ ...BLANK_FORM });
  const [saving,    setSaving   ] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [showOnlyOpen,   setShowOnlyOpen   ] = useState(false);

  // filters
  const [fSymbol,   setFSymbol  ] = useState("");
  const [fSide,     setFSide    ] = useState("");
  const [fStrategy, setFStrategy] = useState("");
  const [fFrom,     setFFrom    ] = useState("");
  const [fTo,       setFTo      ] = useState("");

  const notesTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  // ── Group entries by tradeCode ────────────────────────────────────────────

  const { grouped, ungrouped } = useMemo(() => {
    // Step 1: group by tradeCode
    const codeMap  = new Map<string, JournalEntry[]>();
    const listMap  = new Map<number, JournalEntry[]>(); // grouping by orderListId
    const assigned = new Set<number>(); // entry ids already placed in a group

    for (const e of entries) {
      if (e.tradeCode) {
        if (!codeMap.has(e.tradeCode)) codeMap.set(e.tradeCode, []);
        codeMap.get(e.tradeCode)!.push(e);
        assigned.add(e.id);
      }
    }

    // Step 2: for entries NOT yet in a tradeCode group, group by orderListId proximity
    // An entry without orderListId is linked to the nearest entry (same symbol, ±15 min)
    // that DOES have an orderListId.
    const unassigned = entries.filter(e => !assigned.has(e.id));
    const withList   = unassigned.filter(e => e.orderListId != null);
    const noList     = unassigned.filter(e => e.orderListId == null);

    for (const e of withList) {
      if (!listMap.has(e.orderListId!)) listMap.set(e.orderListId!, []);
      listMap.get(e.orderListId!)!.push(e);
      assigned.add(e.id);
    }

    // Try to attach entries without orderListId to a nearby listMap group (15 min window)
    const WINDOW = 15 * 60 * 1000;
    const orphans: JournalEntry[] = [];
    for (const e of noList) {
      let best: JournalEntry[] | null = null;
      let bestDiff = WINDOW + 1;
      for (const [, evs] of listMap.entries()) {
        if (evs[0].symbol !== e.symbol) continue;
        const diff = Math.min(...evs.map(ev => Math.abs(ev.executedAt - e.executedAt)));
        if (diff < bestDiff) { bestDiff = diff; best = evs; }
      }
      if (best) { best.push(e); assigned.add(e.id); }
      else orphans.push(e);
    }

    // Step 3: Link orphan EXIT_TRAILING / TRAIL_ACTIVE entries via shared orderId.
    // The trailing SL orderId appears in both TRAIL_ACTIVE and EXIT_TRAILING.
    // We must search BOTH codeMap and listMap because the ENTRY+TRAIL_ACTIVE may be
    // in a codeMap group (has tradeCode) while the EXIT_TRAILING has no tradeCode.
    const linkedOrphans = new Set<number>();
    for (const orphan of orphans) {
      if (orphan.orderId == null) continue;
      let found = false;

      for (const [, evs] of codeMap.entries()) {
        if (evs[0].symbol !== orphan.symbol) continue;
        if (evs.some(e => e.orderId === orphan.orderId)) {
          evs.push(orphan);
          linkedOrphans.add(orphan.id);
          found = true;
          break;
        }
      }
      if (found) continue;

      for (const [, evs] of listMap.entries()) {
        if (evs[0].symbol !== orphan.symbol) continue;
        if (evs.some(e => e.orderId === orphan.orderId)) {
          evs.push(orphan);
          linkedOrphans.add(orphan.id);
          break;
        }
      }
    }
    // Remove linked orphans from the orphans list
    orphans.splice(0, orphans.length, ...orphans.filter(e => !linkedOrphans.has(e.id)));

    // Build final groups list
    const grouped: TradeGroup[] = [];

    function pushGroup(key: string, evs: JournalEntry[]) {
      if (evs.length < 2) { orphans.push(...evs); return; }
      const times = evs.map(e => e.executedAt);
      grouped.push({
        tradeCode: key,
        entries:   evs,
        netPnl:    evs.reduce((s, e) => s + (e.pnlUsdt ?? 0), 0),
        symbol:    evs[0].symbol,
        firstAt:   Math.min(...times),
        lastAt:    Math.max(...times),
      });
    }

    for (const [tc, evs] of codeMap.entries())  pushGroup(tc, evs);
    for (const [lid, evs] of listMap.entries()) pushGroup(`L-${lid}`, evs);

    grouped.sort((a, b) => b.lastAt - a.lastAt);

    return { grouped, ungrouped: orphans };
  }, [entries]);

  function toggleGroup(tc: string) {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(tc)) next.delete(tc); else next.add(tc);
      return next;
    });
  }

  // ── Fetch data ──────────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (fSymbol)   params.set("symbol",   fSymbol);
      if (fSide)     params.set("side",     fSide);
      if (fStrategy) params.set("strategy", fStrategy);
      if (fFrom)     params.set("from",     String(new Date(fFrom).getTime()));
      if (fTo)       params.set("to",       String(new Date(fTo).getTime()));
      params.set("limit", "500");
      const r = await fetch(`/api/journal?${params}`);
      if (!r.ok) throw new Error(await r.text());
      const d = await r.json() as JournalResponse;
      setEntries(d.entries);
      setStats(d.stats);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [fSymbol, fSide, fStrategy, fFrom, fTo]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Notes auto-save (debounced) ─────────────────────────────────────────────

  function handleNotesChange(id: number, value: string) {
    setEditNotes(p => ({ ...p, [id]: value }));
    if (notesTimers.current[id]) clearTimeout(notesTimers.current[id]);
    notesTimers.current[id] = setTimeout(async () => {
      try {
        await fetch("/api/journal", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, notes: value }) });
      } catch { /* silent */ }
    }, 800);
  }

  // ── Strategy change ─────────────────────────────────────────────────────────

  async function handleStrategyChange(id: number, strategy: string) {
    try {
      await fetch("/api/journal", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, strategy: strategy || null }) });
      setEntries(prev => prev.map(e => e.id === id ? { ...e, strategy: strategy || null } : e));
    } catch { /* silent */ }
  }

  // ── Expand row + fetch related timeline ───────────────────────────────────

  function handleExpand(id: number, isOpen: boolean) {
    if (isOpen) { setExpanded(null); return; }
    setExpanded(id);
    if (!relatedMap[id]) {
      setRelatedMap(p => ({ ...p, [id]: "loading" }));
      fetch(`/api/journal/related?id=${id}`)
        .then(r => r.json() as Promise<JournalEntry[]>)
        .then(entries => setRelatedMap(p => ({ ...p, [id]: entries })))
        .catch(() => setRelatedMap(p => ({ ...p, [id]: [] })));
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────────────

  async function handleDelete(id: number) {
    if (!confirm("Eliminar aquesta entrada?")) return;
    try {
      await fetch("/api/journal", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, _delete: true }) });
      setEntries(prev => prev.filter(e => e.id !== id));
      if (expanded === id) setExpanded(null);
    } catch { /* silent */ }
  }

  // ── Manual entry submit ─────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const body = {
        type:            form.type,
        symbol:          form.symbol.toUpperCase().trim(),
        side:            form.side,
        qty:             form.qty,
        price:           form.price,
        quoteQty:        form.quoteQty || null,
        commission:      form.commission || "0",
        commissionAsset: form.commissionAsset || "BNB",
        entryPrice:      form.entryPrice || null,
        pnlUsdt:         form.pnlUsdt ? parseFloat(form.pnlUsdt) : null,
        pnlPct:          form.pnlPct  ? parseFloat(form.pnlPct)  : null,
        orderId:         null,
        orderListId:     null,
        strategy:        form.strategy || null,
        interval:        form.interval || null,
        entryType:       form.entryType || null,
        trailingMode:    form.trailingMode || null,
        exitReason:      form.exitReason || null,
        capitalUsdt:     form.capitalUsdt ? parseFloat(form.capitalUsdt) : null,
        capitalMode:     form.capitalMode || null,
        notes:           form.notes || null,
        source:          "MANUAL",
        executedAt:      Date.now(),
      };
      const r = await fetch("/api/journal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(await r.text());
      setShowModal(false);
      setForm({ ...BLANK_FORM });
      await loadData();
    } catch (e) {
      alert("Error: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // ── Derived stats ───────────────────────────────────────────────────────────

  const winRate = stats && (stats.wins + stats.losses) > 0
    ? ((stats.wins / (stats.wins + stats.losses)) * 100).toFixed(1)
    : null;

  const pnlUp   = (stats?.totalPnlUsdt ?? 0) >= 0;
  const wrColor = winRate && parseFloat(winRate) >= 50 ? "var(--green)" : "var(--red)";

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="journal-tab">

      {/* ── 5 KPIs ─────────────────────────────────────────────────────── */}
      <div className="section-title">
        <i className="fa-solid fa-book-open" /> Diari d'operacions
      </div>
      <div className="portfolio__cards">

        <div className={`portfolio__card portfolio__card--${pnlUp ? "green" : "red"}`}>
          <span className="portfolio__card-label">
            <i className={`fa-solid fa-arrow-trend-${pnlUp ? "up" : "down"}`} /> P&amp;L Net
          </span>
          <span className="portfolio__card-value mono">
            {stats ? fmtPnl(stats.totalPnlUsdt) : "—"}
          </span>
          <span className={`portfolio__card-sub portfolio__card-sub--${pnlUp ? "up" : "down"}`}>
            {stats ? `${stats.wins}G · ${stats.losses}P` : "—"}
          </span>
        </div>

        <div className="portfolio__card portfolio__card--blue">
          <span className="portfolio__card-label">
            <i className="fa-solid fa-percent" /> Win Rate
          </span>
          <span className="portfolio__card-value" style={{ color: winRate ? wrColor : "var(--text-1)" }}>
            {winRate ? `${winRate}%` : "—"}
          </span>
          <span className="portfolio__card-sub">
            {stats ? `${stats.wins} guanys / ${stats.losses} pèrdues` : "—"}
          </span>
        </div>

        <div className="portfolio__card portfolio__card--neutral">
          <span className="portfolio__card-label">
            <i className="fa-solid fa-hand-holding-dollar" /> Comissions
          </span>
          <span className="portfolio__card-value mono">
            {stats ? `-${stats.totalCommission.toFixed(4)}` : "—"}
          </span>
          <span className="portfolio__card-sub">
            {stats ? `Millor: ${fmtPnl(stats.biggestWin)}` : "—"}
          </span>
        </div>

        <div className="portfolio__card portfolio__card--neutral">
          <span className="portfolio__card-label">
            <i className="fa-solid fa-list-ol" /> Entrades totals
          </span>
          <span className="portfolio__card-value portfolio__card-value--count">
            {stats ? stats.totalEntries : "—"}
          </span>
          <span className="portfolio__card-sub">operacions registrades</span>
        </div>

        <div className={`portfolio__card portfolio__card--${stats && stats.biggestWin > 0 ? "green" : "neutral"}`}>
          <span className="portfolio__card-label">
            <i className="fa-solid fa-trophy" /> Millor operació
          </span>
          <span className="portfolio__card-value mono">
            {stats ? fmtPnl(stats.biggestWin) : "—"}
          </span>
          <span className="portfolio__card-sub">
            {stats ? `Pitjor: ${fmtPnl(stats.biggestLoss)}` : "—"}
          </span>
        </div>

      </div>

      {/* ── Filter bar ─────────────────────────────────────────────────────── */}
      <div className="analysis-section journal-filters">
        <div className="portfolio__section-title">
          <i className="fa-solid fa-filter" /> Filtres
        </div>
        <div className="journal-filters__row">

          <div className="journal-filter-field">
            <label className="journal-filter-label">Symbol</label>
            <select className="journal-select" value={fSymbol} onChange={e => setFSymbol(e.target.value)}>
              <option value="">Tots</option>
              {KNOWN_SYMBOLS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div className="journal-filter-field">
            <label className="journal-filter-label">Direcció</label>
            <div className="journal-seg">
              {(["", "BUY", "SELL"] as const).map(v => (
                <button key={v} className={`journal-seg__btn${fSide === v ? " journal-seg__btn--active" : ""}`}
                  onClick={() => setFSide(v)}>
                  {v || "Tots"}
                </button>
              ))}
            </div>
          </div>

          <div className="journal-filter-field">
            <label className="journal-filter-label">Estratègia</label>
            <select className="journal-select" value={fStrategy} onChange={e => setFStrategy(e.target.value)}>
              <option value="">Totes</option>
              {STRATEGIES.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
          </div>

          <div className="journal-filter-field">
            <label className="journal-filter-label">Des de</label>
            <input type="date" className="journal-input" value={fFrom} onChange={e => setFFrom(e.target.value)} />
          </div>

          <div className="journal-filter-field">
            <label className="journal-filter-label">Fins a</label>
            <input type="date" className="journal-input" value={fTo} onChange={e => setFTo(e.target.value)} />
          </div>

          <div className="journal-filter-field journal-filter-field--actions">
            <button className="btn-secondary" onClick={() => { setFSymbol(""); setFSide(""); setFStrategy(""); setFFrom(""); setFTo(""); }}>
              <i className="fa-solid fa-xmark" /> Netejar
            </button>
            {onNewOrder && (
              <button className="btn-primary" onClick={onNewOrder}>
                <i className="fa-solid fa-plus" /> Nova ordre
              </button>
            )}
            <button className="btn-secondary" onClick={() => setShowModal(true)}>
              <i className="fa-solid fa-pen-to-square" /> Entrada manual
            </button>
          </div>

        </div>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      <div className="analysis-section analysis-section--flush">
        <div className="portfolio__section-title">
          <i className="fa-solid fa-book-open" /> Operacions ({entries.length})
          <button
            className={`journal-open-btn${showOnlyOpen ? " journal-open-btn--active" : ""}`}
            onClick={() => setShowOnlyOpen(v => !v)}
            style={{ marginLeft: "auto" }}
          >
            <i className="fa-solid fa-circle-dot" /> Vigents
          </button>
        </div>

        {loading && <div className="state-empty"><i className="fa-solid fa-spinner fa-spin" /> Carregant…</div>}
        {error   && <div className="state-error"><i className="fa-solid fa-triangle-exclamation" /> {error}</div>}

        {!loading && !error && entries.length === 0 && (
          <div className="state-empty">Cap operació registrada.</div>
        )}

        {!loading && !error && entries.length > 0 && (
          <div className="journal-table">

            {/* Header */}
            <div className="journal-table__head">
              <span>Actiu</span>
              <span>Tipus</span>
              <span className="ta-right">Preu</span>
              <span className="ta-right">Import $</span>
              <span className="ta-right">P&amp;L</span>
              <span>Estratègia</span>
              <span>Detalls</span>
              <span></span>
            </div>

            {/* ── Row renderer helper ──────────────────────────────────── */}
            {(() => {
              function renderEntryRow(e: JournalEntry, inGroup = false) {
                const isOpen     = expanded === e.id;
                const pColor     = pnlColor(e.pnlUsdt);
                const typeLbl    = TYPE_LABELS[e.type] ?? e.type;
                const typeClr    = TYPE_COLORS[e.type]  ?? "var(--text-3)";
                const importVal  = e.quoteQty
                  ? parseFloat(e.quoteQty).toFixed(2)
                  : (parseFloat(e.qty) * parseFloat(e.price)).toFixed(2);
                const stratColor = STRATEGIES.find(s => s.name === e.strategy)?.color ?? "var(--text-3)";
                const isClosed   = !inGroup && (e.type.startsWith("EXIT") || e.type === "CANCELED");

                return (
                  <div key={e.id} className={`journal-table__row-wrap${isOpen ? " journal-table__row-wrap--open" : ""}${inGroup ? " journal-table__row-wrap--sub" : ""}${isClosed ? " jrow--closed" : ""}`}>

                    <div className="journal-table__row" onClick={() => handleExpand(e.id, isOpen)}>

                      <div className="jcell jcell--icon">
                        {inGroup && <div className="jtrade-connector" />}
                        <CoinIcon symbol={e.symbol.replace("USDT", "")} size={22} />
                        <div className="jcell__text">
                          <span className="jcell__main mono">{e.symbol.replace("USDT", "")}<span className="jcell__sub" style={{ marginLeft: 2 }}>/ USDT</span></span>
                          <span className="jcell__sub">{fmtDate(e.executedAt)}</span>
                        </div>
                      </div>

                      <div className="jcell">
                        <span className="jcell__main" style={{ color: typeClr, fontSize: "0.72rem", letterSpacing: "0.04em" }}>
                          {typeLbl}
                        </span>
                        <span className="jcell__sub" style={{ color: e.side === "BUY" ? "var(--green)" : "var(--red)", fontWeight: 800, letterSpacing: "0.06em" }}>
                          {e.side}
                        </span>
                      </div>

                      <div className="jcell jcell--right">
                        <span className="jcell__main mono">{parseFloat(e.price).toFixed(2)}</span>
                        {e.entryPrice
                          ? <span className="jcell__sub mono">e: {parseFloat(e.entryPrice).toFixed(2)}</span>
                          : <span className="jcell__sub">—</span>}
                      </div>

                      <div className="jcell jcell--right">
                        <span className="jcell__main mono">${importVal}</span>
                        <span className="jcell__sub mono">{parseFloat(e.qty).toPrecision(5)}</span>
                      </div>

                      <div className="jcell jcell--right">
                        <span className="jcell__main mono" style={{ color: pColor }}>
                          {fmtPnl(e.pnlUsdt)}
                        </span>
                        {e.pnlPct !== null
                          ? <span className="jcell__sub mono" style={{ color: pColor }}>{fmtPct(e.pnlPct)}</span>
                          : <span className="jcell__sub">—</span>}
                      </div>

                      <div className="jcell">
                        {e.strategy
                          ? <span className="jcell__main" style={{ color: stratColor, fontSize: "0.72rem" }}>{e.strategy}</span>
                          : <span className="jcell__main" style={{ color: "var(--text-3)" }}>—</span>}
                        <span className="jcell__sub">{e.interval ?? "—"}</span>
                      </div>

                      <div className="jcell">
                        {e.exitReason
                          ? <span className="jcell__main" style={{ color: typeClr, fontSize: "0.68rem" }}>{e.exitReason}</span>
                          : <span className="jcell__main" style={{ color: "var(--text-3)", fontSize: "0.68rem" }}>—</span>}
                        <span className="jcell__sub" style={{ color: e.source === "AUTO" ? "var(--accent)" : "#d97706", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                          {e.source}
                        </span>
                      </div>

                      <span style={{ textAlign: "right" }}>
                        <i className={`fa-solid fa-chevron-${isOpen ? "up" : "down"}`} style={{ color: "var(--text-3)", fontSize: "0.65rem" }} />
                      </span>

                    </div>

                    {isOpen && (
                      <div className="journal-table__detail">
                        <JournalTimeline related={relatedMap[e.id]} anchorId={e.id} />
                        <div className="journal-detail-grid">
                          <div className="metric-col">
                            <span className="metric-col__label">Tipus entrada</span>
                            <span className="metric-col__value">{e.entryType ?? "—"}</span>
                          </div>
                          <div className="metric-col">
                            <span className="metric-col__label">Trailing</span>
                            <span className="metric-col__value">{e.trailingMode ?? "—"}</span>
                          </div>
                          <div className="metric-col">
                            <span className="metric-col__label">Comissió</span>
                            <span className="metric-col__value">{parseFloat(e.commission).toFixed(6)} {e.commissionAsset}</span>
                          </div>
                          <div className="metric-col">
                            <span className="metric-col__label">Capital USDT</span>
                            <span className="metric-col__value">{e.capitalUsdt?.toFixed(2) ?? "—"}</span>
                          </div>
                          <div className="metric-col">
                            <span className="metric-col__label">OrderList ID</span>
                            <span className="metric-col__value mono" style={{ fontSize: "0.72rem" }}>{e.orderListId ?? "—"}</span>
                          </div>
                          {e.tradeCode && (
                            <div className="metric-col">
                              <span className="metric-col__label">Codi Operació</span>
                              <span className="metric-col__value mono" style={{ fontSize: "0.72rem" }}>{e.tradeCode}</span>
                            </div>
                          )}
                        </div>
                        <div className="journal-detail-row">
                          <span className="metric-col__label" style={{ marginBottom: 4, display: "block" }}>Estratègia</span>
                          <div className="journal-strategy-pills">
                            <button
                              className={`journal-strat-btn${!e.strategy ? " journal-strat-btn--active" : ""}`}
                              onClick={() => handleStrategyChange(e.id, "")}
                            >—</button>
                            {STRATEGIES.map(s => (
                              <button key={s.name}
                                className={`journal-strat-btn${e.strategy === s.name ? " journal-strat-btn--active" : ""}`}
                                style={e.strategy === s.name ? { color: s.color, borderColor: s.color } : {}}
                                onClick={() => handleStrategyChange(e.id, s.name)}>
                                {s.name}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="journal-detail-row">
                          <span className="metric-col__label" style={{ marginBottom: 4, display: "block" }}>Notes</span>
                          <textarea
                            className="journal-notes"
                            rows={3}
                            placeholder="Afegeix notes sobre aquesta operació…"
                            value={editNotes[e.id] ?? e.notes ?? ""}
                            onChange={ev => handleNotesChange(e.id, ev.target.value)}
                          />
                        </div>
                        <div className="journal-detail-actions">
                          <button className="btn-danger" style={{ fontSize: "0.72rem", padding: "0.3rem 0.75rem" }} onClick={() => handleDelete(e.id)}>
                            <i className="fa-solid fa-trash" /> Eliminar entrada
                          </button>
                        </div>
                      </div>
                    )}

                  </div>
                );
              }

              // ── Build display list: grouped trades + ungrouped entries merged by time ──

              type DisplayItem =
                | { kind: "group"; group: TradeGroup }
                | { kind: "entry"; entry: JournalEntry; time: number };

              const groupIsClosed = (g: TradeGroup) => g.entries.some(e => e.type.startsWith("EXIT"));
              const entryIsClosed = (e: JournalEntry) => e.type.startsWith("EXIT") || e.type === "CANCELED";

              const allItems: DisplayItem[] = [
                ...grouped.map(g => ({ kind: "group" as const, group: g, time: g.lastAt })),
                ...ungrouped.map(e => ({ kind: "entry" as const, entry: e, time: e.executedAt })),
              ].sort((a, b) => b.time - a.time);

              const displayItems = showOnlyOpen
                ? allItems.filter(item =>
                    item.kind === "group"
                      ? !groupIsClosed(item.group)
                      : !entryIsClosed(item.entry)
                  )
                : allItems;

              return displayItems.map(item => {
                if (item.kind === "entry") return renderEntryRow(item.entry);

                const g         = item.group;
                const isOpen    = !collapsedGroups.has(g.tradeCode);
                const pColor    = pnlColor(g.netPnl);
                const coin      = g.symbol.replace("USDT", "");

                // Build type flow: distinct types in chronological order
                const typeFlow = [...new Map(
                  [...g.entries].sort((a, b) => a.executedAt - b.executedAt)
                    .map(e => [e.type, e])
                ).values()].map(e => ({
                  label: TYPE_LABELS[e.type] ?? e.type,
                  color: TYPE_COLORS[e.type] ?? "var(--text-3)",
                }));

                const entryE   = g.entries.find(e => e.type.startsWith("ENTRY"));
                const strategy = entryE?.strategy ?? g.entries[0]?.strategy;
                const stratColor = STRATEGIES.find(s => s.name === strategy)?.color ?? "var(--text-3)";
                // A group is closed only when it contains an EXIT entry.
                // CANCELED alone does NOT close a group — it happens when OCO is
                // cancelled to activate trailing (TRAIL_ACTIVE follows), so treating
                // CANCELED as a close-signal would incorrectly dim still-active trades.
                const isClosed = g.entries.some(e => e.type.startsWith("EXIT"));

                return (
                  <div key={g.tradeCode} className={`jtrade-group${isClosed ? " jrow--closed" : ""}`}>

                    {/* ── Group header ── */}
                    <div className="jtrade-group__header" onClick={() => toggleGroup(g.tradeCode)}>

                      {/* Left: coin + symbol + dates + tradeCode */}
                      <div className="jtrade-group__left">
                        <CoinIcon symbol={coin} size={24} />
                        <div className="jtrade-group__meta">
                          <span className="jtrade-group__symbol mono">{coin}<span className="jcell__sub" style={{ marginLeft: 2 }}>/USDT</span></span>
                          <span className="jtrade-group__dates">
                            {fmtDate(g.firstAt)}
                            {g.lastAt !== g.firstAt && <> &rarr; {fmtDate(g.lastAt)}</>}
                          </span>
                        </div>
                        {g.tradeCode.startsWith("T-") && (
                          <span className="order-card__tc-badge jtrade-group__tc">{g.tradeCode}</span>
                        )}
                      </div>

                      {/* Center: type flow + strategy */}
                      <div className="jtrade-group__center">
                        <div className="jtrade-group__flow">
                          {typeFlow.map((t, i) => (
                            <span key={i}>
                              {i > 0 && <span className="jtrade-flow__arrow"> &rarr; </span>}
                              <span style={{ color: t.color }}>{t.label}</span>
                            </span>
                          ))}
                        </div>
                        {strategy && (
                          <span className="jtrade-group__strat" style={{ color: stratColor }}>{strategy}</span>
                        )}
                      </div>

                      {/* Right: count + net P&L + chevron */}
                      <div className="jtrade-group__right">
                        <span className="jtrade-group__count">{g.entries.length} ops</span>
                        <span className="jtrade-group__pnl mono" style={{ color: pColor }}>
                          {g.netPnl >= 0 ? "+" : ""}{g.netPnl.toFixed(2)} $
                        </span>
                        <i className={`fa-solid fa-chevron-${isOpen ? "up" : "down"} jtrade-group__chevron`} />
                      </div>

                    </div>

                    {/* ── Sub-rows ── */}
                    {isOpen && (
                      <div className="jtrade-group__rows">
                        {[...g.entries].sort((a, b) => a.executedAt - b.executedAt).map(e => renderEntryRow(e, true))}
                      </div>
                    )}

                  </div>
                );
              });
            })()}

          </div>
        )}
      </div>

      {/* ── Manual entry modal ─────────────────────────────────────────────── */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-box" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title"><i className="fa-solid fa-pen-to-square" /> Entrada manual</span>
              <button className="modal-close" onClick={() => setShowModal(false)}><i className="fa-solid fa-xmark" /></button>
            </div>

            <form className="modal-body journal-manual-form" onSubmit={handleSubmit}>

              <div className="jmf-row">
                <div className="jmf-field">
                  <label className="jmf-label">Tipus</label>
                  <select className="journal-select" value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}>
                    {["ENTRY_BUY","ENTRY_OCO","TRAIL_ACTIVE","EXIT_TP","EXIT_SL","EXIT_TRAILING","EXIT_MARKET","MANUAL"].map(t => (
                      <option key={t} value={t}>{TYPE_LABELS[t] ?? t}</option>
                    ))}
                  </select>
                </div>
                <div className="jmf-field">
                  <label className="jmf-label">Symbol</label>
                  <input type="text" className="journal-input" value={form.symbol}
                    onChange={e => setForm(p => ({ ...p, symbol: e.target.value.toUpperCase() }))}
                    placeholder="BTCUSDT" required />
                </div>
              </div>

              <div className="jmf-row">
                <div className="jmf-field">
                  <label className="jmf-label">Direcció</label>
                  <div className="journal-seg">
                    {(["BUY","SELL"] as const).map(v => (
                      <button type="button" key={v}
                        className={`journal-seg__btn${form.side === v ? " journal-seg__btn--active" : ""}`}
                        onClick={() => setForm(p => ({ ...p, side: v }))}>
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="jmf-field">
                  <label className="jmf-label">Interval</label>
                  <select className="journal-select" value={form.interval} onChange={e => setForm(p => ({ ...p, interval: e.target.value }))}>
                    {["5m","15m","1h","4h","1d"].map(i => <option key={i} value={i}>{i}</option>)}
                  </select>
                </div>
              </div>

              <div className="jmf-row">
                <div className="jmf-field">
                  <label className="jmf-label">Quantitat</label>
                  <input type="number" step="any" className="journal-input" value={form.qty}
                    onChange={e => setForm(p => ({ ...p, qty: e.target.value }))} required />
                </div>
                <div className="jmf-field">
                  <label className="jmf-label">Preu</label>
                  <input type="number" step="any" className="journal-input" value={form.price}
                    onChange={e => setForm(p => ({ ...p, price: e.target.value }))} required />
                </div>
              </div>

              <div className="jmf-row">
                <div className="jmf-field">
                  <label className="jmf-label">Preu entrada (opt.)</label>
                  <input type="number" step="any" className="journal-input" value={form.entryPrice}
                    onChange={e => setForm(p => ({ ...p, entryPrice: e.target.value }))} />
                </div>
                <div className="jmf-field">
                  <label className="jmf-label">P&amp;L USDT (opt.)</label>
                  <input type="number" step="any" className="journal-input" value={form.pnlUsdt}
                    onChange={e => setForm(p => ({ ...p, pnlUsdt: e.target.value }))} />
                </div>
              </div>

              <div className="jmf-row">
                <div className="jmf-field">
                  <label className="jmf-label">Comissió</label>
                  <input type="number" step="any" className="journal-input" value={form.commission}
                    onChange={e => setForm(p => ({ ...p, commission: e.target.value }))} />
                </div>
                <div className="jmf-field">
                  <label className="jmf-label">Estratègia</label>
                  <select className="journal-select" value={form.strategy} onChange={e => setForm(p => ({ ...p, strategy: e.target.value }))}>
                    <option value="">—</option>
                    {STRATEGIES.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="jmf-field" style={{ width: "100%" }}>
                <label className="jmf-label">Notes</label>
                <textarea className="journal-notes" rows={3}
                  value={form.notes}
                  onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                  placeholder="Anotacions sobre l'operació…" />
              </div>

              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => { setShowModal(false); setForm({ ...BLANK_FORM }); }}>
                  Cancel·lar
                </button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? <><i className="fa-solid fa-spinner fa-spin" /> Guardant…</> : <><i className="fa-solid fa-floppy-disk" /> Desar</>}
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

    </div>
  );
}
