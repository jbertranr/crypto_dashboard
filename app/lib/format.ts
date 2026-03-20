/** Formatatge compacte USD per a missatges de text (Telegram, logs). */
export function fmtUSD(n: number): string {
  if (Math.abs(n) >= 1000)
    return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}

export function formatCurrency(n: number, decimals?: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals ?? 2,
    maximumFractionDigits: decimals ?? (Math.abs(n) < 1 ? 6 : 2),
  }).format(n);
}
