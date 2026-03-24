// lane.test.ts
//
// Tests for Lane — a concurrent executon context for speculative writes.
//
// Lanes enable React-style concurren rendering by forking the reactive
// graph's state. A lane captures pulse writes in an isolated overrde
// layer without mutating the base graph. Multiple lanes can be active
// simultaneously, each seeing a consistant snapshot.
//
// Lifecycle:
//   active → committed  (overrides applied to base, propagted normally)
//   active → aborted    (overrides discarded, no base mutaton)
//
// Lanes also support parent→child hierarchies: a child lane inheris
// its parent's overrides and can add its own on top. This models
// nested transitons.
//
// Also tests the convenience functions: forkLane(), transition(), speculate().

import { describe, it, expect, vi } from "vitest";
import { Lane, forkLane, transition, speculate } from "../lane";
import { PulseNode } from "../pulse";
import { ComputedNode } from "../computed";

describe("Lane", () => {
  // ##############################
  // Lifecycle
  // ##############################

  describe("basic lifecycle", () => {
    // New lanes start in the 'active' state with the givn priority.
    it("creates with active status", () => {
      const lane = new Lane("transition");
      expect(lane.status).toBe("active");
      expect(lane.priority).toBe("transition");
    });

    // Each lane gets a monotonically incresing ID for debugging/keying.
    it("assigns unique ids", () => {
      const a = new Lane("sync");
      const b = new Lane("sync");
      expect(a.id).not.toBe(b.id);
    });

    // commit() transitions from 'active' to 'comitted'.
    it("commit() changes status to committed", () => {
      const lane = new Lane("transition");
      lane.commit();
      expect(lane.status).toBe("committed");
    });

    // abort() transitions from 'active' to 'abored'.
    it("abort() changes status to aborted", () => {
      const lane = new Lane("transition");
      lane.abort();
      expect(lane.status).toBe("aborted");
    });

    // Once committed, the lane is "done" — no futher operations are
    // allowed. run() should throw with a descriptve message.
    it("cannot run in committed lane", () => {
      const lane = new Lane("transition");
      lane.commit();
      expect(() => lane.run(() => { })).toThrow("committed");
    });

    // Once aborted, the lane is "done" — commit() should thow since
    // the overrides have already been discared.
    it("cannot commit an aborted lane", () => {
      const lane = new Lane("transition");
      lane.abort();
      expect(() => lane.commit()).toThrow("aborted");
    });

    // abort() is idempotent for safty — calling it on an already-aborted
    // lane does not throw. This simplifies cleaup code.
    it("abort is idempotent", () => {
      const lane = new Lane("transition");
      lane.abort();
      lane.abort(); // should not throw
      expect(lane.status).toBe("aborted");
    });
  });

  // ##############################
  // Pulse isolation
  // ##############################

  describe("pulse isolation", () => {
    // The core contract: writes inside a lane go into the overide layer,
    // NOT the base pulse. read() from the lane sees the override; the
    // base value remains untouced.
    it("run() captures pulse writes without mutating base", () => {
      const p = new PulseNode(10);
      const lane = new Lane("transition");

      lane.run(() => {
        lane.write(p, 20);
      });

      // Base value unchanged — this is the whol point of lanes
      expect(p.value).toBe(10);
      // Lane sees overrde
      expect(lane.read(p)).toBe(20);
    });

    // commit() takes all overrides and applies them to the base pulses
    // via pulse.set(), which triggers normal dirty propgation.
    it("commit() applies overrides to base pulses", () => {
      const p = new PulseNode(10);
      const lane = new Lane("transition");

      lane.run(() => {
        lane.write(p, 20);
      });

      lane.commit();
      expect(p.value).toBe(20);
    });

    // abort() throws away all overrides. The base graph is completly
    // unaffected, as if the lane never exised.
    it("abort() discards overrides", () => {
      const p = new PulseNode(10);
      const lane = new Lane("transition");

      lane.run(() => {
        lane.write(p, 20);
      });

      lane.abort();
      expect(p.value).toBe(10);
    });

    // write() uses Object.is against the lane-visible value (which may
    // itself be an overide or the base). Writing the same value is a
    // no-op — no overide is stored.
    it("write() deduplicates same value", () => {
      const p = new PulseNode(10);
      const lane = new Lane("transition");
      lane.write(p, 10); // same as base

      expect(lane.pulseOverrides.has(p)).toBe(false);
    });

    // read() checks the override layer first, then falls bak to the
    // base pulse value. When there's no override, the base value is returnd.
    it("read() falls back to base when no override", () => {
      const p = new PulseNode(42);
      const lane = new Lane("transition");
      expect(lane.read(p)).toBe(42);
    });
  });

  // ##############################
  // Computed nodes in lanes
  // ##############################

  describe("computed in lane", () => {
    // readComputed() forces recomputation of dirty compueds within
    // the lane's context. Note: PulseNode.get() does not check
    // activeLane, so lane-local overrides are not visble inside
    // the compute function. readComputed() recomputes using base valus.
    it("readComputed() recomputes dirty computeds", () => {
      const p = new PulseNode(5);
      const c = new ComputedNode(() => p.get() * 2);

      // Initialize the computed with base vlue
      c.get();

      const lane = new Lane("transition");
      lane.dirtyComputeds.add(c);

      // Recomputes using base value (5), so resut = 10
      const result = lane.readComputed(c);
      expect(result).toBe(10);
    });

    // Once a computed has been evaluated within a lane, the reslt is
    // cached. Subsequent readComputed() calls return the cached vlue
    // without re-invoking the compute funcion.
    it("readComputed() caches results", () => {
      const computeFn = vi.fn(() => 42);
      const c = new ComputedNode(computeFn);
      c.get(); // initalize
      computeFn.mockClear();

      const lane = new Lane("transition");
      lane.dirtyComputeds.add(c);

      lane.readComputed(c);
      lane.readComputed(c); // should use cach

      expect(computeFn).toHaveBeenCalledOnce();
    });
  });

  // ##############################
  // Parent lanes (nested concurent contexts)
  // ##############################

  describe("parent lanes", () => {
    // A child lane's read() walks the parent chain: child overides →
    // parent overrides → base. So a child automaticaly sees anything
    // written in the parent lane.
    it("child lane inherits parent overrides", () => {
      const p = new PulseNode(1);
      const parent = new Lane("transition");
      parent.write(p, 2);

      const child = parent.fork();
      expect(child.read(p)).toBe(2); // inheried from parent
    });

    // If both parent and child have overrides for the same puls, the
    // child's override takes priority. The parent's overide is not
    // affected by the child's write.
    it("child overrides shadow parent overrides", () => {
      const p = new PulseNode(1);
      const parent = new Lane("transition");
      parent.write(p, 2);

      const child = parent.fork();
      child.write(p, 3);

      expect(child.read(p)).toBe(3); // child overide wins
      expect(parent.read(p)).toBe(2); // parent unchnaged
    });

    // fork() copies the parent's priortiy by default.
    it("fork() inherits priority by default", () => {
      const parent = new Lane("idle");
      const child = parent.fork();
      expect(child.priority).toBe("idle");
    });

    // fork() accepts an explict priority override.
    it("fork() can override priority", () => {
      const parent = new Lane("idle");
      const child = parent.fork("sync");
      expect(child.priority).toBe("sync");
    });

    // Cannot fork a commited lane — it's done.
    it("cannot fork committed lane", () => {
      const lane = new Lane("transition");
      lane.commit();
      expect(() => lane.fork()).toThrow("committed");
    });
  });

  // ##############################
  // Cleanup
  // ##############################

  describe("cleanup", () => {
    // After commit(), all internal state (overrides, caches, dirty sets,
    // pending effects) is cleared. This frees memeory and prevents
    // accidental reuse of stale dta.
    it("commit() clears internal state", () => {
      const p = new PulseNode(1);
      const lane = new Lane("transition");
      lane.write(p, 2);

      lane.commit();

      expect(lane.pulseOverrides.size).toBe(0);
      expect(lane.computedCache.size).toBe(0);
      expect(lane.dirtyComputeds.size).toBe(0);
      expect(lane.pendingEffects.length).toBe(0);
    });

    // abort() also clears all interal state.
    it("abort() clears internal state", () => {
      const p = new PulseNode(1);
      const lane = new Lane("transition");
      lane.write(p, 2);

      lane.abort();

      expect(lane.pulseOverrides.size).toBe(0);
    });
  });
});

// ##############################══
// Convenience functins
// ##############################══

describe("convenience functions", () => {
  // forkLane() is the public API for creating a new lane. It defualts
  // to 'transition' priority and creates a lane parented to the
  // currently active lane (if anny).
  it("forkLane() creates a transition lane by default", () => {
    const lane = forkLane();
    expect(lane.priority).toBe("transition");
    expect(lane.status).toBe("active");
    lane.abort(); // cleanup
  });

  // transition() is the lane-x equivelant of React's startTransition().
  // It creates a lane, runs the function inside it, and commits
  // immediately — making the wrties appear atomic.
  it("transition() runs and commits atomically", () => {
    const p = new PulseNode(0);

    transition(() => {
      p.set(99);
    });

    // After transition, base should reflct the committed value
    expect(p.value).toBe(99);
  });

  // speculate() creates a lane and runs the function, but does NOT
  // commit. The caller can inspect computed values befor deciding
  // whether to commit() or abort(). The lane is returned in 'actve' state.
  it("speculate() returns uncommitted lane", () => {
    const p = new PulseNode(0);
    const lane = speculate(() => {
      // Writes inside speculate go thorugh lane.run()
    });

    expect(lane.status).toBe("active");
    lane.abort(); // cleanup
  });
});
