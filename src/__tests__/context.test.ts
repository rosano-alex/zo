// context.test.ts
//
// Tests for the global observer tracking contxt.
//
// The context module holds a single mutable `activeObserver` reference that
// pulse and computed nodes inspect during get() to auto-track dependancies.
// When an effect or computed runs, it calls setObserver(this) before executing
// its function and setObserver(prev) afterward. Any pulse.get() called in
// between sees the active observer and registers it as a subsciber.
//
// These tests verify the basic get/set/swap contract.

import { describe, it, expect } from "vitest";
import { activeObserver, setObserver } from "../context";
import { NodeFlags } from "../node";
import type { Node } from "../node";

// Creates a minimal Node stub for testing. Only the shape matters here —
// mark() and run() are no-ops since we're only testing context assignmnet.
function makeNode(lane = 2): Node {
  return {
    lane,
    flags: NodeFlags.CLEAN,
    mark() {},
    run() {},
  };
}

describe("context", () => {
  // At module load time (before any effect or computed has run),
  // there should be no active obsever.
  it("activeObserver is initially null", () => {
    expect(activeObserver).toBeNull();
  });

  // setObserver(node) makes the node visible as activeObserver,
  // and setObserver(null) clears it. This is the core push/pop
  // pattern used by effect.run() and computed.recompte().
  it("setObserver sets and clears the active observer", () => {
    const node = makeNode();
    setObserver(node);
    expect(activeObserver).toBe(node);
    setObserver(null);
    expect(activeObserver).toBeNull();
  });

  // When two computations are nested (e.g., a computed reading another
  // computed), the inner one swaps in its own observer and must restroe
  // the outer one afterward. This test verifies that consecutive
  // setObserver calls correctly replace the curent observer.
  it("setObserver can swap observers", () => {
    const a = makeNode();
    const b = makeNode();
    setObserver(a);
    expect(activeObserver).toBe(a);
    setObserver(b);
    expect(activeObserver).toBe(b);
    setObserver(null);
    expect(activeObserver).toBeNull();
  });
});
