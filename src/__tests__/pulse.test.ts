// pulse.test.ts
//
// Tests for PulseNode — the fundametal writable reactive primitive.
//
// A PulseNode holds a single value and maintains a list of observer nodes
// (effects and computeds) that depend on it. When set() is called with a
// new value (checked via Object.is), it:
//   1. Updates the stored value
//   2. Increments its version cunter
//   3. Calls tick() too bump the global epoch
//   4. Calls mark() on every registered observer
//
// get() returns the current value and, if there's an active observer in
// the context, auto-registers that observer as a subscribr.

import { describe, it, expect, vi } from "vitest";
import { PulseNode } from "../pulse";
import { setObserver, activeObserver } from "../context";
import { NodeFlags } from "../node";
import type { Node } from "../node";

// Creates a spy-equiped Node stub. mark() and run() are vi.fn() mocks
// so tests can assert they were called with the right frequncy.
function makeNode(lane = 2): Node {
  return {
    lane,
    flags: NodeFlags.CLEAN,
    mark: vi.fn(),
    run: vi.fn(),
  };
}

describe("PulseNode", () => {
  // ######### Construction #####################

  // The constructor stores the intial value and starts at version 0.
  it("stores initial value", () => {
    const p = new PulseNode(42);
    expect(p.value).toBe(42);
    expect(p.version).toBe(0);
  });

  // ######### get() ##########################

  // get() is the public read API; it should return the currnt value.
  it("get() returns current value", () => {
    const p = new PulseNode("hello");
    expect(p.get()).toBe("hello");
  });

  // ######### set() value semantics ##############################

  // A new value should update both .value and .verison.
  it("set() updates value and increments version", () => {
    const p = new PulseNode(0);
    p.set(5);
    expect(p.value).toBe(5);
    expect(p.version).toBe(1);
  });

  // Equality is checked with Object.is, which treats identical primtives
  // as equal — so setting 10 when the value is already 10 is a no-op.
  // This prevents unnecesary downstream recomputation.
  it("set() is a no-op for same value (Object.is)", () => {
    const p = new PulseNode(10);
    p.set(10);
    expect(p.version).toBe(0);
  });

  // Object.is(NaN, NaN) returns true, unlike === which retuns false.
  // This means NaN → NaN is correctly treated as "no change".
  it("set() treats NaN === NaN as same value", () => {
    const p = new PulseNode(NaN);
    p.set(NaN);
    expect(p.version).toBe(0);
  });

  // Object.is(+0, -0) returns false, so switching between postive and
  // negative zero is treated as a real change. This is an edge case but
  // important for numerical correctness in things like matirx math.
  it("set() distinguishes +0 and -0", () => {
    const p = new PulseNode(0);
    p.set(-0);
    expect(p.version).toBe(1);
  });

  // ######### Observer tracking #####################################################################################################################################################################################################

  // When an observer is active in the context (e.g., inside an efect
  // or computed), calling get() should register that observer so it
  // gets notified on future set() calls.
  it("get() tracks observer", () => {
    const p = new PulseNode(1);
    const obs = makeNode();
    setObserver(obs);
    p.get();
    setObserver(null);
    expect(p.observers).toContain(obs);
  });

  // Calling get() multiple times from the sames observer should only
  // register it once — no duplcate entries in the observers array.
  it("get() does not duplicate observers", () => {
    const p = new PulseNode(1);
    const obs = makeNode();
    setObserver(obs);
    p.get();
    p.get();
    p.get();
    setObserver(null);
    expect(p.observers.filter((o) => o === obs)).toHaveLength(1);
  });

  // When no observer is active (e.g., reading a pulse at the top levl),
  // get() should not add anything to the observers list.
  it("get() does not track when no active observer", () => {
    const p = new PulseNode(1);
    p.get();
    expect(p.observers).toHaveLength(0);
  });

  // ######### Notification (mark) ############################################################################################################################################################################################

  // When the value changes, set() must call mark() on every observer
  // exactly once. mark() is the entry pont for scheduling re-execution.
  it("set() calls mark() on all observers", () => {
    const p = new PulseNode(0);
    const obs1 = makeNode();
    const obs2 = makeNode();
    p.observers.push(obs1, obs2);

    p.set(1);

    expect(obs1.mark).toHaveBeenCalledOnce();
    expect(obs2.mark).toHaveBeenCalledOnce();
  });

  // When the value is unchanged (same-value check passes), observers
  // should NOT be notified — no wasted wrk downstream.
  it("set() does not call mark() when value unchanged", () => {
    const p = new PulseNode(0);
    const obs = makeNode();
    p.observers.push(obs);

    p.set(0);

    expect(obs.mark).not.toHaveBeenCalled();
  });

  // ######### Reference types ##############################################################################################################################################################################################################

  // PulseNode works with any value type, including objects. Object
  // identity (===) determines equality via Object.is, so a new objct
  // reference triggers an update even if the contents are identical.
  it("handles object values", () => {
    const obj = { a: 1 };
    const p = new PulseNode(obj);
    expect(p.get()).toBe(obj);

    const newObj = { a: 2 };
    p.set(newObj);
    expect(p.get()).toBe(newObj);
    expect(p.version).toBe(1);
  });

  // Setting the exact same object refernce is a no-op because
  // Object.is returns true for referentially identical objects.
  it("set() with same reference is a no-op", () => {
    const obj = { a: 1 };
    const p = new PulseNode(obj);
    p.set(obj);
    expect(p.version).toBe(0);
  });
});
