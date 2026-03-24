import { ComputedNode } from "./computed";
import { PulseNode } from "./pulse";
import * as React from "react";
import { useRef, useState, useEffect, useMemo, useCallback } from "react";
import { EffectNode } from "./effect";
import { activeObserver, setObserver } from "./context";
import { Scope, createScope, ERROR } from "./scope";
import { forkLane, type Priority, Lane } from "./lane";
import type { Node } from "./node";

// ##############################
// usePulse
// ##############################

/**
 * usePulse
 * ---------
 *
 * Subscribes a React component to a lane-x pulseNode and returns its
 * current value.
 *
 * Whenever the pulse's value changes, the component re-renders
 * automatically — no manual subscriptions or state syncing required.
 *
 * Usage:
 *
 *   const count = new pulseNode(0)
 *
 *   function Counter() {
 *     const value = usePulse(count)
 *     return <p>{value}</p>
 *   }
 *
 *   count.set(1) // → component re-renders, value becomes 1
 *
 * How it works:
 *
 *   1. An EffectNode is created inside useEffect.
 *   2. The effect calls pulse.get(), which registers it as an observer.
 *   3. When the pulse updates, it marks the effect dirty and schedules it.
 *   4. The effect runs, calling forceUpdate() to trigger a React re-render.
 *   5. The hook returns the latest pulse value.
 *
 * Cleanup:
 *
 *   When the component unmounts, dispose() removes the EffectNode from
 *   the pulse's observer list, preventing memory leaks and ghost updates.
 *
 * @param pulse - The pulseNode to subscribe to.
 * @returns      The pulse's current value.
 */
export function usePulse<T>(pulse: PulseNode<T>): T {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const effect = new EffectNode(() => {
      pulse.get();
      forceUpdate((v) => v + 1);
    });

    return () => effect.dispose();
  }, [pulse]);

  return pulse.get();
}

// ##############################
// useComputed
// ##############################

/**
 * useComputed
 * -----------
 *
 * Creates a memoized derived value inside a React component and
 * re-renders the component whenever that value changes.
 *
 * The computation function `fn` runs lazily — only when one of its
 * reactive dependencies (pulses or other computeds) has changed.
 *
 * Usage:
 *
 *   const price    = new pulseNode(10)
 *   const quantity = new pulseNode(3)
 *
 *   function OrderLine() {
 *     const total = useComputed(() => price.get() * quantity.get())
 *     return <p>Total: {total}</p>
 *   }
 *
 *   price.set(20) // → total recomputes to 60, component re-renders
 *
 * How it works:
 *
 *   1. useMemo creates a single ComputedNode for the lifetime of the component.
 *   2. A bridge EffectNode watches the computed node for changes.
 *   3. When any of the computed's dependencies update, the bridge effect
 *      calls forceUpdate() to trigger a React re-render.
 *   4. On re-render, node.get() returns the newly computed value.
 *
 * Note: The ComputedNode itself is lazy — it does not recompute until
 * node.get() is called. The EffectNode is what drives React re-renders.
 *
 * @param fn - A function that reads reactive sources and returns a value.
 * @returns    The current computed value.
 */
export function useComputed<T>(fn: () => T): T {
  const node = useMemo(() => new ComputedNode(fn), []);

  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const effect = new EffectNode(() => {
      node.get();
      forceUpdate((v) => v + 1);
    });

    return () => effect.dispose();
  }, [node]);

  return node.get();
}

// ##############################
// useObserver
// ##############################

/**
 * useObserver
 * -----------
 *
 * Executes a render function inside a reactive tracking context so that
 * any pulses accessed during rendering automatically trigger re-renders
 * when they change.
 *
 * This is the low-level primitive behind the `observer()` HOC. Use
 * `observer()` for most cases — reach for `useObserver` when you need
 * fine-grained control over which part of a render is tracked.
 *
 * Usage:
 *
 *   function MyComponent() {
 *     return useObserver(() => (
 *       <p>{somepulse.get()}</p>
 *     ))
 *   }
 *
 * How it works:
 *
 *   1. An EffectNode is created once (stored in a ref).
 *   2. Before calling render(), the EffectNode is set as the active observer
 *      via setObserver().
 *   3. Any pulse read inside render() registers this node as a dependency.
 *   4. After render(), the observer context is restored via setObserver(null).
 *   5. When a tracked pulse updates, the EffectNode fires forceUpdate(),
 *      causing React to re-render the component.
 *
 * Important:
 *
 *   The render function must be called inside the try/finally block to
 *   guarantee the observer context is always restored — even if render()
 *   throws. Leaving the context open would cause pulses accessed elsewhere
 *   to incorrectly register this component as a dependency.
 *
 * @param render - A function that returns a React element using reactive sources.
 * @returns        The React element produced by the render function.
 */
export function useObserver(
  render: () => React.ReactElement | null,
): React.ReactElement | null {
  const [, forceUpdate] = useState(0);

  const effectRef = useRef<EffectNode | null>(null);

  if (!effectRef.current) {
    // Suppress the EffectNode's initial synchronous run so it does not call
    // forceUpdate() during the render phase. React forbids state updates
    // during render; the initial subscription is registered below via
    // setObserver(), so the immediate run is not needed for tracking.
    let mounted = false;
    effectRef.current = new EffectNode(() => {
      if (mounted) forceUpdate((v) => v + 1);
    });
    mounted = true;
  }

  useEffect(() => {
    return () => {
      if (effectRef.current) {
        effectRef.current.dispose();
        effectRef.current = null;
      }
    };
  }, []);

  const effect = effectRef.current as Node;

  // Save the previous observer so nested useObserver calls restore correctly
  // instead of blindly setting null and orphaning the outer tracking context.
  const prevObserver = activeObserver;
  setObserver(effect);

  let result: React.ReactElement | null = null;

  try {
    result = render();
  } finally {
    setObserver(prevObserver);
  }

  return result;
}

// ##############################
// useEffectpulse
// ##############################

/**
 * useEffectpulse
 * ---------------
 *
 * Runs a reactive side-effect inside a React component that automatically
 * re-executes whenever its lane-x pulse dependencies change.
 *
 * This is the lane-x equivalent of React's useEffect, but dependency
 * tracking is automatic — you do not need to declare a dependency array.
 * Any pulses read inside `fn` are tracked and will trigger a re-run.
 *
 * Usage:
 *
 *   const count = new pulseNode(0)
 *
 *   function Logger() {
 *     useEffectpulse(() => {
 *       console.log("count is now:", count.get())
 *     })
 *     return null
 *   }
 *
 *   count.set(5) // → logs "count is now: 5" automatically
 *
 * How it works:
 *
 *   1. On mount, a new EffectNode is created with the provided function.
 *   2. The EffectNode executes fn() immediately, tracking any pulses read.
 *   3. When a tracked pulse updates, the EffectNode re-runs fn().
 *   4. On unmount, dispose() unregisters the effect from all pulse
 *      observer lists, stopping future executions and freeing memory.
 *
 * Difference from useEffect:
 *
 *   useEffect   → you declare deps manually, React re-runs on dep changes
 *   useEffectpulse → deps are tracked automatically, lane-x re-runs on pulse changes
 *
 * @param fn - The side-effect function. May read any number of pulses.
 */
export function useEffectpulse(fn: () => void) {
  useEffect(() => {
    // Create the reactive effect. The EffectNode constructor calls fn()
    // immediately to establish the initial set of pulse dependencies.
    const effect = new EffectNode(fn);

    // Cleanup: when the component unmounts, remove this effect from all
    // upstream pulse observer lists. Without this, the pulses would
    // continue calling fn() after the component is gone, causing stale
    // side effects and preventing garbage collection of the component.
    return () => effect.dispose();
  }, []); // empty array: the EffectNode is created once and manages its own lifecycle
}

// ##############################
// useScope
// ##############################

/**
 * useScope
 * --------
 *
 * Creates a Scope tied to a React component's lifecycle.
 *
 * The scope is created on mount and disposed on unmount. Any reactive
 * nodes created inside the scope (pulses, computeds, effects) are
 * automatically cleaned up when the component unmounts.
 *
 * Also supports algebraic effect handlers: install a handler on the
 * scope to catch errors, manage transactions, or add custom effects
 * for all reactive computations within this component.
 *
 * Usage:
 *
 *   function MyComponent() {
 *     const scope = useScope()
 *
 *     // Install an error handler for all reactive effects in this component
 *     scope.handle(ERROR, (error, resume) => {
 *       console.error('Caught in MyComponent:', error)
 *     })
 *
 *     // Reactive nodes created in scope.run() are auto-cleaned on unmount
 *     useEffect(() => {
 *       scope.run(() => {
 *         new EffectNode(() => {
 *           console.log(somepulse.get())
 *         })
 *       })
 *     }, [scope])
 *
 *     return <div>...</div>
 *   }
 *
 * @returns A Scope instance tied to the component's lifecycle.
 */
export function useScope(): Scope {
  const scopeRef = useRef<Scope | null>(null);

  if (!scopeRef.current) {
    scopeRef.current = createScope();
  }

  useEffect(() => {
    return () => {
      if (scopeRef.current) {
        scopeRef.current.dispose();
        scopeRef.current = null;
      }
    };
  }, []);

  return scopeRef.current!;
}

// ##############################
// useTransition (lane-x)
// ##############################

/**
 * useZoTransition
 * -------------------
 *
 * lane-x's equivalent of React's useTransition, implemented using
 * concurrent lanes.
 *
 * Returns a [isPending, startTransition] tuple. pulse writes inside
 * startTransition() are buffered in a concurrent lane and only committed
 * after the callback completes.
 *
 * While the transition is pending, `isPending` is true. The component
 * re-renders with the base (non-transition) state first, then again
 * after the transition commits.
 *
 * Usage:
 *
 *   function SearchPage() {
 *     const [isPending, startTransition] = useZoTransition()
 *
 *     return (
 *       <div>
 *         <input onChange={(e) => {
 *           // Urgent: update the input immediately
 *           inputpulse.set(e.target.value)
 *
 *           // Non-urgent: update search results in a transition
 *           startTransition(() => {
 *             filterpulse.set(e.target.value)
 *           })
 *         }} />
 *         {isPending && <Spinner />}
 *         <Results />
 *       </div>
 *     )
 *   }
 *
 * @returns [isPending: boolean, startTransition: (fn: () => void) => void]
 */
export function useZoTransition(): [boolean, (fn: () => void) => void] {
  const [isPending, setIsPending] = useState(false);
  const laneRef = useRef<Lane | null>(null);

  const startTransition = useCallback((fn: () => void) => {
    // Abort any existing transition.
    if (laneRef.current && laneRef.current.status === "active") {
      laneRef.current.abort();
    }

    setIsPending(true);

    const lane = forkLane("transition");
    laneRef.current = lane;

    // Run the pulse writes in the lane context.
    lane.run(fn);

    // Commit on the next microtask to allow React to render the pending state.
    Promise.resolve().then(() => {
      if (laneRef.current === lane && lane.status === "active") {
        lane.commit();
        setIsPending(false);
        laneRef.current = null;
      }
    });
  }, []);

  // Clean up on unmount.
  useEffect(() => {
    return () => {
      if (laneRef.current && laneRef.current.status === "active") {
        laneRef.current.abort();
      }
    };
  }, []);

  return [isPending, startTransition];
}

// ##############################
// useLane
// ##############################

/**
 * useLane
 * -------
 *
 * Creates a concurrent lane tied to a React component's lifecycle.
 *
 * The lane is created on mount and aborted on unmount (if still active).
 * Use this when you need fine-grained control over speculative state
 * that outlasts a single startTransition call.
 *
 * Usage:
 *
 *   function Editor() {
 *     const lane = useLane('transition')
 *
 *     const handleDraft = () => {
 *       lane.run(() => {
 *         draftpulse.set(editorContent)
 *       })
 *     }
 *
 *     const handlePublish = () => lane.commit()
 *     const handleDiscard = () => lane.abort()
 *
 *     return <div>...</div>
 *   }
 *
 * @param priority - The lane's scheduling priority.
 * @returns A Lane instance tied to the component's lifecycle.
 */
export function useLane(priority: Priority = "transition"): Lane {
  const laneRef = useRef<Lane | null>(null);

  if (!laneRef.current) {
    laneRef.current = forkLane(priority);
  }

  useEffect(() => {
    return () => {
      if (laneRef.current && laneRef.current.status === "active") {
        laneRef.current.abort();
      }
    };
  }, []);

  return laneRef.current!;
}
