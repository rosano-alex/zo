import type { Node } from "./node";
import { NodeFlags } from "./node";
import type { PulseNode } from "./pulse";
import type { ComputedNode } from "./computed";
import { activeObserver, setObserver } from "./context";
import { Scope, activeScope } from "./scope";

// #################################
// Lane types
// #################################

/**
 * Priority levels for concurrent lanes.
 *
 * Modelled after React's lane priorities:
 *
 *   sync       — Highest priority. User-initiated mutations (clicks, typing).
 *                Runs to completion without yielding. Equivalent to the
 *                current synchronous flush behavior.
 *
 *   transition — Medium priority. Non-urgent updates (navigation, data
 *                fetching results). Can be interrupted by sync work and
 *                resumed later. Maps to React's startTransition().
 *
 *   idle       — Lowest priority. Background work (pre-rendering off-screen
 *                content, analytics). Only runs when no sync or transition
 *                work is pending. Maps to requestIdleCallback semantics.
 */
export type Priority = "sync" | "transition" | "idle";

const PRIORITY_ORDER: Record<Priority, number> = {
  sync: 0,
  transition: 1,
  idle: 2,
};

let nextLaneId = 1;

// #################################
// Lane
// #################################

/**
 * Lane
 * ----
 *
 * A concurrent execution context that maintains an isolated fork of
 * the reactive graph's pulse values.
 *
 * Lanes are the mechanism that makes lane-x compatible with React's
 * concurrent rendering model. When React starts a transition, the
 * corresponding lane captures pulse writes without mutating the base
 * graph. Multiple lanes can be active simultaneously (one per React
 * lane), each seeing a consistent snapshot of pulse state.
 *
 * Lifecycle:
 *
 *   const lane = forkLane('transition')
 *
 *   lane.run(() => {
 *     count.set(5)                    // writes to lane, not base
 *     console.log(count.get())        // → 5 (reads lane override)
 *   })
 *
 *   console.log(count.get())          // → 0 (base unchanged)
 *
 *   lane.commit()                     // applies 5 to base, propagates
 *   console.log(count.get())          // → 5
 *
 * Computed nodes within a lane:
 *
 *   When a computed is read within a lane, the lane re-evaluates the
 *   computation using its own pulse overrides (falling back to base
 *   values for pulses the lane hasn't touched). The result is cached
 *   per-lane so the same computed is not recomputed on every read.
 *
 * Abort:
 *
 *   lane.abort() discards all overrides. This corresponds to React
 *   abandoning an interrupted transition in favor of a higher-priority
 *   update.
 */
export class Lane {
  /**
   * Unique identifier for this lane.
   *
   * Used as a key in maps and for debugging. Monotonically increasing
   * across all lanes created in this runtime.
   */
  readonly id: number;

  /**
   * The lane's scheduling priority.
   *
   * Determines when the lane's work is flushed relative to other lanes:
   *
   *   sync       → immediate, uninterruptible
   *   transition → can be deferred, interruptible
   *   idle       → only when no higher-priority work is pending
   */
  readonly priority: Priority;

  /**
    * Pulse overrides within this lane.
   *
   * When a pulse is set() within this lane's context, the new value
   * is stored here instead of on the pulse itself. When a pulse is
   * get() within this lane, this map is checked first.
   *
   * On commit(), these overrides are applied to the base pulses.
   * On abort(), they are discarded.
   */
  pulseOverrides: Map<PulseNode<any>, any> = new Map();

  /**
   * Cached computed results within this lane.
   *
   * When a computed is evaluated within this lane, its result (derived
   * from this lane's pulse overrides) is cached here. This prevents
   * redundant recomputation when the same computed is read multiple
   * times within the lane.
   *
   * Invalidated when a pulse the computed depends on is written to
   * within the lane.
   */
  computedCache: Map<ComputedNode<any>, any> = new Map();

  /**
   * Set of computed nodes that need recomputation within this lane.
   *
   * When a pulse override is set, all downstream computeds are added
   * here. On the next read, the computed is recomputed using lane
   * values before returning.
   */
  dirtyComputeds: Set<ComputedNode<any>> = new Set();

  /**
   * Nodes scheduled for execution within this lane.
   *
   * Effects triggered by pulse writes within this lane are queued
   * here rather than in the global scheduler. They are flushed
   * according to the lane's priority, and only committed effects
   * propagate to the base graph.
   */
  pendingEffects: Node[] = [];

  /**
   * Current lifecycle status.
   *
   *   active    — accepting reads and writes
   *   committed — overrides have been applied to base; lane is done
   *   aborted   — overrides discarded; lane is done
   */
  status: "active" | "committed" | "aborted" = "active";

  /**
   * Optional scope that owns this lane. When the scope is disposed,
   * the lane is automatically aborted.
   */
  scope: Scope | null;

  /**
   * Parent lane, if this lane was forked from another lane.
   *
   * When reading a pulse, the lookup chain is:
   *   this lane's overrides → parent lane's overrides → base value
   *
   * This enables nested concurrent contexts (e.g., a transition
   * within a transition).
   */
  parent: Lane | null;

  constructor(priority: Priority, parent: Lane | null = null) {
    this.id = nextLaneId++;
    this.priority = priority;
    this.parent = parent;
    this.scope = activeScope;

    // If created within a scope, register for automatic cleanup.
    if (this.scope) {
      this.scope.onCleanup(() => {
        if (this.status === "active") {
          this.abort();
        }
      });
    }
  }

  /**
   * run()
   *
   * Executes a function within this lane's concurrent context.
   *
   * All pulse reads and writes inside fn() are redirected through
   * this lane's override layer. Multiple calls to run() on the same
   * lane accumulate overrides — they don't reset.
   *
   * @param fn - The function to execute within this lane.
   * @returns The return value of fn.
   * @throws If the lane has been committed or aborted.
   */
  run<T>(fn: () => T): T {
    if (this.status !== "active") {
      throw new Error(`Cannot run in a ${this.status} lane`);
    }

    setActiveLane(this);

    try {
      return fn();
    } finally {
      setActiveLane(null);
    }
  }

  /**
   * read()
   *
   * Reads a pulse's value within this lane's context.
   *
   * Lookup order:
   *   1. This lane's pulseOverrides
   *   2. Parent lane's overrides (recursive)
   *   3. pulse's base value
   *
   * Called by pulseNode.get() when an active lane is detected.
   *
   * @param pulse - The pulse to read.
   * @returns The value visible to this lane.
   */
  read<T>(pulse: PulseNode<T>): T {
    if (this.pulseOverrides.has(pulse)) {
      return this.pulseOverrides.get(pulse) as T;
    }
    if (this.parent) {
      return this.parent.read(pulse);
    }
    return pulse.value;
  }

  /**
   * write()
   *
   * Writes a pulse value within this lane's context.
   *
   * The value is stored in pulseOverrides — the pulse's base value
   * is not mutated. Downstream computed nodes within this lane are
   * marked dirty so they recompute on the next read.
   *
   * Called by pulseNode.set() when an active lane is detected.
   *
   * @param pulse - The pulse to write to.
   * @param value  - The new value.
   */
  write<T>(pulse: PulseNode<T>, value: T): void {
    // Check against the lane-visible value, not the base.
    const current = this.read(pulse);
    if (Object.is(current, value)) return;

    this.pulseOverrides.set(pulse, value);

    // Invalidate downstream computeds within this lane.
    this.invalidateDownstream(pulse);
  }

  /**
   * readComputed()
   *
   * Reads a computed node's value within this lane's context.
   *
   * If the computed has been invalidated (a dependency was overridden
   * in this lane), it is recomputed using lane-visible pulse values.
   * The result is cached per-lane.
   *
   * Called by ComputedNode.get() when an active lane is detected.
   *
   * @param node - The computed node to read.
   * @returns The computed value visible to this lane.
   */
  readComputed<T>(node: ComputedNode<T>): T {
    // If cached and not dirty, return cached value.
    if (this.computedCache.has(node) && !this.dirtyComputeds.has(node)) {
      return this.computedCache.get(node) as T;
    }

    // Recompute within this lane's context.
    const value = this.recompute(node);
    this.computedCache.set(node, value);
    this.dirtyComputeds.delete(node);
    return value;
  }

  /**
   * commit()
   *
   * Applies all pulse overrides to the base graph and triggers
   * normal propagation.
   *
   * This is the point where a concurrent lane "becomes real" — all
   * the speculative writes are flushed to the base pulses, which
   * triggers markDirty() and the global scheduler as usual.
   *
   * After commit(), the lane is done and cannot be used further.
   *
   * @throws If the lane is not active.
   */
  commit(): void {
    if (this.status !== "active") {
      throw new Error(`Cannot commit a ${this.status} lane`);
    }

    this.status = "committed";

    // Apply overrides to base pulses. Each set() call triggers
    // normal propagation (markDirty → schedule → flush).
    for (const [pulse, value] of this.pulseOverrides) {
      pulse.set(value);
    }

    this.cleanup();
  }

  /**
   * abort()
   *
   * Discards all overrides and marks the lane as aborted.
   *
   * No base pulse values are modified. Any work computed within
   * this lane is thrown away. Corresponds to React abandoning an
   * interrupted render.
   *
   * @throws If the lane is not active.
   */
  abort(): void {
    if (this.status !== "active") return; // idempotent for cleanup

    this.status = "aborted";
    this.cleanup();
  }

  /**
   * fork()
   *
   * Creates a child lane that inherits this lane's overrides.
   *
   * The child lane sees this lane's overrides via the parent chain,
   * and can add its own on top. Committing the child applies its
   * overrides to THIS lane (not the base), so the parent lane can
   * choose to commit or abort the combined set.
   *
   * @param priority - The child lane's priority (defaults to parent's).
   * @returns A new child Lane.
   */
  fork(priority?: Priority): Lane {
    if (this.status !== "active") {
      throw new Error(`Cannot fork a ${this.status} lane`);
    }
    return new Lane(priority ?? this.priority, this);
  }

  // ── Private ──────────────────────────────────────────────────────

  /**
   * Recomputes a computed node using this lane's pulse values.
   *
   * Temporarily activates this lane so that any pulse.get() calls
   * within the computation read from the lane's overrides.
   */
  private recompute<T>(node: ComputedNode<T>): T {
    setActiveLane(this);

    // Save and restore the active observer so nested recompute() calls
    // (e.g. a lane-local computed that reads another computed) don't
    // clobber the outer context by setting observer to null unconditionally.
    const prevObserver = activeObserver;
    setObserver(node as unknown as Node);

    let value: T;
    try {
      value = (node as any).compute();
    } finally {
      setObserver(prevObserver);
      setActiveLane(null);
    }

    return value;
  }

  /**
   * Marks all downstream computed nodes as dirty within this lane.
   *
   * Walks the observer graph starting from the given pulse to find
   * all computed nodes that transitively depend on it.
   */
  private invalidateDownstream(pulse: PulseNode<any>): void {
    const visited = new Set<Node>();

    const walk = (observers: Node[]) => {
      for (const obs of observers) {
        if (visited.has(obs)) continue;
        visited.add(obs);

        // If it's a ComputedNode (has a compute method), mark dirty in this lane
        if ("compute" in obs) {
          this.dirtyComputeds.add(obs as unknown as ComputedNode<any>);
        }

        // If it's an EffectNode (has a dispose method but no compute), queue it
        if ("dispose" in obs && !("compute" in obs)) {
          this.pendingEffects.push(obs);
        }

        // Continue walking downstream
        if (obs.observers && obs.observers.length > 0) {
          walk(obs.observers);
        }
      }
    };

    walk(pulse.observers);
  }

  /**
   * Releases all internal state after commit or abort.
   */
  private cleanup(): void {
    this.pulseOverrides.clear();
    this.computedCache.clear();
    this.dirtyComputeds.clear();
    this.pendingEffects.length = 0;
  }
}

// #################################
// Active lane tracking
// #################################

/**
 * The lane stack allows nested lane.run() calls (e.g., a lane forking
 * a child lane within its run block).
 */
const laneStack: (Lane | null)[] = [];

/**
 * The currently active lane. When non-null, pulse reads/writes are
 * redirected through this lane's override layer.
 *
 * Read by pulseNode.get() and pulseNode.set().
 */
export let activeLane: Lane | null = null;

function setActiveLane(lane: Lane | null) {
  if (lane === null) {
    laneStack.pop();
    activeLane = laneStack[laneStack.length - 1] ?? null;
  } else {
    laneStack.push(lane);
    activeLane = lane;
  }
}

// #################################
// Convenience API
// #################################

/**
 * forkLane()
 *
 * Creates a new concurrent lane with the specified priority.
 *
 * If called within an existing lane's run() block, the new lane is
 * a child of the active lane and inherits its overrides.
 *
 * @param priority - The lane's scheduling priority. Defaults to 'transition'.
 * @returns A new Lane.
 */
export function forkLane(priority: Priority = "transition"): Lane {
  return new Lane(priority, activeLane);
}

/**
 * transition()
 *
 * Convenience for creating a transition-priority lane, running a
 * function in it, and committing the result.
 *
 * This is the lane-x equivalent of React's startTransition():
 *
 *   transition(() => {
 *     count.set(5)        // buffered in lane
 *     filter.set('new')   // buffered in lane
 *   })
 *   // Both writes are now applied atomically to the base graph.
 *
 * @param fn - The function containing pulse writes to buffer.
 */
export function transition(fn: () => void): void {
  const lane = forkLane("transition");
  lane.run(fn);
  lane.commit();
}

/**
 * speculate()
 *
 * Runs a function in a lane and returns the lane without committing,
 * allowing the caller to inspect computed values before deciding
 * whether to commit or abort.
 *
 *   const lane = speculate(() => {
 *     expensivepulse.set(newData)
 *   })
 *
 *   // Check if the result is acceptable
 *   const preview = lane.run(() => derivedComputed.get())
 *
 *   if (acceptable(preview)) {
 *     lane.commit()
 *   } else {
 *     lane.abort()
 *   }
 *
 * @param fn       - The function containing speculative pulse writes.
 * @param priority - Lane priority. Defaults to 'transition'.
 * @returns The active lane (not yet committed).
 */
export function speculate(
  fn: () => void,
  priority: Priority = "transition",
): Lane {
  const lane = forkLane(priority);
  lane.run(fn);
  return lane;
}
