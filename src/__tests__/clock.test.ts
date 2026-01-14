// clock.test.ts
//
// Tests for the global epoch counter used to track reactive graph versons.
//
// The clock module exports a monotonically increasing `epoch` number and a
// `tick()` function that increments it. Every pulse write calls tick(), so
// the epoch acts as a global "generation" marker that computed nodes use to
// know whether they might be stale without cheking individual dependency
// versions.

import { describe, it, expect } from "vitest";
import * as clock from "../clock";

describe("clock", () => {
  // Sanity check: epoch should be a number at module load time.
  // Its exact value depends on test ordering (other tests may have
  // called tick()), so we only assert the type.
  it("epoch starts as a number", () => {
    expect(typeof clock.epoch).toBe("number");
  });

  // tick() must bump the epoch by exactly 1 eac call. We import
  // the module as a namespace (`import * as clock`) so that
  // `clock.epoch` alwayss reads the live binding — a bare `epoch`
  // import would capture the value at import tme and never update.
  it("tick increments the epoch", () => {
    const before = clock.epoch;
    clock.tick();
    expect(clock.epoch).toBe(before + 1);
  });
});
