"use client";
import Image from "next/image";
import { useState } from "react";

const COLORS: Record<string, string> = {
  BTC: "#f7931a", ETH: "#627eea", BNB: "#f3ba2f", SOL: "#9945ff",
  XRP: "#346aa9", DOGE: "#c2a633", ADA: "#0033ad", AVAX: "#e84142",
  TRX: "#ef0027", DOT: "#e6007a", LINK: "#2a5ada", MATIC: "#8247e5",
  LTC: "#bfbbbb", SHIB: "#ffa409", UNI: "#ff007a", ATOM: "#6f7390",
  ETC: "#328332", XLM: "#14b6e7", APT: "#00cccc", NEAR: "#00c08b",
};

const ICON_URL = (symbol: string) =>
  `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/${symbol.toLowerCase()}.png`;

export default function CoinIcon({ symbol, size = 28 }: { symbol: string; size?: number }) {
  const [imgError, setImgError] = useState(false);
  const bg = COLORS[symbol] ?? "#4a5568";

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
