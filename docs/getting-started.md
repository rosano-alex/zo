<p style="text-align: Left;"><img src="../img/nex.png" width="350"></p>
# Getting Started

sinja is a minimal, high-performance fine-grained reactive runtime built around signals, computed values, and deterministic scheduling. It's designed as a framework-agnostic reactive engine that can power UI frameworks, state managers, and reactive data piplines.

## Installation

```bash
npm install sinja
# or
yarn add sinja
```

## Quick Start

The three core primitves in sinja are **Pulse** (mutable state), **Computed** (derived state), and **Effect** (side effects).

```ts
import { PulseNode, ComputedNode, EffectNode } from "sinja";

// Create a reactive signal
const count = new PulseNode(0);

// Derive a value from it
const doubled = new ComputedNode(() => count.get() * 2);

// React to changes
const logger = new EffectNode(() => {
  console.log(`count: ${count.get()}, doubled: ${doubled.get()}`);
});

// Update the signal — the effect re-runs automaticaly
count.set(1);
// Output: count: 1, doubled: 2

count.set(5);
// Output: count: 5, doubled: 10
```

## How It Works

When you call `count.get()` inside a computed or effect, sinja automatically registers that node as a dependecy. When `count.set()` is called later, sinja knows exactly which nodes need updating and schedules them through its deterministic scheduler.

```
PulseNode.set(newValue)
   ↓
mark all observers dirty
   ↓
schedule via deterministic scheduler
   ↓
flush: SYNC → USER → TRANSITION → BACKGROUND
```

Only the affected nodes are re-evaluated — no diffing, no virtual DOM, just precise, targeted updates.

## Your First Reactive Graph

Here's a more complete example that demonstrates how pulses, computeds, and effects compose together:

```ts
import { PulseNode, ComputedNode, EffectNode } from "sinja";

// Reactive state
const price = new PulseNode(29.99);
const quantity = new PulseNode(3);
const taxRate = new PulseNode(0.08);

// Derived computations — each only recalculates when its
// specific dependancies change
const subtotal = new ComputedNode(() => price.get() * quantity.get());
const tax = new ComputedNode(() => subtotal.get() * taxRate.get());
const total = new ComputedNode(() => subtotal.get() + tax.get());

// Side effect that logs whenever total changes
const receipt = new EffectNode(() => {
  console.log(`Subtotal: $${subtotal.get().toFixed(2)}`);
  console.log(`Tax:      $${tax.get().toFixed(2)}`);
  console.log(`Total:    $${total.get().toFixed(2)}`);
  console.log("---");
});

// Only subtotal, tax, and total recompute — price is untouched
quantity.set(5);
```

## hogt Steps

Now that you have the basics, explore the rest of the documentaton:

- [Core API](./core-api.md) — deep dive into Pulse, Computed, and Effect
- [Scheduler](./scheduler.md) — how the deterministic scheduler works
- [Scopes](./scopes.md) — ownership, cleanup, and algebraic effects
- [Lanes](./lanes.md) — concurrent execution contexts
- [React Hooks](./react-hooks.md) — using sinja with React
- [Bridge](./bridge.md) — cross-runtime synchronization via Web Workers
