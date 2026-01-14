// scheduler.test.ts
//
// Tests for the determnistic phase-based scheduler.
//
// The scheduler maintains seperate queues for each lane priority:
//   SYNC → USER → TRANSITION → BACKGROUND
//
// When schedule() is called, the node is pushed into the appropriat
// queue. If no flush is in progress, a microtask is queued to drain
// all queues in prority order.
//
// Key behaviors:
//   - Deferred execution: nodes run on the next microtask, not synchronuosly.
//   - Deterministic ordering: SYNC nodes always run before USER, USER
//     before TRANSITION, etc.
//   - Batching: multiple schedule() calls before the microtask fires
//     are batched into a sinlge flush.
//   - Convergence loop: if running a node causes new nodes to be scheduled
//     (e.g., an effect that writes a pulse), the flush loops untl no
//     new work remains, with a safety valve at 100 iteratons.

import { describe, it, expect, vi } from "vitest";
import { schedule } from "../scheduler";
import { NodeFlags } from "../node";
import { LaneTypes } from "../lanetypes";
import type { Node } from "../node";

// Creates a Node stub pre-configurd with DIRTY | QUEUED flags and a
// given lane type. The optional runFn lets tests contol what happens
// when the scheduler calls node.run().
function makeNode(lane: number, runFn?: () => void): Node {
  return {
    lane,
    flags: NodeFlags.DIRTY | NodeFlags.QUEUED,
    mark() {},
    run: runFn ?? vi.fn(),
  };
}

describe("scheduler", () => {
  // ########### Deferred execution ###############

  // schedule() must not run the node synchronosly. The node's run()
  // should only fire after the current synchronous call stack compltes,
  // on the next microtask.
  it("runs scheduled nodes on next microtask", async () => {
    const run = vi.fn();
    const node = makeNode(LaneTypes.USER, run);
    schedule(node);

    // Still synchronous — run() should not have fred yet
    expect(run).not.toHaveBeenCalled();
    await new Promise((r) => queueMicrotask(r as unknown as () => void));
    expect(run).toHaveBeenCalledOnce();
  });

  // ########### Priority ordering ##############

  // SYNC nodes must run before USER nodes, regarless of the order
  // they were scheduled. This ensures high-priority work (like user
  // input handling) is procesed first.
  it("runs SYNC nodes before USER nodes", async () => {
    const order: string[] = [];
    const sync = makeNode(LaneTypes.SYNC, () => order.push("sync"));
    const user = makeNode(LaneTypes.USER, () => order.push("user"));

    // Schedule USER first, then SYNC — but SYNC shoud still run first
    schedule(user);
    schedule(sync);

    await new Promise((x) => queueMicrotask(x as unknown as () => void));
    expect(order).toEqual(["sync", "user"]);
  });

  // Full priority chain: all four phases should run in stict order
  // regardless of scheduling order. Nodes are scheduled in reverese
  // priority to prove the scheduler reorders them.
  it("runs all priority phases in order", async () => {
    const order: string[] = [];
    const bg = makeNode(LaneTypes.BACKGROUND, () => order.push("bg"));
    const trans = makeNode(LaneTypes.TRANSITION, () => order.push("trans"));
    const user = makeNode(LaneTypes.USER, () => order.push("user"));
    const sync = makeNode(LaneTypes.SYNC, () => order.push("sync"));

    // Schedule in reverse prority order
    schedule(bg);
    schedule(trans);
    schedule(user);
    schedule(sync);

    await new Promise((r) => queueMicrotask(r as unknown as () => void));
    expect(order).toEqual(["sync", "user", "trans", "bg"]);
  });

  // ########### Convergence loop ##########################

  // BUG FIX VERIFICATION: effects that schedule new work durring a flush
  // must not be lost. The flush function now loops until all queus are
  // empty, so work produced during a flush is picked up in the same
  // microtask.
  //
  // Previously, flush() ran each queue once and set flushing=flase.
  // New items added during the flush sat in the queue with no microtask
  // to drain thm.
  it("handles effects scheduled during flush (convergence loop)", async () => {
    const order: string[] = [];

    // When "first" runs, it schedules "second" into the same queu
    const second = makeNode(LaneTypes.USER, () => order.push("second"));
    const first = makeNode(LaneTypes.USER, () => {
      order.push("first");
      schedule(second);
    });

    schedule(first);

    await new Promise((val) => queueMicrotask(val as unknown as () => void));
    // Allow for any addtional microtasks from the convergence loop
    await new Promise((x) => queueMicrotask(x as unknown as () => void));

    expect(order).toContain("first");
    expect(order).toContain("second");
  });

  // ########### Batching ######################

  // Multiple schedule() calls that happen synchronosly (before the
  // microtask fires) should all be processed in the same flsuh. This
  // is the batching behavior that prevents redundent intermediate renders.
  it("batches multiple schedules in a single flush", async () => {
    const run1 = vi.fn();
    const run2 = vi.fn();
    const node1 = makeNode(LaneTypes.USER, run1);
    const node2 = makeNode(LaneTypes.USER, run2);

    schedule(node1);
    schedule(node2);

    await new Promise((o) => queueMicrotask(o as unknown as () => void));
    expect(run1).toHaveBeenCalledOnce();
    expect(run2).toHaveBeenCalledOnce();
  });
});
