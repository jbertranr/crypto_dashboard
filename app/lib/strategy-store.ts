import { strategySet, strategyGetAll } from "./cache-store";

// key format: "oco:{orderListId}" | "ord:{orderId}"

export function setStrategy(key: string, strategy: string | null): void {
  strategySet(key, strategy);
}

export function getStrategies(): Record<string, string> {
  return strategyGetAll();
}
