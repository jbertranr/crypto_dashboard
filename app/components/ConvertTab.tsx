"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useTradingMode } from "../contexts/TradingModeContext";

interface Quote {
  quoteId:        string;
  fromAsset:      string;
  toAsset:        string;
  fromAmount:     string;
  toAmount:       string;
  ratio:          string;
  inverseRatio:   string;
  validTimestamp: number;
}

interface ConvertRecord {
  orderId:     string;
  orderStatus: string;
  fromAsset:   string;
  fromAmount:  string;
  toAsset:     string;
  toAmount:    string;
  createTime?: number;
  fee?:        string;
  feeAsset?:   string;
}

const COMMON_ASSETS = ["BTC","ETH","BNB","SOL","XRP","USDT","USDC","ADA","DOGE","TRX","AVAX","DOT","MATIC","LINK"];
const STABLE_ASSETS = new Set(["USDT","USDC","BUSD","DAI","TUSD","USDP","EUR"]);

export default function ConvertTab({ mode: modeProp }: { mode?: "paper" | "real" }) {
  const { viewMode, quoteAsset } = useTradingMode();
  const mode = modeProp ?? viewMode;

  const [assets,     setAssets]     = useState<string[]>(COMMON_ASSETS);
  const [fromAsset,  setFromAsset]  = useState("BTC");
  const [toAsset,    setToAsset]    = useState(quoteAsset);
  // usdAmount is what the user types (in USD); fromAmount is derived crypto amount
  const [usdAmount,  setUsdAmount]  = useState("");
  const [prices,     setPrices]     = useState<Record<string, number>>({});
  const [balances,   setBalances]   = useState<Record<string, number>>({});
  const [quote,      setQuote]      = useState<Quote | null>(null);
  const [quoteTimer, setQuoteTimer] = useState(0);
  const [history,    setHistory]    = useState<ConvertRecord[]>([]);
  const [loadingQ,   setLoadingQ]   = useState(false);
  const [loadingA,   setLoadingA]   = useState(false);
  const [loadingH,   setLoadingH]   = useState(false);
  const [errorQ,     setErrorQ]     = useState<string | null>(null);
  const [errorA,     setErrorA]     = useState<string | null>(null);
  const [result,     setResult]     = useState<ConvertRecord | null>(null);

  // Carrega assets disponibles
  useEffect(() => {
    fetch(`/api/convert?action=assets&mode=${mode}`)
      .then(r => r.json())
      .then(d => { if (Array.isArray(d.assets) && d.assets.length > 0) setAssets(d.assets); })
      .catch(() => {}); // fallback a COMMON_ASSETS
  }, [mode]);

  // Carrega saldos
  useEffect(() => {
    fetch(`/api/balance?mode=${mode}`)
      .then(r => r.json())
      .then((arr: { asset: string; free: string }[]) => {
        if (!Array.isArray(arr)) return;
        const m: Record<string, number> = {};
        arr.forEach(b => { m[b.asset] = parseFloat(b.free); });
        setBalances(m);
      })
      .catch(() => {});
  }, [mode]);

  // Carrega preus de mercat per calcular equivalents USD
  useEffect(() => {
    fetch("/api/market")
      .then(r => r.json())
      .then((d: { symbol: string; price: number }[]) => {
        if (!Array.isArray(d)) return;
        const map: Record<string, number> = {};
        for (const coin of d) {
          // symbol pot ser "BTCUSDT" o "BTC"
          const sym = coin.symbol.replace(/USDT$/, "");
          if (coin.price > 0) map[sym] = coin.price;
        }
        // Stablecoins 1:1
        for (const s of STABLE_ASSETS) map[s] = 1;
        setPrices(map);
      })
      .catch(() => {});
  }, [mode]);

  // Preu de fromAsset en USD
  const fromPrice = useMemo(() => {
    if (STABLE_ASSETS.has(fromAsset)) return 1;
    return prices[fromAsset] ?? 0;
  }, [fromAsset, prices]);

  // Import en crypto calculat des de USD
  const cryptoAmount = useMemo(() => {
    const usd = parseFloat(usdAmount);
    if (!usd || usd <= 0 || fromPrice <= 0) return 0;
    return usd / fromPrice;
  }, [usdAmount, fromPrice]);

  // fromAmount formatat per enviar a Binance
  const fromAmountStr = useMemo(() => {
    if (cryptoAmount <= 0) return "";
    // Màxim 8 decimals, elimina zeros finals
    return cryptoAmount.toFixed(8).replace(/\.?0+$/, "");
  }, [cryptoAmount]);

  // Carrega historial
  const loadHistory = useCallback(() => {
    setLoadingH(true);
    fetch(`/api/convert?action=history&mode=${mode}`)
      .then(r => r.json())
      .then(d => { if (Array.isArray(d.list)) setHistory(d.list); })
      .catch(() => {})
      .finally(() => setLoadingH(false));
  }, [mode]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // Compte enrere del quote
  useEffect(() => {
    if (!quote) return;
    const remaining = Math.max(0, Math.ceil((quote.validTimestamp - Date.now()) / 1000));
    setQuoteTimer(remaining);
    if (remaining <= 0) { setQuote(null); return; }
    const id = setInterval(() => {
      const r = Math.max(0, Math.ceil((quote.validTimestamp - Date.now()) / 1000));
      setQuoteTimer(r);
      if (r <= 0) { setQuote(null); clearInterval(id); }
    }, 1000);
    return () => clearInterval(id);
  }, [quote]);

  const swapAssets = () => {
    setFromAsset(toAsset);
    setToAsset(fromAsset);
    setQuote(null);
    setErrorQ(null);
  };

  const getQuote = async () => {
    if (!usdAmount || parseFloat(usdAmount) <= 0) {
      setErrorQ("Introdueix un import en USD vàlid");
      return;
    }
    if (fromPrice <= 0) {
      setErrorQ("No s'ha pogut obtenir el preu de mercat");
      return;
    }
    setLoadingQ(true); setErrorQ(null); setQuote(null); setResult(null);
    try {
      const r = await fetch("/api/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "quote", fromAsset, toAsset, fromAmount: parseFloat(fromAmountStr), mode }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setQuote(d);
    } catch (e) { setErrorQ((e as Error).message); }
    finally { setLoadingQ(false); }
  };

  const acceptQuote = async () => {
    if (!quote) return;
    setLoadingA(true); setErrorA(null);
    try {
      const r = await fetch("/api/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept", quoteId: quote.quoteId, mode }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setResult(d);
      setQuote(null);
      setUsdAmount("");
      loadHistory();
    } catch (e) { setErrorA((e as Error).message); }
    finally { setLoadingA(false); }
  };

  const fmtNum = (v: string | number, dec = 8) => {
    const n = parseFloat(String(v));
    if (isNaN(n)) return "—";
    return n.toLocaleString("ca-ES", { minimumFractionDigits: 2, maximumFractionDigits: dec });
  };

  const fmtUsd = (n: number) =>
    n.toLocaleString("ca-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Valors USD dels amounts del quote
  const toPrice = useMemo(() => {
    if (STABLE_ASSETS.has(toAsset)) return 1;
    return prices[toAsset] ?? 0;
  }, [toAsset, prices]);

  const quoteToUsd = quote && toPrice > 0
    ? parseFloat(quote.toAmount) * toPrice
    : null;

  // Spread real = diferència entre taxa de mercat i taxa del quote
  // Taxa mercat: fromPrice / toPrice (quants toAsset per 1 fromAsset al mercat)
  // Taxa quote : parseFloat(quote.ratio)
  // Spread % = (marketRate - quoteRate) / marketRate * 100
  const spread = useMemo(() => {
    if (!quote || fromPrice <= 0 || toPrice <= 0) return null;
    const marketRate = fromPrice / toPrice;
    const quoteRate  = parseFloat(quote.ratio);
    if (!marketRate || !quoteRate) return null;
    return ((marketRate - quoteRate) / marketRate) * 100;
  }, [quote, fromPrice, toPrice]);

  const fmtDate = (ms: number) => new Date(ms).toLocaleString("ca-ES", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
  });

  const isReal = mode === "real";

  return (
    <div className="convert-tab">

      {/* Formulari de conversió */}
      <div className="convert-card">
        <div className="section-title">
          <i className="fa-solid fa-arrow-right-arrow-left" /> Convertir crypto
          {isReal && <span className="convert-real-badge">REAL</span>}
        </div>

        <div className="convert-form">
          {/* FROM — input en USD */}
          <div className="convert-field">
            <label className="convert-label">Des de</label>
            <div className="convert-input-row">
              <select
                className="convert-select"
                value={fromAsset}
                onChange={e => { setFromAsset(e.target.value); setQuote(null); }}
              >
                {assets.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
              <div className="convert-usd-input-wrap">
                <span className="convert-usd-prefix">$</span>
                <input
                  type="number"
                  className="convert-amount convert-amount--usd"
                  placeholder="Import USD"
                  value={usdAmount}
                  onChange={e => { setUsdAmount(e.target.value); setQuote(null); }}
                  min="0"
                  step="any"
                />
              </div>
            </div>
            {/* Saldo disponible + equivalent en crypto */}
            <div className="convert-crypto-hint">
              {balances[fromAsset] != null && (
                <span className="convert-balance-hint">
                  <i className="fa-solid fa-wallet" style={{fontSize:"0.7rem"}} />
                  {" "}{fmtNum(balances[fromAsset], 8)} {fromAsset}
                  {fromPrice > 0 && balances[fromAsset] > 0 && (
                    <span className="convert-crypto-hint__price">
                      {" "}≈ ${fmtUsd(balances[fromAsset] * fromPrice)}
                    </span>
                  )}
                </span>
              )}
              {cryptoAmount > 0 && (
                <span>
                  → {fmtNum(cryptoAmount, 8)} {fromAsset}
                  {fromPrice > 0 && (
                    <span className="convert-crypto-hint__price">
                      {" "}· 1 {fromAsset} = ${fmtUsd(fromPrice)}
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>

          {/* SWAP */}
          <button className="convert-swap-btn" onClick={swapAssets} title="Intercanviar">
            <i className="fa-solid fa-arrow-right-arrow-left" style={{ transform: "rotate(90deg)" }} />
          </button>

          {/* TO */}
          <div className="convert-field">
            <label className="convert-label">Cap a</label>
            <div className="convert-input-row">
              <select
                className="convert-select"
                value={toAsset}
                onChange={e => { setToAsset(e.target.value); setQuote(null); }}
              >
                {assets.filter(a => a !== fromAsset).map(a => <option key={a} value={a}>{a}</option>)}
              </select>
              {quote ? (
                <div className="convert-amount convert-amount--result">
                  {fmtNum(quote.toAmount)}
                  {quoteToUsd !== null && (
                    <span className="convert-amount-usd"> ≈ ${fmtUsd(quoteToUsd)}</span>
                  )}
                </div>
              ) : (
                <div className="convert-amount convert-amount--placeholder">—</div>
              )}
            </div>
          </div>

          {/* Botó cotització */}
          <button
            className="btn btn-primary convert-quote-btn"
            onClick={getQuote}
            disabled={loadingQ || !usdAmount || parseFloat(usdAmount) <= 0}
          >
            {loadingQ
              ? <><i className="fa-solid fa-spinner fa-spin" /> Obtenint cotització…</>
              : <><i className="fa-solid fa-magnifying-glass-dollar" /> Obtenir cotització</>
            }
          </button>
        </div>

        {/* Error cotització */}
        {errorQ && (
          <div className="convert-error">
            <i className="fa-solid fa-triangle-exclamation" /> {errorQ}
          </div>
        )}

        {/* Resultat de la cotització */}
        {quote && (
          <div className="convert-quote-box">
            <div className="convert-quote-header">
              <span className="convert-quote-title">Cotització</span>
              <span className={`convert-quote-timer${quoteTimer <= 5 ? " convert-quote-timer--urgent" : ""}`}>
                <i className="fa-regular fa-clock" /> {quoteTimer}s
              </span>
            </div>

            <div className="convert-quote-rows">
              <div className="convert-quote-row">
                <span className="convert-quote-lbl">Envies</span>
                <span className="convert-quote-val">
                  {fmtNum(quote.fromAmount)} <b>{quote.fromAsset}</b>
                  {fromPrice > 0 && (
                    <span className="convert-quote-usd"> · ${fmtUsd(parseFloat(quote.fromAmount) * fromPrice)}</span>
                  )}
                </span>
              </div>
              <div className="convert-quote-row">
                <span className="convert-quote-lbl">Reps</span>
                <span className="convert-quote-val convert-quote-val--green">
                  {fmtNum(quote.toAmount)} <b>{quote.toAsset}</b>
                  {quoteToUsd !== null && (
                    <span className="convert-quote-usd"> · ${fmtUsd(quoteToUsd)}</span>
                  )}
                </span>
              </div>
              <div className="convert-quote-row">
                <span className="convert-quote-lbl">Taxa de canvi</span>
                <span className="convert-quote-val">1 {quote.fromAsset} = {fmtNum(quote.ratio, 6)} {quote.toAsset}</span>
              </div>
              <div className="convert-quote-row">
                <span className="convert-quote-lbl">Taxa inversa</span>
                <span className="convert-quote-val">1 {quote.toAsset} = {fmtNum(quote.inverseRatio, 6)} {quote.fromAsset}</span>
              </div>
              <div className="convert-quote-row convert-quote-row--fee">
                <span className="convert-quote-lbl">
                  <i className="fa-solid fa-circle-info" /> Cost real (spread)
                </span>
                <span className={`convert-quote-val convert-spread${
                  spread === null ? " convert-spread--unknown"
                  : spread < 0.2  ? " convert-spread--good"
                  : spread < 0.5  ? " convert-spread--mid"
                  :                 " convert-spread--bad"
                }`}>
                  {spread === null ? (
                    <span className="convert-quote-val--muted">No calculable (preu de mercat no disponible)</span>
                  ) : (
                    <>
                      <b>~{spread.toFixed(2)}%</b>
                      <span className="convert-spread-hint">
                        {spread < 0.2 ? " · Excel·lent" : spread < 0.5 ? " · Normal" : " · Car vs. spot (0.1%)"}
                      </span>
                      {quoteToUsd !== null && fromPrice > 0 && (
                        <span className="convert-spread-usd">
                          {" "}≈ ${(parseFloat(quote!.fromAmount) * fromPrice * spread / 100).toFixed(2)} perduts en spread
                        </span>
                      )}
                    </>
                  )}
                </span>
              </div>
            </div>

            {errorA && (
              <div className="convert-error">
                <i className="fa-solid fa-triangle-exclamation" /> {errorA}
              </div>
            )}

            <button
              className={`btn convert-accept-btn${isReal ? " convert-accept-btn--real" : ""}`}
              onClick={acceptQuote}
              disabled={loadingA || quoteTimer <= 0}
            >
              {loadingA
                ? <><i className="fa-solid fa-spinner fa-spin" /> Executant…</>
                : isReal
                  ? <><i className="fa-solid fa-bolt" /> Confirmar conversió REAL</>
                  : <><i className="fa-solid fa-check" /> Confirmar conversió</>
              }
            </button>
          </div>
        )}

        {/* Resultat de l'execució */}
        {result && (
          <div className="convert-result-box">
            <i className="fa-solid fa-circle-check" />
            Conversió executada: {fmtNum(result.fromAmount)} {result.fromAsset}
            &nbsp;→&nbsp;
            {fmtNum(result.toAmount)} {result.toAsset}
            <span className="convert-result-status">{result.orderStatus}</span>
          </div>
        )}
      </div>

      {/* Historial */}
      <div className="convert-history">
        <div className="section-title">
          <i className="fa-solid fa-clock-rotate-left" /> Historial de conversions
          <button className="convert-refresh-btn" onClick={loadHistory} title="Refresca">
            <i className={`fa-solid fa-rotate-right${loadingH ? " fa-spin" : ""}`} />
          </button>
        </div>

        {history.length === 0 && !loadingH && (
          <div className="state-empty">Sense historial de conversions</div>
        )}

        {history.length > 0 && (
          <table className="convert-history-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>De</th>
                <th>Cap a</th>
                <th>Taxa</th>
                <th>Comissió</th>
                <th>Estat</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h, i) => {
                const ratio = parseFloat(h.toAmount) / parseFloat(h.fromAmount);
                const fromUsd = prices[h.fromAsset] ?? (STABLE_ASSETS.has(h.fromAsset) ? 1 : 0);
                const toUsdP  = prices[h.toAsset]  ?? (STABLE_ASSETS.has(h.toAsset)  ? 1 : 0);
                const fromUsdVal = fromUsd > 0 ? parseFloat(h.fromAmount) * fromUsd : null;
                const toUsdVal   = toUsdP  > 0 ? parseFloat(h.toAmount)  * toUsdP  : null;
                return (
                  <tr key={h.orderId ?? i}>
                    <td className="convert-td-date">{h.createTime ? fmtDate(h.createTime) : "—"}</td>
                    <td>
                      <b>{fmtNum(h.fromAmount, 6)}</b> {h.fromAsset}
                      {fromUsdVal !== null && <span className="convert-td-usd"> ≈${fmtUsd(fromUsdVal)}</span>}
                    </td>
                    <td className="convert-td-green">
                      <b>{fmtNum(h.toAmount, 6)}</b> {h.toAsset}
                      {toUsdVal !== null && <span className="convert-td-usd"> ≈${fmtUsd(toUsdVal)}</span>}
                    </td>
                    <td className="convert-td-mono">1 {h.fromAsset} = {isNaN(ratio) ? "—" : fmtNum(ratio, 6)} {h.toAsset}</td>
                    <td className="convert-td-muted">{h.fee ? `${h.fee} ${h.feeAsset ?? ""}` : "Inclosa"}</td>
                    <td>
                      <span className={`convert-status convert-status--${h.orderStatus?.toLowerCase()}`}>
                        {h.orderStatus}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
