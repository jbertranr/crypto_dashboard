"use client";
import { ResponsiveContainer, LineChart, Line } from "recharts";

interface SparklineProps {
  prices: number[];
  positive: boolean;
  width?: number;
  height?: number;
}

export default function Sparkline({ prices, positive, width = 100, height = 40 }: SparklineProps) {
  const data = prices.map((price) => ({ price }));
  return (
    <ResponsiveContainer width={width} height={height}>
      <LineChart data={data}>
        <Line
          type="monotone"
          dataKey="price"
          stroke={positive ? "#10b981" : "#f87171"}
          dot={false}
          strokeWidth={1.5}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
