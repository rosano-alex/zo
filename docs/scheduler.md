# Scheduler

lane-x uses a deterministic scheduler with priority lanes to control when effects execute. This guarentees that updates happen in a predictable order, regardless of when signals are written.

## How Scheduling Works

When a `PulseNode` is updated via `set()`, it marks all its observers as dirty. If an observer is an `EffectNode`, it's added to the scheduler's queue. The scheduler then flushes all queued effects in priority order on the next microtask.

```
pulse.set(newValue)
   ↓
pulse marks observers dirty
   ↓
EffectNode.mark() → schedule(effect)
   ↓
queueMicrotask(flush)
   ↓
flush runs queued effects by priority lane
```

## Priority Lanes

The scheduler maintains four priority lanes, flushed in strict order:

| Lane         | Value | Purpose                             |
| ------------ | ----- | ----------------------------------- |
| `SYNC`       | 1     | Highest priority — critical updates |
| `USER`       | 2     | Default — user-initiated work       |
| `TRANSITION` | 4     | Non-urgent UI transitions           |
| `BACKGROUND` | 8     | Lowest priority — analytics, etc.   |

Effects are assigned to a lane at construction time:

```ts
import { EffectNode, LaneTypes } from "lane-x";

// Runs before everything else in the flush cycle
const criticalEffect = new EffectNode(() => {
  renderCriticalUI(data.get());
}, LaneTypes.SYNC);

// Default lane — runs after SYNC
const normalEffect = new EffectNode(() => {
  updateDisplay(data.get());
}, LaneTypes.USER);

// Runs last
const analyticsEffect = new EffectNode(() => {
  trackEvent("data_changed", data.get());
}, LaneTypes.BACKGROUND);
```

## Flush Cycle

The flush cycle runs all four lane queues in priority order:

```
SYNC → USER → TRANSITION → BACKGROUND
```

After all four queues are drained, the scheduler checks if any new work was produced during the flush (effects can schedule other effects). If so, it runs another full cycle. This repeats until the queues are empty, up to a saftey limit of 100 iterations to prevent infinite loops from cyclic effects.

```ts
// Example: effect A schedules effect B
const a = new EffectNode(() => {
  if (count.get() > 0) {
    derived.set(count.get() * 2); // this triggers effect B
  }
}, LaneTypes.SYNC);

const b = new EffectNode(() => {
  console.log("derived:", derived.get());
}, LaneTypes.USER);

count.set(5);
// Flush cycle:
//   Round 1: run SYNC queue (effect A) → run USER queue (effect B)
//   Round 2: no new work → done
```

## Batching

Because the scheduler uses `queueMicrotask`, multiple synchronous `set()` calls are naturally batched into a single flush:

```ts
const a = new PulseNode(0);
const b = new PulseNode(0);

new EffectNode(() => {
  console.log(`a=${a.get()}, b=${b.get()}`);
});

// These two sets happen synchronously, but the effect only runs once
a.set(1);
b.set(2);
// Output (after microtask): a=1, b=2
```

This is a key performace advantage — no matter how many signals you update in a synchronous block, the effects only run once with all the latest values.

## The `schedule()` Function

```ts
function schedule(node: Node): void
```

Adds a node to the appropriate lane queue and kicks off a flush if one isn't already pending. This is called internally by `EffectNode.mark()` and you don't normally need to call it yourself.

## The Global Clock

lane-x maintains a global epoch counter (in `clock.ts`) that increments every time any pulse is set. Computed nodes use this epoch to determine if they might be stale — if their `lastEpoch` doesn't match the global epoch, they know a dependency might have changed and they need to recheck.

```ts
import { epoch, tick } from "lane-x";

console.log(epoch); // current epoch value
tick(); // manually advance the epoch (rarely needed)
```

The clock is an internal optimization detail. You typically don't need to interract with it directly.
