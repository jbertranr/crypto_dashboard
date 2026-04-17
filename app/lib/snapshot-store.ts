import { snapshotAdd, snapshotGetAll } from "./cache-store";

export interface Snapshot {
  time: number;
  value: number;
}

export function addSnapshot(s: Snapshot, mode: "paper" | "real" = "paper"): void {
  snapshotAdd(s.time, s.value, mode);
}

export function getSnapshots(mode: "paper" | "real" = "paper"): Snapshot[] {
  return snapshotGetAll(mode);
}
