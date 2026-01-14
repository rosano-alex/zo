import { activeObserver, setObserver } from "./context";
import { epoch } from "./clock";
import { NodeFlags, type Node } from "./node";
import { LaneTypes } from "./lanetypes";

export class ComputedNode<T> implements Node {
  compute: () => T;
  value!: T;

  lane = LaneTypes.USER;
  flags = NodeFlags.DIRTY;

  deps: any[] = new Array(8);
  versions: number[] = new Array(8);
  depCount = 0;

  lastEpoch = -1;

  constructor(fn: () => T) {
    this.compute = fn;
  }

  observers: Node[] = [];

  get(): T {
    if (this.flags & NodeFlags.DIRTY || this.lastEpoch !== epoch) {
      this.recompute();
    }

    // Track this computed as a dependency of the active observer
    const obs = activeObserver;
    if (obs && this.observers.indexOf(obs) === -1) {
      this.observers.push(obs);
    }

    return this.value;
  }

  mark() {
    if (!(this.flags & NodeFlags.DIRTY)) {
      this.flags |= NodeFlags.DIRTY;

      // Propagate dirty marks to downstream observers
      for (let i = 0; i < this.observers.length; i++) {
        this.observers[i].mark();
      }
    }
  }

  run() {
    this.recompute();
  }

  private recompute() {
    const prev = activeObserver;
    setObserver(this);

    this.depCount = 0;

    try {
      const v = this.compute();
      this.value = v;
    } finally {
      setObserver(prev);
    }

    this.lastEpoch = epoch;
    this.flags = NodeFlags.CLEAN;
  }
}
