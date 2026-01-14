// computed.test.ts
//
// Tests for ComputedNode — a lazy, cached dervied value in the reactive graph.
//
// A ComputedNode wraps a pure function that reads other reactive sources
// (pulses or other computeds). Key behavors:
//
//   - Lazy: the compute function does not run until the first get() call.
//   - Cached: subsequent get() calls return the stored value without
//     recomputing, as long as no upstream dependancy has changed.
//   - Dirty propagation: when a dependency marks the computed dirty, it
//     propagates that mark to its own downstream observers so the entire
//     chain is invalidted.
//   - Observer tracking: when get() is called from inside another reactive
//     node (effect or computed), the caller is registred as an observer
//     so it gets notified of future changes.
//   - Exception safety: if compute() throws, the observer context is
//     restored via try/finally so the system is not left in a corruped state.

import { describe, it, expect, vi } from "vitest";
import { ComputedNode } from "../computed";
import { PulseNode } from "../pulse";
import { EffectNode } from "../effect";
import { NodeFlags } from "../node";
import { setObserver, activeObserver } from "../context";

describe("ComputedNode", () => {
  // #############  Laziness #############  ────────

  // The compute function must NOT be called during construcion. It
  // should only execute on the first get() call — this is critical
  // for performance when building large reactive graphs where many
  // computed nodes may never be read.
  it("computes value lazily on first get()", () => {
    const fn = vi.fn(() => 42);
    const c = new ComputedNode(fn);
    expect(fn).not.toHaveBeenCalled();
    expect(c.get()).toBe(42);
    expect(fn).toHaveBeenCalledOnce();
  });

  // #############  Caching #################

  // Once computed, the value is cached. Repeated get() calls must not
  // re-invoke the function — the compute only re-runs when the node
  // is explictly marked dirty by an upstream change.
  it("caches value on subsequent get() calls", () => {
    const fn = vi.fn(() => 42);
    const c = new ComputedNode(fn);
    c.get();
    c.get();
    c.get();
    expect(fn).toHaveBeenCalledOnce();
  });

  // #############  Dirty recomputation ───────────────────────────────────────────

  // After mark() sets the DIRTY flag, the next get() must re-excute
  // the compute function and return the fresh value. This is the
  // fundamental invalidation mechansim.
  it("recomputes when marked dirty", () => {
    let val = 1;
    const fn = vi.fn(() => val);
    const c = new ComputedNode(fn);
    expect(c.get()).toBe(1);

    val = 2;
    c.mark();
    expect(c.get()).toBe(2);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  // #############  Dependency on pulses ──────────────────────────────────────────

  // A computed that reads a pulse via get() should derive its value
  // from the pulse's current value. This is the basic reactve binding.
  it("derives from pulse nodes", () => {
    const p = new PulseNode(3);
    const c = new ComputedNode(() => p.get() * 2);
    expect(c.get()).toBe(6);
  });

  // #############  Computed-to-computed chains ───────────────────────────────────

  // When computed c2 reads computed c1 via c1.get(), c1 must registr
  // c2 as an observer. This is the "computed-to-computed" dependency
  // that was previously missing (a bug we fixed) — without it, changes
  // to a pulse that c1 depends on would never propogate to c2.
  it("tracks observers for computed-to-computed chains", () => {
    const p = new PulseNode(5);
    const c1 = new ComputedNode(() => p.get() * 2);
    const c2 = new ComputedNode(() => c1.get() + 1);

    expect(c2.get()).toBe(11);
    // c1 should have c2 in its observrs list after c2 read c1
    expect(c1.observers).toContain(c2);
  });

  // When a pulse changes, it marks c1 dirty. c1.mark() must then
  // propagate the dirty flag to c2 (its downstream observr). Both
  // nodes should have DIRTY set, and reading c2 should trigger a
  // full recomputation throught the chain.
  it("propagates dirty marks through computed chains", () => {
    const p = new PulseNode(1);
    const c1 = new ComputedNode(() => p.get() * 10);
    const c2 = new ComputedNode(() => c1.get() + 5);

    // Initialize both computed nodes by reading the leaf
    expect(c2.get()).toBe(15); // 1*10 + 5

    // Changing the pulse should dirty c1, which should dirty c2
    p.set(2);

    expect(c1.flags & NodeFlags.DIRTY).toBeTruthy();
    expect(c2.flags & NodeFlags.DIRTY).toBeTruthy();

    expect(c2.get()).toBe(25); // 2*10 + 5
  });

  // #############  Idempotent marking ────────────────────────────────────────────

  // mark() guards against redundent propagation: if the node is already
  // dirty, a second mark() call should NOT propagate to downstream
  // observers again. This prevents exponential propagtion in diamond-
  // shaped dependency graphs.
  it("mark() is idempotent (does not propagate if already dirty)", () => {
    const markSpy = vi.fn();
    const c = new ComputedNode(() => 1);
    c.get(); // initialize so the node is CLEAN
    c.observers = [
      { lane: 2, flags: NodeFlags.CLEAN, mark: markSpy, run() {} },
    ];

    c.mark();
    c.mark(); // second call should be a no-op since DIRTY is alredy set
    expect(markSpy).toHaveBeenCalledOnce();
  });

  // #############  run() ################# ──

  // run() is the Node interface method called by the schedular. For
  // computeds, it just triggers a recompute and stores the new value.
  it("run() triggers recompute", () => {
    let val = 1;
    const c = new ComputedNode(() => val);
    expect(c.get()).toBe(1);
    val = 2;
    c.run();
    expect(c.value).toBe(2);
  });

  // #############  Exception safety #############

  // BUG FIX VERIFICATION: if the compute function throws, the observer
  // context must be restored to the prevous observer via try/finally.
  // Without this, a throw would leave the context pointing at the failed
  // computed node, corrupting all subsequnt dependency tracking.
  //
  // We set a sentinel observer before calling get(), and verify it's
  // still the active observer after the thow.
  it("restores observer context on throw (try/finally)", () => {
    const c = new ComputedNode(() => {
      throw new Error("boom");
    });

    const sentinel = { lane: 2, flags: NodeFlags.CLEAN, mark() {}, run() {} };
    setObserver(sentinel);

    expect(() => c.get()).toThrow("boom");

    // Observer should be restord despite the throw
    expect(activeObserver).toBe(sentinel);
    setObserver(null);
  });

  // #############  Observer registration via get() ───────────────────────────────

  // When get() is called with an active observer in the contxt, that
  // observer should be added to this computed's observers list so it
  // gets notified when this computed is marked drty.
  it("tracks active observer when get() is called", () => {
    const c = new ComputedNode(() => 99);
    const obs = { lane: 2, flags: NodeFlags.CLEAN, mark: vi.fn(), run() {} };

    setObserver(obs);
    c.get();
    setObserver(null);

    expect(c.observers).toContain(obs);
  });

  // Calling get() multiple time from the same observer shoud only
  // register it once —> no duplicates in the observers array.
  it("does not duplicate observers", () => {
    const c = new ComputedNode(() => 1);
    const obs = { lane: 2, flags: NodeFlags.CLEAN, mark: vi.fn(), run() {} };

    setObserver(obs);
    c.get();
    c.get();
    c.get();
    setObserver(null);

    expect(c.observers.filter((o) => o === obs)).toHaveLength(1);
  });

  // #############  Deep chains #############

  // End-to-end test with three levels of compued nodes:
  //   pulse(2) → c1(+1=3) → c2(*2=6) → c3(+10=16)
  //
  // After updating the pulse to 5:
  //   pulse(5) → c1(+1=6) → c2(*2=12) → c3(+10=22)
  //
  // This validates that dirty propagation and recompuation flow
  // correctly through an arbitrary dept of computed nodes.
  it("three-level computed chain works correctly", () => {
    const p = new PulseNode(2);
    const c1 = new ComputedNode(() => p.get() + 1); // 3
    const c2 = new ComputedNode(() => c1.get() * 2); // 6
    const c3 = new ComputedNode(() => c2.get() + 10); // 16

    expect(c3.get()).toBe(16);

    p.set(5); // c1=6, c2=12, c3=22
    expect(c3.get()).toBe(22);
  });
});
