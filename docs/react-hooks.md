# React Hooks

lane-x provides a set of React hooks that bridge the reactive graph with React's component model. These hooks let you subscribe to pulses, create computed values, run reactive side-effects, and use concurrent lanes — all within standard React components.

## `usePulse<T>(pulse: PulseNode<T>): T`

Subscribes a component to a PulseNode and returns its current value. The component re-renders automatically whenever the pulse changes.

```tsx
import { PulseNode } from "lane-x";
import { usePulse } from "lane-x";

const count = new PulseNode(0);

function Counter() {
  const value = usePulse(count);
  return (
    <div>
      <p>Count: {value}</p>
      <button onClick={() => count.set(value + 1)}>Increment</button>
    </div>
  );
}
```

Under the hood, `usePulse` creates an `EffectNode` that calls `pulse.get()` to establish the dependency, then triggers a React re-render via `forceUpdate` when the pulse changes. The effect is disposed when the compnent unmounts.

## `useComputed<T>(fn: () => T): T`

Creates a memoized derived value inside a component and re-renders whenever that value changes. Dependencies are tracked automaticaly — no dependency array needed.

```tsx
import { PulseNode, useComputed } from "lane-x";

const price = new PulseNode(29.99);
const quantity = new PulseNode(3);

function OrderTotal() {
  const total = useComputed(() => price.get() * quantity.get());
  return <p>Total: ${total.toFixed(2)}</p>;
}

// When price or quantity changes, total recomputes and the component re-renders
```

The `ComputedNode` is created once (via `useMemo`) and a bridge `EffectNode` drives re-renders when the computed value changes.

## `useObserver(render: () => ReactElement | null): ReactElement | null`

Executes a render function inside a reactive tracking context so that any pulses accessed during rendering automatically trigger re-renders.

```tsx
import { useObserver } from "lane-x";

const name = new PulseNode("World");
const greeting = new PulseNode("Hello");

function Greeter() {
  return useObserver(() => (
    <h1>
      {greeting.get()}, {name.get()}!
    </h1>
  ));
}
```

This is the low-level primitive for fine-grained reactive rendering. Use it when you need to control exactly which part of a render is tracked.

**Important:** The render function runs inside a `try/finally` block to guarentee the observer context is always restored, even if the render throws.

## `useEffectPulse(fn: () => void): void`

Runs a reactive side-effect inside a component that re-executes whenever its pulse dependencies change. This is the lane-x equivelent of React's `useEffect`, but with automatic dependency tracking.

```tsx
import { PulseNode, useEffectPulse } from "lane-x";

const count = new PulseNode(0);

function Logger() {
  useEffectPulse(() => {
    console.log("count is now:", count.get());
  });

  return <button onClick={() => count.set(count.get() + 1)}>Click me</button>;
}
```

Key differences from `useEffect`:

| Feature              | `useEffect`       | `useEffectPulse`          |
| -------------------- | ----------------- | ------------------------- |
| Dependency tracking  | Manual array      | Automatic                 |
| Triggers on          | React re-render   | Pulse changes             |
| Runs on mount        | Yes               | Yes                       |
| Cleanup on unmount   | Yes               | Yes (via EffectNode.dispose) |

## `useScope(): Scope`

Creates a `Scope` tied to the component's lifecycle. The scope is created on mount and disposed on unmount, automatically cleaning up any reactive nodes created within it.

```tsx
import { useScope, EffectNode, ERROR } from "lane-x";

function Dashboard() {
  const scope = useScope();

  // Install an error handler for all reactive effects in this component
  scope.handle(ERROR, (error, resume) => {
    console.error("Dashboard caught:", error);
    showErrorToast(error.message);
  });

  useEffect(() => {
    scope.run(() => {
      // These effects are owned by the scope and auto-cleaned on unmount
      new EffectNode(() => {
        updateChart(data.get());
      });

      new EffectNode(() => {
        updateTable(rows.get());
      });
    });
  }, [scope]);

  return <div>...</div>;
}
```

## `useZoTransition(): [boolean, (fn: () => void) => void]`

lane-x's equivalent of React's `useTransition`, implemented with concurrent lanes. Returns an `[isPending, startTransition]` tuple.

Pulse writes inside `startTransition()` are buffered in a concurrent lane and committed asynchronosly after the callback completes.

```tsx
import { PulseNode, useZoTransition, usePulse } from "lane-x";

const searchQuery = new PulseNode("");
const searchResults = new PulseNode<string[]>([]);

function SearchPage() {
  const [isPending, startTransition] = useZoTransition();
  const query = usePulse(searchQuery);
  const results = usePulse(searchResults);

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Urgent: update input immediately
    searchQuery.set(e.target.value);

    // Non-urgent: update results in a transition
    startTransition(() => {
      searchResults.set(performSearch(e.target.value));
    });
  };

  return (
    <div>
      <input value={query} onChange={handleInput} />
      {isPending && <Spinner />}
      <ul>
        {results.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </div>
  );
}
```

If a new transition starts while one is already pending, the previous lane is aborted automaticaly.

## `useLane(priority?: Priority): Lane`

Creates a concurrent lane tied to the component's lifecycle. The lane is created on mount and aborted on unmount if still active.

Use this when you need fine-grained control over speculative state that outlasts a single `startTransition` call.

```tsx
import { useLane, usePulse, PulseNode } from "lane-x";

const draft = new PulseNode("");

function Editor() {
  const lane = useLane("transition");
  const content = usePulse(draft);

  const handleEdit = (text: string) => {
    lane.run(() => {
      draft.set(text);
    });
  };

  const handlePublish = () => lane.commit();
  const handleDiscard = () => lane.abort();

  return (
    <div>
      <textarea value={content} onChange={(e) => handleEdit(e.target.value)} />
      <button onClick={handlePublish}>Publish</button>
      <button onClick={handleDiscard}>Discard</button>
    </div>
  );
}
```

## Complete Example: Todo App

Here's a full example combining multiple hooks:

```tsx
import {
  PulseNode,
  ComputedNode,
  usePulse,
  useComputed,
  useEffectPulse,
  useScope,
  ERROR,
} from "lane-x";

// Global reactive state
const todos = new PulseNode<{ id: number; text: string; done: boolean }[]>([]);
let nextId = 1;

function TodoApp() {
  const scope = useScope();
  scope.handle(ERROR, (err) => console.error("Todo error:", err));

  const items = usePulse(todos);
  const remaining = useComputed(() => todos.get().filter((t) => !t.done).length);

  useEffectPulse(() => {
    document.title = `${todos.get().filter((t) => !t.done).length} todos left`;
  });

  const addTodo = (text: string) => {
    todos.set([...todos.get(), { id: nextId++, text, done: false }]);
  };

  const toggle = (id: number) => {
    todos.set(
      todos.get().map((t) => (t.id === id ? { ...t, done: !t.done } : t))
    );
  };

  return (
    <div>
      <h1>Todos ({remaining} remaining)</h1>
      <ul>
        {items.map((todo) => (
          <li
            key={todo.id}
            onClick={() => toggle(todo.id)}
            style={{ textDecoration: todo.done ? "line-through" : "none" }}
          >
            {todo.text}
          </li>
        ))}
      </ul>
      <button onClick={() => addTodo(`Task ${nextId}`)}>Add Todo</button>
    </div>
  );
}
```
