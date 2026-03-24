# Scopes & Algebraic Effects

Scopes provide two key capabilities in lane-x: **ownership** (automatic cleanup of reactive nodes) and **algebraic effects** (a composable error-handling and control-flow mechanism inspired by languages like Koka and OCaml 5).

## Ownership

A `Scope` owns the reactive nodes created within it. When the scope is disposed, all owned nodes are torn down automaticaly — child scopes first, then owned nodes, then cleanup callbacks.

```ts
import { Scope, PulseNode, ComputedNode, EffectNode } from "lane-x";

const scope = new Scope();

scope.run(() => {
  const count = new PulseNode(0);
  const doubled = new ComputedNode(() => count.get() * 2);
  const logger = new EffectNode(() => {
    console.log(doubled.get());
  });
});

// Later, clean up everything at once:
scope.dispose();
// All three nodes (count, doubled, logger) are disposed
```

This is especially useful in UI frameworks where components mount and unmount — scopes ensure no reactive nodes are left dangling.

### Scope Tree

Scopes form a tree. Child scopes are created with `fork()` or by calling `new Scope(parentScope)`:

```ts
const root = new Scope();

const page = root.fork();
const header = page.fork();
const body = page.fork();

// Disposing root tears down the entire tree:
//   root → page → header, body
root.dispose();
```

The `createScope()` convenience function creates a new scope that is automaticaly a child of the currently active scope (if any):

```ts
import { createScope } from "lane-x";

const root = new Scope();
root.run(() => {
  const child = createScope(); // child of root
  child.run(() => {
    // nodes created here are owned by child
  });
});
```

## Cleanup Callbacks

Register cleanup functions that run when the scope is disposed:

```ts
const scope = new Scope();

scope.run(() => {
  const interval = setInterval(() => poll(), 5000);

  scope.onCleanup(() => {
    clearInterval(interval);
  });
});

// or use the module-level convenience:
import { onCleanup } from "lane-x";

scope.run(() => {
  const ws = new WebSocket("wss://example.com");

  onCleanup(() => {
    ws.close();
  });
});
```

Cleanup callbacks run after all child scopes and owned nodes have been disposed, in registraton order.

## Algebraic Effects

Algebraic effects let a computation "perform" an operation without knowing how it will be handled. A handler installed on an ancestor scope intercepts the operation at runtime.

### Defining Effects

```ts
import { defineEffect } from "lane-x";

// Define a custom effect with typed payload and resume value
const LOG = defineEffect<string, void>("log");
const FETCH = defineEffect<string, Response>("fetch");
const UNDO = defineEffect<void, void>("undo");
```

Each `EffectKey` is a unique symbol with phantom type paramters for type safety.

### Installing Handlers

Use `scope.handle()` to install a handler for an effect key:

```ts
const scope = new Scope();

scope.handle(LOG, (message, resume) => {
  console.log(`[LOG] ${message}`);
  resume(); // continue execution
});
```

The handler recieves two arguments: the payload and a `resume` callback. Calling `resume(value)` continues execution from where `perform()` was called, with `value` as the return value. Not calling `resume` means the effect is swallowed (similar to catching an exception without rethrowing).

### Performing Effects

```ts
import { perform } from "lane-x";

scope.run(() => {
  perform(LOG, "starting computation");
  // execution continues after resume() is called in the handler
});
```

The runtime walks up the scope tree to find the nearest handler for the given effect key. If no handler is found, an error is thrown.

### Built-in Effects

lane-x provides three built-in effect keys:

#### `ERROR`

Fired when an effect throws. Install a handler to catch errors without crashing the reactive graph:

```ts
import { ERROR } from "lane-x";

const root = new Scope();

root.handle(ERROR, (error, resume) => {
  console.error("Caught:", error.message);
  // Not calling resume() swallows the error
  // Calling resume() would continue after the throw
});

root.run(() => {
  new EffectNode(() => {
    throw new Error("something went wrong");
    // ERROR handler catches this
  });
});
```

#### `DISPOSE`

Fired when a scope is about to be disposed. Handlers can perform final cleanup or logging:

```ts
import { DISPOSE } from "lane-x";

scope.handle(DISPOSE, (disposingScope, resume) => {
  console.log("Scope is being disposed, flushing pending writes...");
  flushPendingWrites();
  resume();
});
```

#### `TRANSACTION`

Wraps a batch of pulse writes into an atomic unit:

```ts
import { TRANSACTION } from "lane-x";

scope.handle(TRANSACTION, (fn, resume) => {
  batch(fn);
  resume();
});

scope.run(() => {
  perform(TRANSACTION, () => {
    price.set(20);
    quantity.set(5);
    // Both writes propogate together
  });
});
```

### Handler Composition

Child scopes can shadow parent handlers for the same effect key:

```ts
const root = new Scope();
root.handle(ERROR, (err) => {
  console.error("Root caught:", err.message);
});

const child = root.fork();
child.handle(ERROR, (err, resume) => {
  console.warn("Child caught:", err.message);
  // Don't resume — error is handled here
});

child.run(() => {
  // This error is caught by child's handler, not root's
  perform(ERROR, new Error("oops"));
});
```

## Scope API Reference

### `new Scope(parent?: Scope | null)`

Creates a new scope, optionally as a child of a parent scope.

### `scope.run<T>(fn: () => T): T`

Executes a function within the scope's ownership context. Throws if the scope has been disposed.

### `scope.fork(): Scope`

Creates a child scope owned by this scope.

### `scope.handle<T, R>(key: EffectKey<T, R>, handler: EffectHandler<T, R>): this`

Installs an algebraic effect handler. Returns `this` for chainging.

### `scope.perform<T, R>(key: EffectKey<T, R>, payload: T): R | undefined`

Performs an effect by walking up the scope tree. Returns the value passed to `resume()`, or `undefined` if the handler didn't call `resume`.

### `scope.own(node: Node): void`

Manually registers a node as owned by this scope.

### `scope.disown(node: Node): void`

Removes a node from this scope's ownership without disposing it.

### `scope.onCleanup(fn: () => void): void`

Registers a cleanup callback. If the scope is already disposed, the callback runs immediately.

### `scope.dispose(): void`

Tears down the scope in this order: DISPOSE effect → child scopes → owned nodes → cleanup callbacks → remove from parent → mark disposed.
