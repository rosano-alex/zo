export const enum NodeFlags {
  CLEAN = 0,
  DIRTY = 1 << 0,
  QUEUED = 1 << 1,
  RUNNING = 1 << 2,
  DISPOSED = 1 << 3,
}

export interface Node {
  lane: number;
  flags: NodeFlags;
  observers?: Node[];
  mark(): void;
  run(): void;
}
