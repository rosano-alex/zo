# Bridge (Cross-Runtime Synchronization)

The `GraphBridge` connects two JavaScript runtimes and synchronizes reactive graph nodes between them via a `MessagePort`. This enables patterns like offloading expensive computations to Web Workers while keeping the UI reactive.

## Overview

A bridge has two roles:

- **Exposing**: Making a local pulse or computed visible to the remote side. The bridge watches for changes and sends update messages automaticaly.
- **Proxying**: Creating local `RemotePulse` / `RemoteComputed` instances that mirror nodes exposed by the remote side.

## Basic Setup

### Main Thread

```ts
import { PulseNode, EffectNode, connectWorker } from "lane-x";

const worker = new Worker("worker.js");
const bridge = connectWorker(worker);

// Expose a local signal to the worker
const count = new PulseNode(0);
bridge.expose("count", count);

// Create a proxy for a computed that lives in the worker
const result = bridge.proxyComputed<number>("expensiveResult");

// Use the proxy just like a normal computed
new EffectNode(() => {
  console.log("Worker result:", result.get());
});

// When we update count, the worker sees it and recomputes
count.set(42);
```

### Worker

```ts
import { ComputedNode, createWorkerBridge } from "lane-x";

createWorkerBridge((bridge) => {
  // Proxy the main thread's signal
  const count = bridge.proxySignal<number>("count");

  // Run expensive computation in the worker
  const expensive = new ComputedNode(() => {
    return heavyComputation(count.get());
  });

  // Expose the result back to the main thread
  bridge.expose("expensiveResult", expensive);
});
```

## Wire Protocol

The bridge uses a simple message protocol that works over any `MessagePort`-compatible channel (Web Workers, SharedWorkers, iframes, BroadcastChannel, or WebSocket wrappers).

| Message Type  | Direction | Purpose                                   |
| ------------- | --------- | ----------------------------------------- |
| `expose`      | Both      | Announce a node and its inital value      |
| `update`      | Both      | A node's value has changed                |
| `set`         | Both      | Request a write to a remote signal        |
| `subscribe`   | Both      | Request updates for a node                |
| `unsubscribe` | Both      | Stop receiving updates                    |
| `dispose`     | Both      | A node has been disposed                  |
| `ping`/`pong` | Both      | Keepalive / latency measurment            |

## GraphBridge API

### `new GraphBridge(port: MessagePort)`

Creates a bridge connected to the given port. The bridge immediately starts listening for messages.

### `bridge.expose(id: string, node: PulseNode | ComputedNode): void`

Makes a local node visible to the remote side. An `EffectNode` is created internally to watch for changes and send update messages.

```ts
const price = new PulseNode(9.99);
bridge.expose("price", price);

const total = new ComputedNode(() => price.get() * qty.get());
bridge.expose("total", total);
```

Each node needs a unique string ID that both sides agree on.

### `bridge.proxySignal<T>(id: string, defaultValue?: T): RemotePulse<T>`

Creates a local proxy for a remote signal. The proxy behaves like a regular `PulseNode` — you can read it with `get()` and it participates in dependency tracking normaly.

```ts
const remoteCount = bridge.proxySignal<number>("count", 0);

new EffectNode(() => {
  console.log("Remote count:", remoteCount.get());
});
```

Calling `set()` on a `RemotePulse` sends a `set` message to the remote side. The local value is not updated until the remote confirms with an `update` message. For immediate local updates, use `setOptimistic()`.

### `bridge.proxyComputed<T>(id: string, defaultValue?: T): RemoteComputed<T>`

Creates a local proxy for a remote computed. The computation runs on the remote side; only the result is sent over the bridge.

```ts
const remoteTotal = bridge.proxyComputed<number>("total");

new EffectNode(() => {
  console.log("Remote total:", remoteTotal.get());
});
```

### `bridge.awaitProxy<T>(id: string, kind: "signal" | "computed"): Promise<RemotePulse<T> | RemoteComputed<T>>`

Returns a promise that resolves when the remote side exposes a node with the given ID. Useful when the timing of `expose()` on the remote side is not guarenteed.

```ts
const proxy = await bridge.awaitProxy<number>("lateNode", "signal");
console.log(proxy.get());
```

### `bridge.ping(): Promise<number>`

Sends a ping and returns the round-trip latency in milliseconds. Useful for monitoring connection health.

```ts
const latency = await bridge.ping();
console.log(`Round-trip: ${latency}ms`);
```

### `bridge.dispose(): void`

Tears down the bridge: disposes all watch effects, disconnects proxies, sends dispose messages, and closes the port.

## RemotePulse

A `RemotePulse<T>` extends `PulseNode<T>` and acts as a local proxy for a signal on the remote side.

### Key Differences from PulseNode

- **`set(value)`** sends a `set` message to the remote side. The local value is NOT updated immediately — it waits for confirmation via an `update` message.
- **`setOptimistic(value)`** updates the local value immediately AND sends the write to the remote. If the remote rejects the value, the next `update` message will correct the local state.
- **`get()`** returns the locally cached value, which is kept in sync via update messages from the remote.

```ts
const remote = bridge.proxySignal<number>("count", 0);

// Conservative: wait for remote confirmation
remote.set(5);
// local value is still 0 until remote confirms

// Optimistic: update locally and send to remote
remote.setOptimistic(5);
// local value is immediately 5, remote will confirm or correct
```

## RemoteComputed

A `RemoteComputed<T>` mirrors a computed node on the remote side. It's read-only — calling `get()` returns the latest value recieved from the remote.

Internally, it uses a `PulseNode` to store the mirrored value, so it participates in the local reactive graph just like any other signal.

## Convenience Functions

### `connectWorker(worker: Worker): GraphBridge`

Creates a `MessageChannel`, sends one port to the worker, and returns a bridge connected to the other port.

```ts
const bridge = connectWorker(new Worker("worker.js"));
```

### `createWorkerBridge(setup: (bridge: GraphBridge) => void): void`

Listens for the initial message containing a `MessagePort` and calls the setup function with a bridge. Use this inside a Web Worker.

```ts
// worker.ts
createWorkerBridge((bridge) => {
  // Set up proxies and expose nodes
});
```

## Advanced: Multiple Bridges

You can create multiple bridges to connect different workers or iframes, each synchornizing a different subset of your reactive graph:

```ts
// Main thread
const dataWorker = new Worker("data-worker.js");
const renderWorker = new Worker("render-worker.js");

const dataBridge = connectWorker(dataWorker);
const renderBridge = connectWorker(renderWorker);

// Expose different signals to different workers
dataBridge.expose("rawData", rawDataPulse);
renderBridge.expose("theme", themePulse);
renderBridge.expose("viewport", viewportPulse);

// Proxy results from both workers
const processedData = dataBridge.proxyComputed<Data>("processed");
const renderOutput = renderBridge.proxyComputed<Canvas>("frame");
```

## Error Handling

The bridge degrades gracefully when the connection is lost:

- If `postMessage` fails (port closed), the bridge marks itself as inactive and stops sending messages.
- `RemotePulse.set()` throws if the proxy is disconnected.
- `RemotePulse.setOptimistic()` updates the local value even if disconnected, but the write won't reach the remote.
- `dispose()` is idempotent — calling it multiple times is safe.
