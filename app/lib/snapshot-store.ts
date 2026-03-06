import { snapshotAdd, snapshotGetAll } from "./cache-store";

export interface Snapshot {
  time: number;
  value: number;
}

export function addSnapshot(s: Snapshot): void {
  snapshotAdd(s.time, s.value);
}

export function getSnapshots(): Snapshot[] {
  return snapshotGetAll();
}
