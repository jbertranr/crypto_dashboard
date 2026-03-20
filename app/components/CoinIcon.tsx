"use client";
import Image from "next/image";
import { useState } from "react";

export const COIN_COLORS: Record<string, string> = {
  BTC:   "#F7931A", ETH:   "#627EEA", BNB:   "#F3BA2F", SOL:   "#14F195",
  XRP:   "#00AAE4", DOGE:  "#C2A633", ADA:   "#0033AD", AVAX:  "#E84142",
  TRX:   "#FF060A", DOT:   "#E6007A", LINK:  "#2A5ADA", MATIC: "#8247E5",
  POL:   "#8247E5", LTC:   "#BFBBBB", SHIB:  "#FFA409", UNI:   "#FF007A",
  ATOM:  "#6F7390", ETC:   "#328332", XLM:   "#14B6E7", APT:   "#00B4D8",
  NEAR:  "#00EC97", USDT:  "#26A17B", USDC:  "#2775CA", BUSD:  "#F0B90B",
  DAI:   "#F5AC37", PEPE:  "#47A838", WIF:   "#9B4FFF", BONK:  "#F7A51E",
  SUI:   "#6FBCF0", TON:   "#0098EA", FTM:   "#1969FF", ARB:   "#12AAFF",
  OP:    "#FF0420", INJ:   "#00A3FF", RUNE:  "#33FF99", FIL:   "#0090FF",
};

export function coinColor(symbol: string): string {
  return COIN_COLORS[symbol] ?? "#4a5568";
}

const ICON_URL = (symbol: string) =>
  `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/${symbol.toLowerCase()}.png`;

export default function CoinIcon({ symbol, size = 28 }: { symbol: string; size?: number }) {
  const [imgError, setImgError] = useState(false);
  const bg = coinColor(symbol);

  if (imgError) {
    return (
      <span
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: bg,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: size * 0.35,
          fontWeight: 700,
          color: "#fff",
          flexShrink: 0,
        }}
      >
        {symbol.slice(0, 2)}
      </span>
    );
  }

  return (
    <Image
      src={ICON_URL(symbol)}
      alt={symbol}
      width={size}
      height={size}
      style={{ borderRadius: "50%", flexShrink: 0 }}
      onError={() => setImgError(true)}
      unoptimized
    />
  );
}
