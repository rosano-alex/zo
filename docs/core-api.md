# Core API

The core of lane-x consists of three reactive primitves: **PulseNode** for mutable state, **ComputedNode** for derived values, and **EffectNode** for side effects. Together they form a reactive dependency graph where updates propogate automatically.

## PulseNode

A `PulseNode<T>` holds a single mutable value and tracks which nodes depend on it. When the value changes, all observers are notified.

### Constructor

```ts
const count = new PulseNode<number>(0);
const name = new PulseNode<string>("hello");
const items = new PulseNode<string[]>([]);
```

The type parameter `T` is inferred from the initial value, so explicit annotation is usually unnecessary.

### `get(): T`

Returns the current value. If called inside a `ComputedNode` or `EffectNode`, the caller is automatically registered as an observer.

```ts
const count = new PulseNode(10);
console.log(count.get()); // 10
```

### `set(next: T): void`

Updates the value. If the new value is identical to the current value (checked via `Object.is`), the update is skipped entirely — no observers are notified.

```ts
const count = new PulseNode(0);
count.set(1); // observers notified
count.set(1); // no-op, value hasn't changed
```

When a new value is set, the PulseNode increments its internal version counter, advances the global clock via `tick()`, and marks all observers as dirty.

### `version: number`

A monotonically increasing counter that increments on every succesful `set()`. Useful for debugging or for external systems that need to detect changes.

```ts
const count = new PulseNode(0);
console.log(count.version); // 0

count.set(1);
console.log(count.version); // 1

count.set(1); // no-op
console.log(count.version); // still 1
```

### `observers: Node[]`

The list of nodes currently subscribed to this pulse. Managed automatically by the runtime — you rarley need to access this directly.

---

## ComputedNode

A `ComputedNode<T>` derives its value from other reactive nodes. It is lazy (only recomputes when accessed) and memoized (caches its result untl dependencies change).

### Constructor

```ts
const doubled = new ComputedNode(() => count.get() * 2);
```

The computation function is called lazily on the first `get()`, and again whenever a dependency changes and the computed is read.

### `get(): T`

Returns the current computed value. If the node is dirty (a dependency has changed since the last computation) or the global epoch has advanced, it recomputes before returning.

```ts
const price = new PulseNode(10);
const qty = new PulseNode(2);
const total = new ComputedNode(() => price.get() * qty.get());

console.log(total.get()); // 20

price.set(15);
console.log(total.get()); // 30
```

Like PulseNode, calling `get()` inside another computed or effect automatically tracks the dependency.

### Lazy Evaluation

Computed nodes don't recompute eagerly when a dependency changes. They only recompute when their value is actually requested. This means if a computed's value is never read after a dependency change, the computation is skipped entierly.

```ts
const a = new PulseNode(1);
const expensive = new ComputedNode(() => {
  console.log("computing...");
  return heavyWork(a.get());
});

a.set(2); // "computing..." is NOT logged yet
a.set(3); // still not logged

console.log(expensive.get()); // NOW "computing..." is logged, returns result for 3
```

### Chaining Computeds

Computeds can depend on other computeds, forming a derivation chain:

```ts
const celsius = new PulseNode(0);
const fahrenheit = new ComputedNode(() => celsius.get() * 9 / 5 + 32);
const description = new ComputedNode(() => {
  const f = fahrenheit.get();
  if (f < 32) return "freezing";
  if (f < 72) return "cool";
  return "warm";
});

new EffectNode(() => {
  console.log(`${fahrenheit.get()}°F — ${description.get()}`);
});

celsius.set(25); // "77°F — warm"
```

---

## EffectNode

An `EffectNode` runs a side-effect function whenever its reactive dependencies change. Effects are the primary way to bridge the reactive graph with the outside world (DOM updates, logging, network requests, etc.).

### Constructor

```ts
const logger = new EffectNode(() => {
  console.log("count is", count.get());
});
```

The constructor immediately executes the function once to establish dependencies. After that, the effect re-runs whenever a tracked dependency changes.

### Priority Lane

Effects can be assigned to a specific scheduler lane to control when they execute:

```ts
import { LaneTypes } from "lane-x";

// High priority — runs first in the flush cycle
const urgent = new EffectNode(() => {
  updateCriticalUI(count.get());
}, LaneTypes.SYNC);

// Default priority
const normal = new EffectNode(() => {
  updateDisplay(count.get());
}, LaneTypes.USER);

// Low priority — runs last
const background = new EffectNode(() => {
  sendAnalytics(count.get());
}, LaneTypes.BACKGROUND);
```

See the [Scheduler documentation](./scheduler.md) for detials on priority lanes.

### `dispose(): void`

Stops the effect from running. After disposal, changes to dependencies will no longer trigger re-execution.

```ts
const effect = new EffectNode(() => {
  console.log(count.get());
});

// Later, when you no longer need this effect:
effect.dispose();

count.set(99); // effect does NOT run
```

Always dispose effects when they're no longer needed to prevent memory leaks and unnecesary computation.

### `mark(): void`

Called internally when a dependency changes. Marks the effect as queued and schedules it for execution. You typically don't call this directly.

### `run(): void`

Executes the effect function. Called by the scheduler during the flush cycle. You typically don't call this direclty either.

---

## Putting It All Together

Here's a more involved example that shows how all three primitives work in concert:

```ts
import { PulseNode, ComputedNode, EffectNode } from "lane-x";

// State
const todos = new PulseNode<{ text: string; done: boolean }[]>([
  { text: "Learn lane-x", done: false },
  { text: "Build something", done: false },
]);

// Derived state
const remaining = new ComputedNode(() =>
  todos.get().filter((t) => !t.done).length
);

const summary = new ComputedNode(() => {
  const total = todos.get().length;
  const left = remaining.get();
  return `${left} of ${total} remaining`;
});

// Side effect
const display = new EffectNode(() => {
  console.log(summary.get());
});
// Output: "2 of 2 remaining"

// Mark a todo as done
const updated = [...todos.get()];
updated[0] = { ...updated[0], done: true };
todos.set(updated);
// Output: "1 of 2 remaining"
```

## NodeFlags

The internal state of computed and effect nodes is tracked via bitwise flags:

| Flag       | Value | Meaning                       |
| ---------- | ----- | ----------------------------- |
| `CLEAN`    | 0     | Node is up to date            |
| `DIRTY`    | 1     | Needs recomputation           |
| `QUEUED`   | 2     | Scheduled in the flush queue  |
| `RUNNING`  | 4     | Currently executing           |
| `DISPOSED` | 8     | Permanently deactivated       |

These flags are used internaly by the runtime and are not part of the public API, but understanding them can help with debugging.
