import type { Node } from "./node";
import { LaneTypes } from "./lanetypes";

// deterministic scheduler phases
const phaseQueue: Record<number, Node[]> = {
  [LaneTypes.SYNC]: [],
  [LaneTypes.USER]: [],
  [LaneTypes.TRANSITION]: [],
  [LaneTypes.BACKGROUND]: [],
};

let flushing = false;

export function schedule(node: Node) {
  const lane = node.lane;
  if (phaseQueue[lane] != null) {
    phaseQueue[lane].push(node);
  }

  if (!flushing) {
    flushing = true;
    queueMicrotask(flush);
  }
}

function runQueue(queue: Node[]) {
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i];
    if (node) {
      node.run();
    }
  }

  queue.length = 0;
}

function hasWork(): boolean {
  return (
    phaseQueue[LaneTypes.SYNC].length > 0 ||
    phaseQueue[LaneTypes.USER].length > 0 ||
    phaseQueue[LaneTypes.TRANSITION].length > 0 ||
    phaseQueue[LaneTypes.BACKGROUND].length > 0
  );
}

function flush() {
  // Re-run phases until no new work is produced (effects may schedule more effects)
  let iterations = 0;
  do {
    runQueue(phaseQueue[LaneTypes.SYNC] as Node[]);
    runQueue(phaseQueue[LaneTypes.USER] as Node[]);
    runQueue(phaseQueue[LaneTypes.TRANSITION] as Node[]);
    runQueue(phaseQueue[LaneTypes.BACKGROUND] as Node[]);

    // Safety valve to prevent infinite loops from cyclic effects
    if (++iterations > 100) {
      break;
    }
  } while (hasWork());

  flushing = false;
}
