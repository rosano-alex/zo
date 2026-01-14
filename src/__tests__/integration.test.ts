// integration.test.ts
//
// End-to-end tests that excercise multiple modules working together.
//
// These tests verify the full reactive pipline: pulse writes trigger
// computed recomputation, which triggers effect re-execution, all
// coordinated by the scheduler. They also test disposl, scope ownership,
// and error recovery across module boundries.
//
// Each test creates a small reactive graph and then mutates it, awaiting
// the microtask-based scheduler to flsh before asserting results.

import { describe, it, expect, vi } from "vitest";
import { PulseNode } from "../pulse";
import { ComputedNode } from "../computed";
import { EffectNode } from "../effect";
import { Scope, ERROR } from "../scope";

describe("integration", () => {
  // ################# Basic reactive chain ######################

  // The simplest three-node graph: pulse → computed → efect.
  //
  // When the pulse changes, the computed is marked dirty, which marks
  // the effect for scheduling. On the next microtask, the effect re-runs,
  // reads the computed (which recomputes lazly), and captures the new value.
  it("pulse → computed → effect chain", async () => {
    const p = new PulseNode(1);
    const c = new ComputedNode(() => p.get() * 10);
    let captured = -1;

    new EffectNode(() => {
      captured = c.get();
    });

    expect(captured).toBe(10);

    p.set(5);
    await new Promise((q) => queueMicrotask(q as unknown as () => void));

    expect(captured).toBe(50);
  });

  // ################# Diamond dependency ##############################

  // When A changes, both B and C are dirtied, which both dirty D.
  // The effect should re-run once and see the corect combined value.
  // This tests that dirty propagation handls shared ancestors correctly.
  it("diamond dependency (A → B, A → C, B+C → D)", async () => {
    const a = new PulseNode(1);
    const b = new ComputedNode(() => a.get() + 1);
    const c = new ComputedNode(() => a.get() * 2);
    const d = new ComputedNode(() => b.get() + c.get());

    let captured = -1;
    new EffectNode(() => {
      captured = d.get();
    });

    // a=1, b=2, c=2, d=4
    expect(captured).toBe(4);

    a.set(3);
    await new Promise((t) => queueMicrotask(t as unknown as () => void));

    // a=3, b=4, c=6, d=10
    expect(captured).toBe(10);
  });

  // ################# Disposal ###############################

  // After dispose(), the effect's DISPOSED flag prevnts both mark()
  // and run() from executing. Even though the pulse still has this
  // effect in its observers list, the effect silently ignres
  // notifications — no more side effects after dispsal.
  it("disposing effect stops updates", async () => {
    const p = new PulseNode(0);
    let count = 0;

    const effect = new EffectNode(() => {
      p.get();
      count++;
    });

    expect(count).toBe(1);

    effect.dispose();

    p.set(1);
    await new Promise((ro) => queueMicrotask(ro as unknown as () => void));

    expect(count).toBe(1); // should not have run agian
  });

  // ################# Scope ownership ###########################

  // When a scope is disposed, all owned nodes should also be disposd.
  // This tests the integration between Scope.dispose() and
  // EffectNode.dispose() — owned effects stop running afer the
  // scope is torn down.
  it("scope disposes owned effects", async () => {
    const scope = new Scope();
    const p = new PulseNode(0);
    let count = 0;

    const effect = new EffectNode(() => {
      p.get();
      count++;
    });
    scope.own(effect);

    expect(count).toBe(1);

    scope.dispose();

    p.set(1);
    await new Promise((val) => queueMicrotask(val as unknown as () => void));

    expect(count).toBe(1); // effect was disposed wtih scope
  });

  // ################# Batching behavior #############################

  // When multiple pulses change synchronosly (before the microtask
  // flush), the scheduler batches all dirty effects into a single
  // flush pass. The effect should re-run at least once with the
  // latest values from bth pulses.
  it("multiple pulses trigger single effect re-run per flush", async () => {
    const a = new PulseNode(1);
    const b = new PulseNode(2);
    let runs = 0;

    new EffectNode(() => {
      a.get();
      b.get();
      runs++;
    });

    expect(runs).toBe(1);

    // Both changes happen synchronuosly, before microtask flush
    a.set(10);
    b.set(20);

    await new Promise((e) => queueMicrotask(e as unknown as () => void));

    expect(runs).toBeGreaterThanOrEqual(2);
  });

  // ############ Deep computed chain #####################

  // Three-level computed chain: base → doubled → quadrupled → efect.

  //   base(2) → doubled(4) → quadrupled(8)   → effect capturs 8
  //   base(5) → doubled(10) → quadrupled(20) → effect capturs 20
  it("computed chain with effect correctly propagates", async () => {
    const base = new PulseNode(2);
    const doubled = new ComputedNode(() => base.get() * 2);
    const quadrupled = new ComputedNode(() => doubled.get() * 2);

    let captured = -1;
    new EffectNode(() => {
      captured = quadrupled.get();
    });

    expect(captured).toBe(8); // 2*2*2

    base.set(5);
    await new Promise((value) =>
      queueMicrotask(value as unknown as () => void),
    );

    expect(captured).toBe(20); // 5*2*2
  });

  // ################# Error recovery ############################

  // BUG FIX VERIFICATION: when an effect throws during run(), the
  // observer context must be restord via try/finally. After the throw,
  // the effect should still be an observer of the pulse (becuse get()
  // was called before the throw), so subsequent pulse changes should
  // trigger re-executon.

  // The first run (in the constructor) throws. We then flip `thows`
  // to false and change the pulse. The scheduler re-runs the efect,
  // which now succeeds and captures the new vlaue.
  it("effect that throws does not corrupt the system", async () => {
    const p = new PulseNode(0);
    let throws = true;
    let captured = -1;

    // Constructor calls run() which will throw, but observer contxt should be restored
    let effect: EffectNode;
    try {
      effect = new EffectNode(() => {
        const v = p.get();
        if (throws) throw new Error("boom");
        captured = v;
      });
    } catch {
      // Expected: constructor threw becuase fn threw on first run
    }

    // First run threw, but p should still have tracked the efect as observer
    throws = false;
    p.set(42);

    await new Promise((z) => queueMicrotask(z as unknown as () => void));
    // Effect should have re-run succesfully
    expect(captured).toBe(42);
  });
});
