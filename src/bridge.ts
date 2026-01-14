/// <reference lib="webworker" />
import { PulseNode } from "./pulse";
import { ComputedNode } from "./computed";
import { EffectNode } from "./effect";
import type { Node } from "./node";

// #################################
// Message protocol
// #################################

/**
 * BridgeMessage
 * -------------
 *
 * The wire protocol for cross-runtime graph synchronization.
 *
 * Every message is a plain object (structuredClone-safe) so it can
 * be sent over any MessagePort-compatible channel: Web Workers,
 * SharedWorkers, iframes, BroadcastChannel, or even WebSocket
 * wrappers that implement the same interface.
 *
 * Message types:
 *
 *   expose    — One side announces a node (signal or computed) and
 *               its current value. The other side creates a local
 *               proxy that mirrors it.
 *
 *   update    — A node's value has changed. The receiving side
 *               updates its local proxy.
 *
 *   set       — A remote signal's set() was called from the other
 *               side. The owning side applies the write and
 *               propagates normally.
 *
 *   subscribe — A side wants to receive updates for a node.
 *
 *   unsubscribe — A side no longer needs updates for a node.
 *
 *   dispose   — A node has been disposed on its owning side.
 *               The other side should clean up its proxy.
 *
 *   ping/pong — Keepalive / latency measurement.
 */
export type BridgeMessage =
  | {
      type: "expose";
      id: string;
      value: any;
      kind: "signal" | "computed";
      version: number;
    }
  | { type: "update"; id: string; value: any; version: number }
  | { type: "set"; id: string; value: any }
  | { type: "subscribe"; id: string }
  | { type: "unsubscribe"; id: string }
  | { type: "dispose"; id: string }
  | { type: "ping"; timestamp: number }
  | { type: "pong"; timestamp: number };

// #################################
// RemoteSignal
// #################################

/**
 * RemoteSignal
 * ------------
 *
 * A local proxy for a SignalNode that lives on another runtime.
 *
 * Reads (get()) return the locally cached value, which is kept
 * in sync via 'update' messages from the owning side.
 *
 * Writes (set()) send a 'set' message to the owning side, which
 * applies the write to the real signal and propagates the change
 * back via an 'update' message. This ensures the owning side is
 * always the source of truth.
 *
 * RemoteSignal extends SignalNode so it can be used anywhere a
 * regular signal is expected — in computed nodes, effects, and
 * React hooks. The reactive graph on this side sees it as a normal
 * signal; the cross-runtime synchronization is transparent.
 */
export class RemotePulse<T> extends PulseNode<T> {
  /** The bridge that owns this proxy. */
  private bridge: GraphBridge;

  /** The node ID on the remote side. */
  readonly remoteId: string;

  /** Whether this proxy is still connected to the remote. */
  connected = true;

  constructor(bridge: GraphBridge, id: string, initialValue: T) {
    super(initialValue);
    this.bridge = bridge;
    this.remoteId = id;
  }

  /**
   * Overrides SignalNode.set() to send the write to the remote side.
   *
   * The local value is NOT updated here — it will be updated when
   * the remote sends back an 'update' message confirming the change.
   * This prevents the local graph from seeing an optimistic value
   * that might be rejected by the remote (e.g., if the remote has
   * validation logic).
   *
   * For optimistic updates, use setOptimistic() which updates the
   * local value immediately and sends the write to the remote.
   */
  override set(next: T) {
    if (!this.connected) {
      throw new Error(`RemoteSignal '${this.remoteId}' is disconnected`);
    }

    this.bridge.send({
      type: "set",
      id: this.remoteId,
      value: next,
    });
  }

  /**
   * setOptimistic()
   *
   * Updates the local value immediately AND sends the write to the
   * remote. If the remote rejects or modifies the value, the next
   * 'update' message will correct the local state.
   *
   * Use this when you need responsive UI updates and can tolerate
   * brief inconsistency.
   */
  setOptimistic(next: T) {
    // Update local value and propagate locally.
    super.set(next);

    // Also send to remote.
    if (this.connected) {
      this.bridge.send({
        type: "set",
        id: this.remoteId,
        value: next,
      });
    }
  }

  /**
   * Called by the bridge when an 'update' message arrives.
   *
   * Updates the local cached value and triggers normal propagation
   * to any local computed nodes and effects that depend on this proxy.
   */
  _receiveUpdate(value: T) {
    // Use the parent class set() to update value and propagate.
    super.set(value);
  }

  /**
   * Called by the bridge when a 'dispose' message arrives.
   */
  _disconnect() {
    this.connected = false;
    this.observers.length = 0;
  }
}

// #################################
// RemoteComputed
// #################################

/**
 * RemoteComputed
 * --------------
 *
 * A local proxy for a ComputedNode that lives on another runtime.
 *
 * Unlike a regular ComputedNode which has a function that recomputes
 * locally, a RemoteComputed is backed by a SignalNode that mirrors
 * the remote computed's value via 'update' messages.
 *
 * From the local graph's perspective, it behaves like a read-only
 * signal — it can be read in computed nodes and effects, and triggers
 * reactivity when the remote value changes.
 *
 * The computation itself runs on the remote side (possibly in a Web
 * Worker for expensive computations), and only the result is sent
 * across the bridge.
 */
export class RemoteComputed<T> {
  /** The bridge that owns this proxy. */
  private bridge: GraphBridge;

  /** The node ID on the remote side. */
  readonly remoteId: string;

  /**
   * Internal signal that stores the mirrored value.
   *
   * Using a SignalNode (rather than a raw value) means the remote
   * computed participates in the local reactive graph automatically.
   * Any local effects or computeds that call get() are tracked.
   */
  readonly signal: PulseNode<T>;

  /** Whether this proxy is still connected to the remote. */
  connected = true;

  constructor(bridge: GraphBridge, id: string, initialValue: T) {
    this.bridge = bridge;
    this.remoteId = id;
    this.signal = new PulseNode(initialValue);
  }

  /**
   * get()
   *
   * Returns the latest value received from the remote computed.
   *
   * Participates in local dependency tracking — any local effect
   * or computed that calls get() will re-run when the remote value
   * changes.
   */
  get(): T {
    return this.signal.get();
  }

  /**
   * Called by the bridge when an 'update' message arrives.
   */
  _receiveUpdate(value: T) {
    this.signal.set(value);
  }

  /**
   * Called by the bridge when a 'dispose' message arrives.
   */
  _disconnect() {
    this.connected = false;
    this.signal.observers.length = 0;
  }
}

// #################################
// GraphBridge
// #################################

/**
 * GraphBridge
 * -----------
 *
 * Connects two runtimes and synchronizes reactive graph nodes between
 * them via a MessagePort.
 *
 * The bridge has two roles:
 *
 *   Exposing: Making a local signal or computed visible to the remote
 *   side. The bridge watches for changes and sends 'update' messages.
 *
 *   Proxying: Creating local RemoteSignal / RemoteComputed instances
 *   that mirror nodes exposed by the remote side.
 *
 * Typical setup:
 *
 *   // Main thread
 *   const channel = new MessageChannel()
 *   const worker = new Worker('worker.js')
 *   worker.postMessage({ port: channel.port2 }, [channel.port2])
 *
 *   const bridge = new GraphBridge(channel.port1)
 *   bridge.expose('count', countSignal)
 *
 *   const result = bridge.proxyComputed<number>('expensiveResult')
 *   new EffectNode(() => {
 *     console.log('Worker computed:', result.get())
 *   })
 *
 *   // Worker
 *   self.onmessage = (e) => {
 *     const bridge = new GraphBridge(e.data.port)
 *     const count = bridge.proxySignal<number>('count')
 *
 *     const expensive = new ComputedNode(() => {
 *       return heavyComputation(count.get())
 *     })
 *     bridge.expose('expensiveResult', expensive)
 *   }
 *
 * The bridge handles:
 *   - Bidirectional synchronization of exposed nodes
 *   - Automatic effect-based change detection for exposed nodes
 *   - Deduplication of updates via version counters
 *   - Graceful disconnection and cleanup
 */
export class GraphBridge {
  /**
   * The underlying communication channel.
   *
   * Any MessagePort-compatible object works: MessageChannel ports,
   * Worker ports, BroadcastChannel, or custom wrappers.
   */
  private port: MessagePort;

  /**
   * Nodes exposed by this side to the remote.
   *
   * Each entry is a local node that the remote side can proxy.
   * The bridge watches these nodes for changes and sends 'update'
   * messages automatically.
   */
  private exposed: Map<
    string,
    {
      node: PulseNode<any> | ComputedNode<any>;
      effect: EffectNode | null;
      version: number;
    }
  > = new Map();

  /**
   * Proxy nodes created on this side that mirror remote nodes.
   */
  private proxies: Map<string, RemotePulse<any> | RemoteComputed<any>> =
    new Map();

  /**
   * Whether the bridge is still active.
   */
  private active = true;

  /**
   * Pending subscriptions requested before the remote has exposed
   * the node. Resolved when an 'expose' message arrives.
   */
  private pendingSubscriptions: Map<
    string,
    {
      resolve: (proxy: RemotePulse<any> | RemoteComputed<any>) => void;
      kind: "signal" | "computed";
    }[]
  > = new Map();

  constructor(port: MessagePort) {
    this.port = port;
    this.port.onmessage = (event: MessageEvent) => {
      this.onMessage(event.data as BridgeMessage);
    };
  }

  /**
   * expose()
   *
   * Makes a local node visible to the remote side.
   *
   * An effect is created that watches the node for changes and sends
   * 'update' messages whenever the value changes. The initial value
   * is sent immediately via an 'expose' message.
   *
   * For signals, the remote side can call set() which sends a 'set'
   * message back, and this side applies the write to the real signal.
   *
   * @param id   - A unique string identifier for this node.
   * @param node - The signal or computed to expose.
   */
  expose(id: string, node: PulseNode<any> | ComputedNode<any>): void {
    if (!this.active) {
      throw new Error("Cannot expose on a disposed bridge");
    }

    if (this.exposed.has(id)) {
      throw new Error(`Node '${id}' is already exposed on this bridge`);
    }

    const isSignal = node instanceof PulseNode;
    const kind: "signal" | "computed" = isSignal ? "signal" : "computed";

    // Get the current value.
    const value = isSignal ? node.value : (node as ComputedNode<any>).get();
    let version = isSignal ? node.version : 0;

    // Send the initial expose message.
    this.send({
      type: "expose",
      id,
      value,
      kind,
      version,
    });

    // Create an effect that watches for changes and sends updates.
    const effect = new EffectNode(() => {
      const currentValue = isSignal
        ? (node as PulseNode<any>).get()
        : (node as ComputedNode<any>).get();

      const currentVersion = isSignal
        ? (node as PulseNode<any>).version
        : ++version;

      // Send update to remote.
      this.send({
        type: "update",
        id,
        value: currentValue,
        version: currentVersion,
      });
    });

    this.exposed.set(id, { node, effect, version });
  }

  /**
   * proxySignal()
   *
   * Creates a local RemoteSignal that mirrors a signal exposed by
   * the remote side.
   *
   * If the remote has already sent an 'expose' message for this id,
   * the proxy is initialized with the received value immediately.
   * Otherwise, the proxy starts with the provided default value and
   * is updated when the 'expose' message arrives.
   *
   * @param id           - The id used by the remote's expose() call.
   * @param defaultValue - Initial value before the remote responds.
   * @returns A RemoteSignal that can be used like a regular signal.
   */
  proxySignal<T>(id: string, defaultValue?: T): RemotePulse<T> {
    if (this.proxies.has(id)) {
      return this.proxies.get(id) as RemotePulse<T>;
    }

    const proxy = new RemotePulse<T>(this, id, defaultValue as T);
    this.proxies.set(id, proxy);

    // Ask the remote to start sending updates.
    this.send({ type: "subscribe", id });

    return proxy;
  }

  /**
   * proxyComputed()
   *
   * Creates a local RemoteComputed that mirrors a computed node
   * exposed by the remote side.
   *
   * The computation itself runs on the remote side. Only the result
   * is sent over the bridge. This is ideal for offloading expensive
   * computations to a Web Worker.
   *
   * @param id           - The id used by the remote's expose() call.
   * @param defaultValue - Initial value before the remote responds.
   * @returns A RemoteComputed that can be used like a regular computed.
   */
  proxyComputed<T>(id: string, defaultValue?: T): RemoteComputed<T> {
    if (this.proxies.has(id)) {
      return this.proxies.get(id) as RemoteComputed<T>;
    }

    const proxy = new RemoteComputed<T>(this, id, defaultValue as T);
    this.proxies.set(id, proxy);

    // Ask the remote to start sending updates.
    this.send({ type: "subscribe", id });

    return proxy;
  }

  /**
   * awaitProxy()
   *
   * Returns a promise that resolves when the remote side exposes a
   * node with the given id. Useful when the timing of expose() on
   * the remote side is not guaranteed.
   *
   * @param id   - The id to wait for.
   * @param kind - Whether to expect a signal or computed.
   * @returns A promise that resolves with the proxy.
   */
  awaitProxy<T>(id: string, kind: "signal"): Promise<RemotePulse<T>>;
  awaitProxy<T>(id: string, kind: "computed"): Promise<RemoteComputed<T>>;
  awaitProxy<T>(
    id: string,
    kind: "signal" | "computed",
  ): Promise<RemotePulse<T> | RemoteComputed<T>> {
    // If already proxied, resolve immediately.
    if (this.proxies.has(id)) {
      return Promise.resolve(this.proxies.get(id) as any);
    }

    return new Promise((resolve) => {
      if (!this.pendingSubscriptions.has(id)) {
        this.pendingSubscriptions.set(id, []);
      }
      this.pendingSubscriptions.get(id)!.push({ resolve, kind });

      // Send subscribe message so the remote knows we want this node.
      this.send({ type: "subscribe", id });
    });
  }

  /**
   * send()
   *
   * Sends a message to the remote side.
   *
   * Public so that RemoteSignal can call it for 'set' messages.
   * All other code should go through the higher-level API.
   */
  send(msg: BridgeMessage): void {
    if (!this.active) return;

    try {
      this.port.postMessage(msg);
    } catch {
      // Port may be closed — degrade gracefully.
      this.active = false;
    }
  }

  /**
   * dispose()
   *
   * Tears down the bridge, cleaning up all exposed nodes and proxies.
   *
   * - Disposes all watch effects for exposed nodes.
   * - Disconnects all remote proxies.
   * - Sends 'dispose' messages for all exposed nodes.
   * - Closes the MessagePort.
   */
  dispose(): void {
    if (!this.active) return;
    this.active = false;

    // Dispose watch effects for exposed nodes.
    for (const [id, entry] of this.exposed) {
      if (entry.effect) {
        entry.effect.dispose();
      }
      this.send({ type: "dispose", id });
    }
    this.exposed.clear();

    // Disconnect all proxies.
    for (const proxy of this.proxies.values()) {
      proxy._disconnect();
    }
    this.proxies.clear();

    // Reject pending subscriptions.
    this.pendingSubscriptions.clear();

    // Close the port.
    try {
      this.port.close();
    } catch {
      // Already closed.
    }
  }

  /**
   * ping()
   *
   * Sends a ping message and returns a promise that resolves with
   * the round-trip latency in milliseconds.
   *
   * Useful for monitoring the health of the cross-runtime connection
   * and adapting behavior (e.g., switching to optimistic updates when
   * latency is low).
   */
  ping(): Promise<number> {
    const start = performance.now();

    return new Promise((resolve) => {
      const onMessage = (event: MessageEvent) => {
        const msg = event.data as BridgeMessage;
        if (msg.type === "pong" && msg.timestamp === start) {
          this.port.removeEventListener("message", onMessage);
          resolve(performance.now() - start);
        }
      };

      this.port.addEventListener("message", onMessage);
      this.send({ type: "ping", timestamp: start });
    });
  }

  //Handle Messages

  /**
   * Processes incoming messages from the remote side.
   */
  private onMessage(msg: BridgeMessage): void {
    if (!this.active) return;

    switch (msg.type) {
      case "expose": {
        // Remote is exposing a node. Create or update local proxy.
        let proxy = this.proxies.get(msg.id);

        if (!proxy) {
          // Create proxy based on kind.
          if (msg.kind === "signal") {
            proxy = new RemotePulse(this, msg.id, msg.value);
          } else {
            proxy = new RemoteComputed(this, msg.id, msg.value);
          }
          this.proxies.set(msg.id, proxy);
        } else {
          // Proxy already exists (created by proxySignal/proxyComputed).
          // Update its value.
          proxy._receiveUpdate(msg.value);
        }

        // Resolve any pending subscriptions.
        const pending = this.pendingSubscriptions.get(msg.id);
        if (pending) {
          for (const { resolve } of pending) {
            resolve(proxy);
          }
          this.pendingSubscriptions.delete(msg.id);
        }
        break;
      }

      case "update": {
        // Remote node value changed. Update local proxy.
        const proxy = this.proxies.get(msg.id);
        if (proxy) {
          proxy._receiveUpdate(msg.value);
        }
        break;
      }

      case "set": {
        // Remote is requesting a write to one of our exposed signals.
        const entry = this.exposed.get(msg.id);
        if (entry && entry.node instanceof PulseNode) {
          entry.node.set(msg.value);
        }
        break;
      }

      case "subscribe": {
        // Remote wants updates for one of our exposed nodes.
        const entry = this.exposed.get(msg.id);
        if (entry) {
          const isSignal = entry.node instanceof PulseNode;
          const value = isSignal
            ? (entry.node as PulseNode<any>).value
            : (entry.node as ComputedNode<any>).get();

          this.send({
            type: "expose",
            id: msg.id,
            value,
            kind: isSignal ? "signal" : "computed",
            version: entry.version,
          });
        }
        break;
      }

      case "unsubscribe": {
        // Remote no longer needs updates. We keep the expose but could
        // optimize by pausing the watch effect.
        break;
      }

      case "dispose": {
        // Remote node has been disposed. Clean up local proxy.
        const proxy = this.proxies.get(msg.id);
        if (proxy) {
          proxy._disconnect();
          this.proxies.delete(msg.id);
        }
        break;
      }

      case "ping": {
        this.send({ type: "pong", timestamp: msg.timestamp });
        break;
      }

      case "pong": {
        // Handled by ping() promise listener.
        break;
      }
    }
  }
}

// #################################
// Worker helpers
// #################################

/**
 * createWorkerBridge()
 *
 * Convenience function for setting up a bridge in a Web Worker.
 *
 * Listens for the initial message containing the MessagePort, creates
 * a GraphBridge, and calls the setup function with it.
 *
 * Usage (in worker.ts):
 *
 *   createWorkerBridge((bridge) => {
 *     const count = bridge.proxySignal<number>('count')
 *
 *     const expensive = new ComputedNode(() => {
 *       return heavyComputation(count.get())
 *     })
 *
 *     bridge.expose('result', expensive)
 *   })
 *
 * @param setup - Function called with the bridge once the port is received.
 */
export function createWorkerBridge(setup: (bridge: GraphBridge) => void): void {
  const ctx = globalThis as DedicatedWorkerGlobalScope;

  ctx.onmessage = (event: MessageEvent) => {
    if (event.data && event.data.port instanceof MessagePort) {
      const bridge = new GraphBridge(event.data.port);
      setup(bridge);
    }
  };
}

/**
 * connectWorker()
 *
 * Convenience function for setting up a bridge on the main thread.
 *
 * Creates a MessageChannel, sends one port to the worker, and returns
 * a GraphBridge connected to the other port.
 *
 * Usage (main thread):
 *
 *   const worker = new Worker('worker.js')
 *   const bridge = connectWorker(worker)
 *
 *   bridge.expose('count', countSignal)
 *   const result = bridge.proxyComputed<number>('result')
 *
 * @param worker - The Web Worker to connect to.
 * @returns A GraphBridge connected to the worker.
 */
export function connectWorker(worker: Worker): GraphBridge {
  const channel = new MessageChannel();

  worker.postMessage({ port: channel.port2 }, [channel.port2]);

  return new GraphBridge(channel.port1);
}
