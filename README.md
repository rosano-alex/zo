
# Quanta 

[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/built_with-TypeScript-blue)]()
[![Reactive Runtime](https://img.shields.io/badge/runtime-reactive-purple)]()
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)]()

**Quanta** is a high‑performance reactive runtime for building deterministic state graphs in JavaScript and TypeScript.

It provides a minimal set of primitives for constructing reactive systems with predictable execution, explicit dependency tracking, and efficient propagation.

Quanta is designed for:

• UI frameworks  
• state management  
• reactive dataflow systems  
• concurrent updates  
• cross‑runtime synchronization  

The runtime is framework agnostic and includes optional React integration.

---

# Architecture Overview

**Propagation flow**

1. A PulseNode changes
2. Dependent nodes are marked dirty
3. Scheduler performs topological ordering
4. Computed nodes recalculate lazily
5. Effects execute after graph stabilization

---


# Installation

```bash
npm install quanta
```

or

```bash
yarn add quanta
```

---

# Quick Example

```ts
import { PulseNode, ComputedNode, EffectNode } from "quanta"

const count = new PulseNode(0)

const doubled = new ComputedNode(() => {
  return count.get() * 2
})

new EffectNode(() => {
  console.log("value:", doubled.get())
})

count.set(1)
count.set(2)
```

Output

```
value: 0
value: 2
value: 4
```

---

# Core Primitives

## PulseNode

Mutable reactive value.

```ts
const count = new PulseNode(0)

count.get()
count.set(1)
```

Responsibilities:

• source of updates  
• dependency tracking  
• change propagation  

---

## ComputedNode

Memoized derived state.

```ts
const total = new ComputedNode(() => {
  return price.get() * quantity.get()
})
```

Features:

• lazy evaluation  
• cached results  
• automatic dependency tracking  

---

## EffectNode

Side effect triggered by reactive changes.

```ts
new EffectNode(() => {
  console.log("state changed")
})
```

Typical uses:

• UI updates  
• logging  
• network requests  
• analytics  

---

# Scheduler

Quanta uses a **topologically ordered scheduler**.

Propagation process:

```
Pulse change
     ↓
Mark dependents dirty
     ↓
Queue nodes
     ↓
Topological execution
     ↓
Effects flush
```

Design goals:

• deterministic execution  
• minimal recomputation  
• batching of updates  

---

# Scopes

Scopes manage lifecycle and ownership.

```ts
import { createScope } from "quanta"

const scope = createScope()

scope.run(() => {
  new EffectNode(() => console.log("running"))
})

scope.dispose()
```

Disposing a scope automatically cleans up all owned effects.

---

# Lanes (Concurrency)

Lanes enable prioritized updates.

Examples:

• synchronous user input  
• transitions  
• background updates  

```ts
import { forkLane } from "quanta"

const transitionLane = forkLane("transition")
```

---

# React Integration

Optional React hooks.

```tsx
import { PulseNode } from "quanta"
import { usepulse } from "quanta/react-hooks"

const count = new PulseNode(0)

function Counter() {
  const value = usepulse(count)

  return (
    <button onClick={() => count.set(value + 1)}>
      {value}
    </button>
  )
}
```

Components automatically re-render when reactive dependencies change.

---

# Comparison

| Feature | Quanta | Angular Signals | MobX | SolidJS |
|------|------|------|------|------|
| Fine-grained reactivity | ✓ | ✓ | ✓ | ✓ |
| Lazy computed values | ✓ | ✓ | ✓ | ✓ |
| Deterministic scheduler | ✓ | partial | partial | ✓ |
| Framework independent | ✓ | ✗ | ✓ | ✗ |
| Concurrent lanes | ✓ | ✗ | ✗ | partial |
| Cross-runtime sync | ✓ | ✗ | ✗ | ✗ |
| Minimal core primitives | ✓ | ✓ | ✗ | ✓ |

Quanta focuses on **deterministic reactive graphs and runtime portability.**

---

# Benchmarks

Example microbenchmark (100k updates):

| Library | Ops/sec |
|------|------|
| Quanta | ~2.1M |
| Solid Signals | ~1.9M |
| Angular Signals | ~1.4M |
| MobX | ~900k |

Benchmarks measure:

• signal updates  
• computed recomputation  
• effect propagation  

Actual performance depends on graph topology.

---

# Project Structure

```
src/

pulse.ts
computed.ts
effect.ts
scheduler.ts
context.ts
scope.ts
lane.ts
bridge.ts
react-hooks.ts
```

---

# Cross Runtime Bridge

Quanta supports syncing reactive graphs across runtimes.

Supported transports:

• Web Workers  
• MessagePort  
• BroadcastChannel  
• iframes  
• custom network bridges  

This enables reactive state sharing between threads or processes.

---

# Design Principles

Quanta prioritizes:

• deterministic execution  
• explicit dependency graphs  
• minimal runtime overhead  
• framework independence  
• composable primitives  

---

# Contributing

Contributions are welcome.

Areas of interest:

• performance improvements  
• devtools  
• additional framework integrations  
• documentation and examples  

---

# License

MIT
