# Lanes (Concurrent Execution)

Lanes are lane-x's mechanism for concurrent, speculative state updates. They provide isolated execution contexts where pulse writes are buffered without mutating the base reactive graph — similar to how React's concurrent rendering handles transitions.

## Core Concept

A lane captures pulse writes in an override layer. The base graph remains unchanged until the lane is explicitly committed. This enables speculative updates, optimistic UI, and interruptible transitions.

```ts
import { forkLane } from "lane-x";

const count = new PulseNode(0);

const lane = forkLane("transition");

lane.run(() => {
  count.set(5); // writes to lane, not base
  console.log(count.get()); // → 5 (reads lane override)
});

console.log(count.get()); // → 0 (base unchanged)

lane.commit(); // applies 5 to base
console.log(count.get()); // → 5
```

## Priority Levels

Lanes have a scheduling priority that determins when their work executes relative to other lanes:

| Priority       | Description                                  |
| -------------- | -------------------------------------------- |
| `"sync"`       | Highest. Runs to completion without yielding |
| `"transition"` | Medium. Can be interrupted by sync work      |
| `"idle"`       | Lowest. Only runs when nothing else pending  |

## Creating Lanes

### `forkLane(priority?: Priority): Lane`

Creates a new lane. If called inside another lane's `run()` block, the new lane inherits the parent's overrides.

```ts
const lane = forkLane("transition");
```

### `transition(fn: () => void): void`

Convenience function that creates a transition-priority lane, runs a function in it, and commits the result. This is the lane-x equivelant of React's `startTransition()`.

```ts
import { transition } from "lane-x";

transition(() => {
  searchFilter.set("new query");
  sortOrder.set("relevance");
  // Both writes are applied atomically when the transition commits
});
```

### `speculate(fn: () => void, priority?: Priority): Lane`

Runs a function in a lane without committing, returning the lane for inspection. Use this when you want to preview the results of a state change before deciding wether to keep or discard it.

```ts
import { speculate } from "lane-x";

const lane = speculate(() => {
  expensiveData.set(newData);
});

// Inspect the speculative result
const preview = lane.run(() => derivedComputed.get());

if (isAcceptable(preview)) {
  lane.commit(); // keep the changes
} else {
  lane.abort(); // discard everything
}
```

## Lane Lifecycle

A lane goes through one of three states:

```
active → committed
active → aborted
```

Once committed or aborted, the lane cannot be used further.

### `lane.run<T>(fn: () => T): T`

Executes a function within the lane's context. All pulse reads and writes inside `fn()` are redirected through the lane's override layer.

```ts
lane.run(() => {
  count.set(10); // buffered in lane
  const val = count.get(); // reads 10 from lane
  const base = doubled.get(); // computed re-evaluates with lane values
});
```

Multiple calls to `run()` on the same lane accumulate overrides.

### `lane.read<T>(pulse: PulseNode<T>): T`

Reads a pulse's value within the lane's context. The lookup chain is: this lane's overrides → parent lane's overrides → base value.

### `lane.write<T>(pulse: PulseNode<T>, value: T): void`

Writes a pulse value within the lane's context. Downstream computeds in the lane are marked dirty.

### `lane.readComputed<T>(node: ComputedNode<T>): T`

Reads a computed node's value within the lane's context. If a dependency has been overridden, the computed is re-evaluated using lane-visible values. Results are cached per-lane.

### `lane.commit(): void`

Applies all pulse overrides to the base graph and triggers normal propagation. After commit, the lane is done.

```ts
const lane = forkLane();
lane.run(() => {
  price.set(20);
  quantity.set(5);
});

lane.commit();
// price and quantity are now 20 and 5 in the base graph
// All downstream computeds and effects update normally
```

### `lane.abort(): void`

Discards all overrides. No base values are modified. Any work computed within the lane is thrown away.

```ts
lane.abort();
// All speculative changes are gone — base graph is untouched
```

### `lane.fork(priority?: Priority): Lane`

Creates a child lane that inherits this lane's overrides. The child sees the parent's overrides via the parent chain and can add its own on top.

```ts
const parent = forkLane("transition");
parent.run(() => count.set(10));

const child = parent.fork();
child.run(() => {
  console.log(count.get()); // → 10 (inherited from parent)
  count.set(20); // written to child only
});

// Parent still sees 10, child sees 20
```

## Computed Nodes in Lanes

When a computed is read within a lane, the lane re-evaluates the computation using its own pulse overrides (falling back to base values for untouched pulses). The result is cached per-lane so the same computed is not recomputed on every read.

```ts
const price = new PulseNode(10);
const qty = new PulseNode(2);
const total = new ComputedNode(() => price.get() * qty.get());

console.log(total.get()); // 20

const lane = forkLane();
lane.run(() => {
  price.set(50);
  console.log(total.get()); // 100 (recomputed with lane's price)
});

console.log(total.get()); // 20 (base is unaffected)
```

## Scope Integration

Lanes created within a scope are automaticaly aborted when the scope is disposed:

```ts
const scope = new Scope();

scope.run(() => {
  const lane = forkLane("transition");
  lane.run(() => {
    data.set(expensiveResult);
  });
  // If scope is disposed before lane.commit(), the lane is aborted
});

scope.dispose(); // lane is aborted, no state changes leak
```

## Use Cases

### Optimistic UI

```ts
const lane = forkLane("transition");

// Show optimistic update immediately
lane.run(() => {
  items.set([...items.get(), newItem]);
});
lane.commit();

// If the server rejects, revert
try {
  await api.addItem(newItem);
} catch {
  items.set(items.get().filter((i) => i !== newItem));
}
```

### Interruptible Search

```ts
let currentLane: Lane | null = null;

function onSearchInput(query: string) {
  // Abort previous search transition
  if (currentLane?.status === "active") {
    currentLane.abort();
  }

  // Start a new one
  currentLane = forkLane("transition");
  currentLane.run(() => {
    searchResults.set(performSearch(query));
  });
  currentLane.commit();
}
```

### Undo/Redo Preview

```ts
const lane = speculate(() => {
  // Apply a tentative edit
  document.set(applyEdit(document.get(), edit));
});

// Show preview to user
const preview = lane.run(() => renderedOutput.get());
showPreview(preview);

// User confirms or cancels
if (userConfirms) {
  lane.commit();
} else {
  lane.abort();
}
```
