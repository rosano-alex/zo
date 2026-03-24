import type { Node } from "./node";
import { NodeFlags } from "./node";
import type { PulseNode } from "./pulse";

// #################################
// Effect Keys
// #################################

/**
 * EffectKey
 * ---------
 *
 * A branded symbol that uniquely identifies an algebraic effect type.
 *
 * Algebraic effects are a control-flow mechanism borrowed from programming
 * language theory (Eff, Koka, OCaml 5). They let a computation "perform"
 * an operation without knowing how it will be handled — the handler is
 * installed by an ancestor scope and intercepts the operation at runtime.
 *
 * In lane-x, effect keys are created with defineEffect() and carry
 * phantom type parameters so that perform() and handle() are type-safe:
 *
 *   const LOG = defineEffect<string, void>('log')
 *
 *   scope.handle(LOG, (message, resume) => {
 *     console.log(message)
 *     resume()
 *   })
 *
 *   scope.run(() => {
 *     perform(LOG, 'hello')  // type-safe: payload must be string
 *   })
 *
 * The phantom types T (payload) and R (resume value) exist only at
 * compile time — at runtime an EffectKey is just a symbol.
 */
export type EffectKey<T = any, R = void> = symbol & {
  readonly __payload: T;
  readonly __result: R;
};

/**
 * Creates a new algebraic effect key.
 *
 * Each key is a unique symbol, so two effects with the same name string
 * are still distinct — the name is only for debugging.
 *
 * @param name - A human-readable label shown in error messages and devtools.
 * @returns A branded symbol that can be used with scope.handle() and perform().
 */
export function defineEffect<T = any, R = void>(name: string): EffectKey<T, R> {
  return Symbol(name) as EffectKey<T, R>;
}

// #################################
// Built-in Effects
// #################################

/**
 * ERROR
 *
 * Fired when an effect's execute() throws. Scopes can install an error
 * handler to catch and recover from errors without crashing the entire
 * reactive graph:
 *
 *   scope.handle(ERROR, (error, resume) => {
 *     logToSentry(error)
 *     // Not calling resume() swallows the error.
 *     // Calling resume() would continue after the throw point.
 *   })
 */
export const ERROR = defineEffect<Error, void>("error");

/**
 * DISPOSE
 *
 * Fired when a scope is about to be disposed. Handlers can perform
 * final cleanup, flush pending writes, or log diagnostics before
 * owned nodes are torn down.
 */
export const DISPOSE = defineEffect<Scope, void>("dispose");

/**
 * TRANSACTION
 *
 * Wraps a batch of pulse writes into an atomic unit. All writes
 * within the transaction are buffered and propagated together:
 *
 *   scope.handle(TRANSACTION, (fn, resume) => {
 *     batch(fn)
 *     resume()
 *   })
 */
export const TRANSACTION = defineEffect<() => void, void>("transaction");

// #################################
// Handler type
// #################################

/**
 * An effect handler function installed on a scope via scope.handle().
 *
 * When a descendant scope calls perform(key, payload), the nearest
 * ancestor with a handler for that key receives the call.
 *
 * @param payload - The value passed to perform().
 * @param resume  - A callback to continue execution from where perform()
 *                  was called. The value passed to resume() becomes the
 *                  return value of perform(). Not calling resume() is
 *                  valid — the effect is "swallowed" (similar to catching
 *                  an exception without rethrowing).
 */
export type EffectHandler<T = any, R = void> = (
  payload: T,
  resume: (value: R) => void,
) => void;

// #################################
// Scope
// #################################

/**
 * Scope
 * -----
 *
 * An ownership and effect-handling boundary for reactive nodes.
 *
 * Scopes form a tree that mirrors the logical structure of the
 * application. Every reactive node (pulse, computed, effect)
 * created inside scope.run() is automatically owned by that scope.
 * When the scope is disposed, all owned nodes are torn down
 * recursively — child scopes first, then owned nodes, then
 * registered cleanup callbacks.
 *
 * Scopes also host algebraic effect handlers. When a computation
 * calls perform(key, payload), the runtime walks up the scope tree
 * until it finds a scope with a handler for that key. This provides:
 *
 *   - Error boundaries: catch errors from effects without crashing
 *   - Transactions: batch pulse writes atomically
 *   - Custom effects: any operation your app needs (logging, undo, etc.)
 *
 * Ownership tree example:
 *
 *   rootScope
 *   ├── pageScope
 *   │   ├── headerScope  (owns: titlepulse, renderEffect)
 *   │   └── bodyScope    (owns: contentComputed, logEffect)
 *   └── sidebarScope     (owns: visiblepulse)
 *
 *   rootScope.dispose()  // tears down everything
 *
 * Algebraic effect example:
 *
 *   rootScope.handle(ERROR, (err, resume) => {
 *     sendToSentry(err)
 *     // don't resume — swallow the error
 *   })
 *
 *   pageScope.run(() => {
 *     new EffectNode(() => {
 *       throw new Error('oops')
 *       // ERROR is performed automatically by EffectNode.execute()
 *       // rootScope's handler catches it
 *     })
 *   })
 */
export class Scope {
  /**
   * The parent scope in the ownership tree, or null for the root scope.
   *
   * Used by perform() to walk up the tree looking for effect handlers,
   * and by dispose() to propagate teardown from parent to children.
   */
  parent: Scope | null;

  /**
   * Child scopes created by fork() within this scope's run() block.
   *
   * Disposed in reverse-creation order when this scope is disposed,
   * ensuring that children are torn down before their parent's owned
   * nodes (which the children may depend on).
   */
  children: Set<Scope> = new Set();

  /**
   * Reactive nodes (EffectNode, ComputedNode) owned by this scope.
   *
   * Every node created inside scope.run() is automatically registered
   * here via context tracking. On disposal, each node is disposed
   * (effects) or has its observers cleared (computeds/pulses).
   */
  ownedNodes: Set<Node | PulseNode<any>> = new Set();

  /**
   * User-registered cleanup callbacks, run on disposal.
   *
   * Added via scope.onCleanup(). Run in registration order after
   * all owned nodes and child scopes have been disposed.
   */
  cleanups: (() => void)[] = [];

  /**
   * Algebraic effect handlers installed on this scope.
   *
   * Keyed by EffectKey symbol. When perform() is called, handlers
   * are looked up starting from the active scope and walking up
   * the parent chain until a match is found.
   */
  handlers: Map<symbol, EffectHandler<any, any>> = new Map();

  /**
   * Whether this scope has been disposed. Disposed scopes reject
   * new node registrations and handler installations.
   */
  disposed = false;

  constructor(parent: Scope | null = null) {
    this.parent = parent;
    if (parent) {
      parent.children.add(this);
    }
  }

  /**
   * run()
   *
   * Executes a function within this scope's ownership context.
   *
   * Any reactive nodes created during fn() are automatically owned
   * by this scope. Nested run() calls on child scopes correctly
   * push/pop the scope stack, so ownership is always assigned to
   * the innermost active scope.
   *
   * @param fn - The function to execute within this scope.
   * @returns The return value of fn.
   * @throws If the scope has been disposed.
   */
  run<T>(fn: () => T): T {
    if (this.disposed) {
      throw new Error("Cannot run in a disposed scope");
    }

    setActiveScope(this);

    try {
      return fn();
    } finally {
      setActiveScope(null);
    }
  }

  /**
   * fork()
   *
   * Creates a child scope owned by this scope.
   *
   * The child inherits the handler chain (via parent traversal)
   * but has its own ownership set and cleanup list. Disposing
   * the parent automatically disposes all forked children.
   *
   * @returns A new child Scope.
   */
  fork(): Scope {
    if (this.disposed) {
      throw new Error("Cannot fork a disposed scope");
    }
    return new Scope(this);
  }

  /**
   * handle()
   *
   * Installs an algebraic effect handler on this scope.
   *
   * When a descendant calls perform(key, payload), the runtime walks
   * up the scope tree. The first scope with a handler for that key
   * receives the call.
   *
   * Handlers are composable — a child scope can install its own handler
   * for the same key, shadowing the parent's handler for its subtree.
   *
   * @param key     - The EffectKey identifying which effect to handle.
   * @param handler - The function to call when the effect is performed.
   * @returns This scope (for chaining).
   */
  handle<T, R>(key: EffectKey<T, R>, handler: EffectHandler<T, R>): this {
    if (this.disposed) {
      throw new Error("Cannot install handler on a disposed scope");
    }
    this.handlers.set(key as symbol, handler);
    return this;
  }

  /**
   * perform()
   *
   * Performs an algebraic effect by walking up the scope tree to find
   * a matching handler.
   *
   * This is the core mechanism that makes scopes more powerful than
   * simple ownership containers. Effects decouple the "what" (the
   * computation that needs something) from the "how" (the handler
   * that provides it), just like algebraic effects in languages like
   * Koka or OCaml 5.
   *
   * The handler receives a resume callback. Calling resume(value)
   * makes perform() return that value to the caller. Not calling
   * resume is valid — the effect is handled without continuing
   * (similar to catching an exception).
   *
   * Note: Unlike true algebraic effects with delimited continuations,
   * this implementation is synchronous. The handler and resume run
   * in the same call stack. Async effects would require a different
   * mechanism (e.g., generator-based continuations).
   *
   * @param key     - The EffectKey to look up.
   * @param payload - The value to pass to the handler.
   * @returns The value passed to resume(), or undefined if the handler
   *          did not call resume.
   * @throws If no handler is found for the given key.
   */
  perform<T, R>(key: EffectKey<T, R>, payload: T): R | undefined {
    let current: Scope | null = this;

    while (current) {
      const handler = current.handlers.get(key as symbol);
      if (handler) {
        let result: R | undefined;
        let resumed = false;

        handler(payload, (value: R) => {
          resumed = true;
          result = value;
        });

        return resumed ? result : undefined;
      }
      current = current.parent;
    }

    // No handler found anywhere in the scope chain.
    // For ERROR, rethrow the original error so it isn't silently swallowed.
    if (key === (ERROR as symbol)) {
      throw payload;
    }

    throw new Error(
      `Unhandled effect: ${String(key)}. ` +
      `Install a handler via scope.handle() on an ancestor scope.`,
    );
  }

  /**
   * own()
   *
   * Registers a reactive node as owned by this scope.
   *
   * Called automatically by pulseNode, ComputedNode, and EffectNode
   * constructors when an active scope exists. Can also be called
   * manually for nodes created outside a scope.run() block.
   *
   * @param node - The reactive node to own.
   */
  own(node: Node | PulseNode<any>): void {
    if (this.disposed) {
      throw new Error("Cannot register node on a disposed scope");
    }
    this.ownedNodes.add(node);
  }

  /**
   * disown()
   *
   * Removes a node from this scope's ownership set without disposing it.
   *
   * Useful when transferring ownership between scopes or when a node
   * is manually disposed before its scope.
   *
   * @param node - The node to remove from ownership.
   */
  disown(node: Node | PulseNode<any>): void {
    this.ownedNodes.delete(node);
  }

  /**
   * onCleanup()
   *
   * Registers a callback to run when this scope is disposed.
   *
   * Cleanup callbacks run after all child scopes and owned nodes have
   * been disposed, in registration order. Use for releasing external
   * resources (event listeners, timers, subscriptions) that aren't
   * automatically managed by the reactive system.
   *
   * @param fn - The cleanup function.
   */
  onCleanup(fn: () => void): void {
    if (this.disposed) {
      // Already disposed — run immediately.
      fn();
      return;
    }
    this.cleanups.push(fn);
  }

  /**
   * dispose()
   *
   * Tears down this scope and everything it owns.
   *
   * Disposal order:
   *
   *   1. Fire the DISPOSE effect (if a handler is installed).
   *   2. Dispose all child scopes (depth-first, children before parent).
   *   3. Dispose all owned nodes:
   *      - EffectNodes: call dispose() to unsubscribe from sources.
   *      - ComputedNodes: clear observers and mark disposed.
   *      - pulseNodes: clear observers.
   *   4. Run registered cleanup callbacks in order.
   *   5. Remove this scope from its parent's children set.
   *   6. Mark this scope as disposed.
   *
   * After disposal, the scope rejects all further operations (run,
   * fork, handle, own) with an error.
   */
  dispose(): void {
    if (this.disposed) return;

    // 1. Fire DISPOSE effect if anyone is listening.
    try {
      if (this.handlers.has(DISPOSE as symbol) || this.parent) {
        this.perform(DISPOSE, this);
      }
    } catch {
      // DISPOSE is optional — if unhandled, ignore.
    }

    // 2. Dispose child scopes (copy set since dispose mutates parent.children).
    for (const child of [...this.children]) {
      child.dispose();
    }

    // 3. Dispose owned nodes.
    for (const node of this.ownedNodes) {
      if ("dispose" in node && typeof node.dispose === "function") {
        // EffectNode — has dispose(); sets DISPOSED flag and stops scheduling.
        (node as { dispose(): void }).dispose();
      } else if ("observers" in node) {
        // ComputedNode or PulseNode — clear downstream observer list so the
        // node stops notifying anything after the scope is torn down.
        // Do NOT set NodeFlags.DIRTY here: DIRTY means "needs recomputation",
        // not "disposed". Touching flags risks confusing the scheduler if a
        // stale reference triggers a flush after disposal.
        (node as unknown as PulseNode<any>).observers.length = 0;
      }
    }
    this.ownedNodes.clear();

    // 4. Run cleanup callbacks.
    for (const fn of this.cleanups) {
      try {
        fn();
      } catch {
        // Cleanup errors are swallowed to ensure all cleanups run.
      }
    }
    this.cleanups.length = 0;

    // 5. Remove from parent.
    if (this.parent) {
      this.parent.children.delete(this);
    }

    // 6. Mark disposed.
    this.disposed = true;
  }
}

// #################################
// Active scope tracking
// #################################

/**
 * The scope stack mirrors the observer stack in context.ts.
 *
 * When scope.run() is called, the scope is pushed. When it returns,
 * the scope is popped. This allows nested scope.run() calls to
 * correctly assign ownership to the innermost scope.
 */
const scopeStack: (Scope | null)[] = [];

/**
 * The currently active scope. Reactive nodes created while this is
 * non-null are automatically registered as owned by this scope.
 *
 * Read by pulseNode, ComputedNode, and EffectNode constructors.
 */
export let activeScope: Scope | null = null;

function setActiveScope(scope: Scope | null) {
  if (scope === null) {
    scopeStack.pop();
    activeScope = scopeStack[scopeStack.length - 1] ?? null;
  } else {
    scopeStack.push(scope);
    activeScope = scope;
  }
}

// #################################
// Convenience API
// #################################

/**
 * createScope()
 *
 * Creates a new root scope (no parent) or a child of the currently
 * active scope.
 *
 * If called inside another scope's run() block, the new scope is
 * automatically a child of the active scope. If called at the top
 * level, it creates an independent root scope.
 *
 * @returns A new Scope.
 */
export function createScope(): Scope {
  return new Scope(activeScope);
}

/**
 * perform()
 *
 * Module-level convenience for performing an effect in the currently
 * active scope. Equivalent to activeScope.perform(key, payload).
 *
 * @throws If no scope is active.
 */
export function perform<T, R>(key: EffectKey<T, R>, payload: T): R | undefined {
  if (!activeScope) {
    throw new Error(
      `perform() called outside of any scope. ` +
      `Wrap your code in scope.run() to establish a scope context.`,
    );
  }
  return activeScope.perform(key, payload);
}

/**
 * onCleanup()
 *
 * Module-level convenience for registering a cleanup callback on
 * the currently active scope.
 *
 * @throws If no scope is active.
 */
export function onCleanup(fn: () => void): void {
  if (!activeScope) {
    throw new Error(
      `onCleanup() called outside of any scope. ` +
      `Wrap your code in scope.run() to establish a scope context.`,
    );
  }
  activeScope.onCleanup(fn);
}
