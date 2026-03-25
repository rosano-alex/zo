// src/context.ts
var activeObserver = null;
function setObserver(node) {
  activeObserver = node;
}

// src/clock.ts
var epoch = 0;
function tick() {
  epoch++;
}

// src/node.ts
var NodeFlags = /* @__PURE__ */ ((NodeFlags4) => {
  NodeFlags4[NodeFlags4["CLEAN"] = 0] = "CLEAN";
  NodeFlags4[NodeFlags4["DIRTY"] = 1] = "DIRTY";
  NodeFlags4[NodeFlags4["QUEUED"] = 2] = "QUEUED";
  NodeFlags4[NodeFlags4["RUNNING"] = 4] = "RUNNING";
  NodeFlags4[NodeFlags4["DISPOSED"] = 8] = "DISPOSED";
  return NodeFlags4;
})(NodeFlags || {});

// src/pulse.ts
var PulseNode = class {
  value;
  version = 0;
  observers = [];
  constructor(value) {
    this.value = value;
  }
  get() {
    const obs = activeObserver;
    if (obs && this.observers.indexOf(obs) === -1) {
      this.observers.push(obs);
    }
    return this.value;
  }
  set(next) {
    if (Object.is(this.value, next)) return;
    this.value = next;
    this.version++;
    tick();
    const observers = this.observers;
    let write = 0;
    for (let i = 0; i < observers.length; i++) {
      const obs = observers[i];
      if (obs !== void 0) {
        if (obs.flags & 8 /* DISPOSED */) continue;
        observers[write++] = obs;
        obs.mark();
      }
    }
    if (write < observers.length) observers.length = write;
  }
};

// src/lanetypes.ts
var LaneTypes = /* @__PURE__ */ ((LaneTypes2) => {
  LaneTypes2[LaneTypes2["SYNC"] = 1] = "SYNC";
  LaneTypes2[LaneTypes2["USER"] = 2] = "USER";
  LaneTypes2[LaneTypes2["TRANSITION"] = 4] = "TRANSITION";
  LaneTypes2[LaneTypes2["BACKGROUND"] = 8] = "BACKGROUND";
  return LaneTypes2;
})(LaneTypes || {});

// src/computed.ts
var ComputedNode = class {
  compute;
  value;
  lane = 2 /* USER */;
  flags = 1 /* DIRTY */;
  constructor(fn) {
    this.compute = fn;
  }
  observers = [];
  get() {
    if (this.flags & 1 /* DIRTY */) {
      this.recompute();
    }
    const obs = activeObserver;
    if (obs && this.observers.indexOf(obs) === -1) {
      this.observers.push(obs);
    }
    return this.value;
  }
  mark() {
    if (!(this.flags & 1 /* DIRTY */)) {
      this.flags |= 1 /* DIRTY */;
      for (let i = 0; i < this.observers.length; i++) {
        const observer = this.observers[i];
        if (observer) {
          observer.mark();
        }
      }
    }
  }
  run() {
    this.recompute();
  }
  recompute() {
    const prev = activeObserver;
    setObserver(this);
    try {
      const v = this.compute();
      this.value = v;
    } finally {
      setObserver(prev);
    }
    this.flags = 0 /* CLEAN */;
  }
};

// src/scheduler.ts
var statusQueue = {
  [1 /* SYNC */]: [],
  [2 /* USER */]: [],
  [4 /* TRANSITION */]: [],
  [8 /* BACKGROUND */]: []
};
var flushing = false;
function laneQueue(lane) {
  if (statusQueue[lane] == null) {
    statusQueue[lane] = [];
  }
  return statusQueue[lane];
}
function schedule(node) {
  const lane = node.lane;
  laneQueue(lane).push(node);
  if (!flushing) {
    flushing = true;
    queueMicrotask(flush);
  }
}
function runQueue(queue) {
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i];
    if (node) {
      node.run();
    }
  }
  queue.length = 0;
}
function hasWork() {
  return laneQueue(1 /* SYNC */).length > 0 || laneQueue(2 /* USER */).length > 0 || laneQueue(4 /* TRANSITION */).length > 0 || laneQueue(8 /* BACKGROUND */).length > 0;
}
function flush() {
  let iterations = 0;
  do {
    runQueue(laneQueue(1 /* SYNC */));
    runQueue(laneQueue(2 /* USER */));
    runQueue(laneQueue(4 /* TRANSITION */));
    runQueue(laneQueue(8 /* BACKGROUND */));
    if (++iterations > 100) {
      break;
    }
  } while (hasWork());
  flushing = false;
}

// src/effect.ts
var EffectNode = class {
  fn;
  lane;
  flags = 1 /* DIRTY */;
  constructor(fn, lane = 2 /* USER */) {
    this.fn = fn;
    this.lane = lane;
    this.run();
  }
  dispose() {
    this.flags = 8 /* DISPOSED */;
  }
  mark() {
    if (this.flags & 8 /* DISPOSED */) return;
    if (!(this.flags & 2 /* QUEUED */)) {
      this.flags |= 2 /* QUEUED */;
      schedule(this);
    }
  }
  run() {
    if (this.flags & 8 /* DISPOSED */) return;
    const prev = activeObserver;
    setObserver(this);
    try {
      this.fn();
    } finally {
      setObserver(prev);
    }
    this.flags &= ~(1 /* DIRTY */ | 2 /* QUEUED */);
  }
};

// src/bridge.ts
var RemotePulse = class extends PulseNode {
  /** The bridge that owns this proxy. */
  bridge;
  /** The node ID on the remote side. */
  remoteId;
  /** Whether this proxy is still connected to the remote. */
  connected = true;
  constructor(bridge, id, initialValue) {
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
  set(next) {
    if (!this.connected) {
      throw new Error(`RemoteSignal '${this.remoteId}' is disconnected`);
    }
    this.bridge.send({
      type: "set",
      id: this.remoteId,
      value: next
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
  setOptimistic(next) {
    super.set(next);
    if (this.connected) {
      this.bridge.send({
        type: "set",
        id: this.remoteId,
        value: next
      });
    }
  }
  /**
   * Called by the bridge when an 'update' message arrives.
   *
   * Updates the local cached value and triggers normal propagation
   * to any local computed nodes and effects that depend on this proxy.
   */
  _receiveUpdate(value) {
    super.set(value);
  }
  /**
   * Called by the bridge when a 'dispose' message arrives.
   */
  _disconnect() {
    this.connected = false;
    this.observers.length = 0;
  }
};
var RemoteComputed = class {
  /** The bridge that owns this proxy. */
  bridge;
  /** The node ID on the remote side. */
  remoteId;
  /**
   * Internal signal that stores the mirrored value.
   *
   * Using a SignalNode (rather than a raw value) means the remote
   * computed participates in the local reactive graph automatically.
   * Any local effects or computeds that call get() are tracked.
   */
  signal;
  /** Whether this proxy is still connected to the remote. */
  connected = true;
  constructor(bridge, id, initialValue) {
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
  get() {
    return this.signal.get();
  }
  /**
   * Called by the bridge when an 'update' message arrives.
   */
  _receiveUpdate(value) {
    this.signal.set(value);
  }
  /**
   * Called by the bridge when a 'dispose' message arrives.
   */
  _disconnect() {
    this.connected = false;
    this.signal.observers.length = 0;
  }
};
var GraphBridge = class {
  /**
   * The underlying communication channel.
   *
   * Any MessagePort-compatible object works: MessageChannel ports,
   * Worker ports, BroadcastChannel, or custom wrappers.
   */
  port;
  /**
   * Nodes exposed by this side to the remote.
   *
   * Each entry is a local node that the remote side can proxy.
   * The bridge watches these nodes for changes and sends 'update'
   * messages automatically.
   */
  exposed = /* @__PURE__ */ new Map();
  /**
   * Proxy nodes created on this side that mirror remote nodes.
   */
  proxies = /* @__PURE__ */ new Map();
  /**
   * Whether the bridge is still active.
   */
  active = true;
  /**
   * Pending subscriptions requested before the remote has exposed
   * the node. Resolved when an 'expose' message arrives.
   */
  pendingSubscriptions = /* @__PURE__ */ new Map();
  constructor(port) {
    this.port = port;
    this.port.onmessage = (event) => {
      this.onMessage(event.data);
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
  expose(id, node) {
    if (!this.active) {
      throw new Error("Cannot expose on a disposed bridge");
    }
    if (this.exposed.has(id)) {
      throw new Error(`Node '${id}' is already exposed on this bridge`);
    }
    const isSignal = node instanceof PulseNode;
    const kind = isSignal ? "signal" : "computed";
    const value = isSignal ? node.value : node.get();
    let version = isSignal ? node.version : 0;
    this.send({
      type: "expose",
      id,
      value,
      kind,
      version
    });
    let firstRun = true;
    const effect = new EffectNode(() => {
      const currentValue = isSignal ? node.get() : node.get();
      if (firstRun) {
        firstRun = false;
        return;
      }
      const currentVersion = isSignal ? node.version : ++version;
      this.send({
        type: "update",
        id,
        value: currentValue,
        version: currentVersion
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
  proxySignal(id, defaultValue) {
    if (this.proxies.has(id)) {
      return this.proxies.get(id);
    }
    const proxy = new RemotePulse(this, id, defaultValue);
    this.proxies.set(id, proxy);
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
  proxyComputed(id, defaultValue) {
    if (this.proxies.has(id)) {
      return this.proxies.get(id);
    }
    const proxy = new RemoteComputed(this, id, defaultValue);
    this.proxies.set(id, proxy);
    this.send({ type: "subscribe", id });
    return proxy;
  }
  awaitProxy(id, kind) {
    if (this.proxies.has(id)) {
      return Promise.resolve(this.proxies.get(id));
    }
    return new Promise((resolve) => {
      if (!this.pendingSubscriptions.has(id)) {
        this.pendingSubscriptions.set(id, []);
      }
      this.pendingSubscriptions.get(id).push({ resolve, kind });
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
  send(msg) {
    if (!this.active) return;
    try {
      this.port.postMessage(msg);
    } catch {
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
  dispose() {
    if (!this.active) return;
    this.active = false;
    for (const [id, entry] of this.exposed) {
      if (entry.effect) {
        entry.effect.dispose();
      }
      this.send({ type: "dispose", id });
    }
    this.exposed.clear();
    for (const proxy of this.proxies.values()) {
      proxy._disconnect();
    }
    this.proxies.clear();
    this.pendingSubscriptions.clear();
    try {
      this.port.close();
    } catch {
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
  ping() {
    const start = performance.now();
    return new Promise((resolve) => {
      const onMessage = (event) => {
        const msg = event.data;
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
  onMessage(msg) {
    if (!this.active) return;
    switch (msg.type) {
      case "expose": {
        let proxy = this.proxies.get(msg.id);
        if (!proxy) {
          if (msg.kind === "signal") {
            proxy = new RemotePulse(this, msg.id, msg.value);
          } else {
            proxy = new RemoteComputed(this, msg.id, msg.value);
          }
          this.proxies.set(msg.id, proxy);
        } else {
          proxy._receiveUpdate(msg.value);
        }
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
        const proxy = this.proxies.get(msg.id);
        if (proxy) {
          proxy._receiveUpdate(msg.value);
        }
        break;
      }
      case "set": {
        const entry = this.exposed.get(msg.id);
        if (entry && entry.node instanceof PulseNode) {
          entry.node.set(msg.value);
        }
        break;
      }
      case "subscribe": {
        const entry = this.exposed.get(msg.id);
        if (entry) {
          const isSignal = entry.node instanceof PulseNode;
          const value = isSignal ? entry.node.value : entry.node.get();
          this.send({
            type: "expose",
            id: msg.id,
            value,
            kind: isSignal ? "signal" : "computed",
            version: entry.version
          });
        }
        break;
      }
      case "unsubscribe": {
        break;
      }
      case "dispose": {
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
        break;
      }
    }
  }
};
function createWorkerBridge(setup) {
  const ctx = globalThis;
  ctx.onmessage = (event) => {
    if (event.data && event.data.port instanceof MessagePort) {
      const bridge = new GraphBridge(event.data.port);
      setup(bridge);
    }
  };
}
function connectWorker(worker) {
  const channel = new MessageChannel();
  worker.postMessage({ port: channel.port2 }, [channel.port2]);
  return new GraphBridge(channel.port1);
}

// src/scope.ts
function defineEffect(name) {
  return Symbol(name);
}
var ERROR = defineEffect("error");
var DISPOSE = defineEffect("dispose");
var TRANSACTION = defineEffect("transaction");
var Scope = class _Scope {
  /**
   * The parent scope in the ownership tree, or null for the root scope.
   *
   * Used by perform() to walk up the tree looking for effect handlers,
   * and by dispose() to propagate teardown from parent to children.
   */
  parent;
  /**
   * Child scopes created by fork() within this scope's run() block.
   *
   * Disposed in reverse-creation order when this scope is disposed,
   * ensuring that children are torn down before their parent's owned
   * nodes (which the children may depend on).
   */
  children = /* @__PURE__ */ new Set();
  /**
   * Reactive nodes (EffectNode, ComputedNode) owned by this scope.
   *
   * Every node created inside scope.run() is automatically registered
   * here via context tracking. On disposal, each node is disposed
   * (effects) or has its observers cleared (computeds/pulses).
   */
  ownedNodes = /* @__PURE__ */ new Set();
  /**
   * User-registered cleanup callbacks, run on disposal.
   *
   * Added via scope.onCleanup(). Run in registration order after
   * all owned nodes and child scopes have been disposed.
   */
  cleanups = [];
  /**
   * Algebraic effect handlers installed on this scope.
   *
   * Keyed by EffectKey symbol. When perform() is called, handlers
   * are looked up starting from the active scope and walking up
   * the parent chain until a match is found.
   */
  handlers = /* @__PURE__ */ new Map();
  /**
   * Whether this scope has been disposed. Disposed scopes reject
   * new node registrations and handler installations.
   */
  disposed = false;
  constructor(parent = null) {
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
  run(fn) {
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
  fork() {
    if (this.disposed) {
      throw new Error("Cannot fork a disposed scope");
    }
    return new _Scope(this);
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
  handle(key, handler) {
    if (this.disposed) {
      throw new Error("Cannot install handler on a disposed scope");
    }
    this.handlers.set(key, handler);
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
  perform(key, payload) {
    let current = this;
    while (current) {
      const handler = current.handlers.get(key);
      if (handler) {
        let result;
        let resumed = false;
        handler(payload, (value) => {
          resumed = true;
          result = value;
        });
        return resumed ? result : void 0;
      }
      current = current.parent;
    }
    if (key === ERROR) {
      throw payload;
    }
    throw new Error(
      `Unhandled effect: ${String(key)}. Install a handler via scope.handle() on an ancestor scope.`
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
  own(node) {
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
  disown(node) {
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
  onCleanup(fn) {
    if (this.disposed) {
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
  dispose() {
    if (this.disposed) return;
    try {
      if (this.handlers.has(DISPOSE) || this.parent) {
        this.perform(DISPOSE, this);
      }
    } catch {
    }
    for (const child of [...this.children]) {
      child.dispose();
    }
    for (const node of this.ownedNodes) {
      if ("dispose" in node && typeof node.dispose === "function") {
        node.dispose();
      } else if ("observers" in node) {
        node.observers.length = 0;
      }
    }
    this.ownedNodes.clear();
    for (const fn of this.cleanups) {
      try {
        fn();
      } catch {
      }
    }
    this.cleanups.length = 0;
    if (this.parent) {
      this.parent.children.delete(this);
    }
    this.disposed = true;
  }
};
var scopeStack = [];
var activeScope = null;
function setActiveScope(scope) {
  if (scope === null) {
    scopeStack.pop();
    activeScope = scopeStack[scopeStack.length - 1] ?? null;
  } else {
    scopeStack.push(scope);
    activeScope = scope;
  }
}
function createScope() {
  return new Scope(activeScope);
}
function perform(key, payload) {
  if (!activeScope) {
    throw new Error(
      `perform() called outside of any scope. Wrap your code in scope.run() to establish a scope context.`
    );
  }
  return activeScope.perform(key, payload);
}
function onCleanup(fn) {
  if (!activeScope) {
    throw new Error(
      `onCleanup() called outside of any scope. Wrap your code in scope.run() to establish a scope context.`
    );
  }
  activeScope.onCleanup(fn);
}

// src/lane.ts
var nextLaneId = 1;
var Lane = class _Lane {
  /**
   * Unique identifier for this lane.
   *
   * Used as a key in maps and for debugging. Monotonically increasing
   * across all lanes created in this runtime.
   */
  id;
  /**
   * The lane's scheduling priority.
   *
   * Determines when the lane's work is flushed relative to other lanes:
   *
   *   sync       → immediate, uninterruptible
   *   transition → can be deferred, interruptible
   *   idle       → only when no higher-priority work is pending
   */
  priority;
  /**
    * Pulse overrides within this lane.
   *
   * When a pulse is set() within this lane's context, the new value
   * is stored here instead of on the pulse itself. When a pulse is
   * get() within this lane, this map is checked first.
   *
   * On commit(), these overrides are applied to the base pulses.
   * On abort(), they are discarded.
   */
  pulseOverrides = /* @__PURE__ */ new Map();
  /**
   * Cached computed results within this lane.
   *
   * When a computed is evaluated within this lane, its result (derived
   * from this lane's pulse overrides) is cached here. This prevents
   * redundant recomputation when the same computed is read multiple
   * times within the lane.
   *
   * Invalidated when a pulse the computed depends on is written to
   * within the lane.
   */
  computedCache = /* @__PURE__ */ new Map();
  /**
   * Set of computed nodes that need recomputation within this lane.
   *
   * When a pulse override is set, all downstream computeds are added
   * here. On the next read, the computed is recomputed using lane
   * values before returning.
   */
  dirtyComputeds = /* @__PURE__ */ new Set();
  /**
   * Nodes scheduled for execution within this lane.
   *
   * Effects triggered by pulse writes within this lane are queued
   * here rather than in the global scheduler. They are flushed
   * according to the lane's priority, and only committed effects
   * propagate to the base graph.
   */
  pendingEffects = [];
  /**
   * Current lifecycle status.
   *
   *   active    — accepting reads and writes
   *   committed — overrides have been applied to base; lane is done
   *   aborted   — overrides discarded; lane is done
   */
  status = "active";
  /**
   * Optional scope that owns this lane. When the scope is disposed,
   * the lane is automatically aborted.
   */
  scope;
  /**
   * Parent lane, if this lane was forked from another lane.
   *
   * When reading a pulse, the lookup chain is:
   *   this lane's overrides → parent lane's overrides → base value
   *
   * This enables nested concurrent contexts (e.g., a transition
   * within a transition).
   */
  parent;
  constructor(priority, parent = null) {
    this.id = nextLaneId++;
    this.priority = priority;
    this.parent = parent;
    this.scope = activeScope;
    if (this.scope) {
      this.scope.onCleanup(() => {
        if (this.status === "active") {
          this.abort();
        }
      });
    }
  }
  /**
   * run()
   *
   * Executes a function within this lane's concurrent context.
   *
   * All pulse reads and writes inside fn() are redirected through
   * this lane's override layer. Multiple calls to run() on the same
   * lane accumulate overrides — they don't reset.
   *
   * @param fn - The function to execute within this lane.
   * @returns The return value of fn.
   * @throws If the lane has been committed or aborted.
   */
  run(fn) {
    if (this.status !== "active") {
      throw new Error(`Cannot run in a ${this.status} lane`);
    }
    setActiveLane(this);
    try {
      return fn();
    } finally {
      setActiveLane(null);
    }
  }
  /**
   * read()
   *
   * Reads a pulse's value within this lane's context.
   *
   * Lookup order:
   *   1. This lane's pulseOverrides
   *   2. Parent lane's overrides (recursive)
   *   3. pulse's base value
   *
   * Called by pulseNode.get() when an active lane is detected.
   *
   * @param pulse - The pulse to read.
   * @returns The value visible to this lane.
   */
  read(pulse) {
    if (this.pulseOverrides.has(pulse)) {
      return this.pulseOverrides.get(pulse);
    }
    if (this.parent) {
      return this.parent.read(pulse);
    }
    return pulse.value;
  }
  /**
   * write()
   *
   * Writes a pulse value within this lane's context.
   *
   * The value is stored in pulseOverrides — the pulse's base value
   * is not mutated. Downstream computed nodes within this lane are
   * marked dirty so they recompute on the next read.
   *
   * Called by pulseNode.set() when an active lane is detected.
   *
   * @param pulse - The pulse to write to.
   * @param value  - The new value.
   */
  write(pulse, value) {
    const current = this.read(pulse);
    if (Object.is(current, value)) return;
    this.pulseOverrides.set(pulse, value);
    this.invalidateDownstream(pulse);
  }
  /**
   * readComputed()
   *
   * Reads a computed node's value within this lane's context.
   *
   * If the computed has been invalidated (a dependency was overridden
   * in this lane), it is recomputed using lane-visible pulse values.
   * The result is cached per-lane.
   *
   * Called by ComputedNode.get() when an active lane is detected.
   *
   * @param node - The computed node to read.
   * @returns The computed value visible to this lane.
   */
  readComputed(node) {
    if (this.computedCache.has(node) && !this.dirtyComputeds.has(node)) {
      return this.computedCache.get(node);
    }
    const value = this.recompute(node);
    this.computedCache.set(node, value);
    this.dirtyComputeds.delete(node);
    return value;
  }
  /**
   * commit()
   *
   * Applies all pulse overrides to the base graph and triggers
   * normal propagation.
   *
   * This is the point where a concurrent lane "becomes real" — all
   * the speculative writes are flushed to the base pulses, which
   * triggers markDirty() and the global scheduler as usual.
   *
   * After commit(), the lane is done and cannot be used further.
   *
   * @throws If the lane is not active.
   */
  commit() {
    if (this.status !== "active") {
      throw new Error(`Cannot commit a ${this.status} lane`);
    }
    this.status = "committed";
    for (const [pulse, value] of this.pulseOverrides) {
      pulse.set(value);
    }
    this.cleanup();
  }
  /**
   * abort()
   *
   * Discards all overrides and marks the lane as aborted.
   *
   * No base pulse values are modified. Any work computed within
   * this lane is thrown away. Corresponds to React abandoning an
   * interrupted render.
   *
   * @throws If the lane is not active.
   */
  abort() {
    if (this.status !== "active") return;
    this.status = "aborted";
    this.cleanup();
  }
  /**
   * fork()
   *
   * Creates a child lane that inherits this lane's overrides.
   *
   * The child lane sees this lane's overrides via the parent chain,
   * and can add its own on top. Committing the child applies its
   * overrides to THIS lane (not the base), so the parent lane can
   * choose to commit or abort the combined set.
   *
   * @param priority - The child lane's priority (defaults to parent's).
   * @returns A new child Lane.
   */
  fork(priority) {
    if (this.status !== "active") {
      throw new Error(`Cannot fork a ${this.status} lane`);
    }
    return new _Lane(priority ?? this.priority, this);
  }
  // ── Private ──────────────────────────────────────────────────────
  /**
   * Recomputes a computed node using this lane's pulse values.
   *
   * Temporarily activates this lane so that any pulse.get() calls
   * within the computation read from the lane's overrides.
   */
  recompute(node) {
    setActiveLane(this);
    const prevObserver = activeObserver;
    setObserver(node);
    let value;
    try {
      value = node.compute();
    } finally {
      setObserver(prevObserver);
      setActiveLane(null);
    }
    return value;
  }
  /**
   * Marks all downstream computed nodes as dirty within this lane.
   *
   * Walks the observer graph starting from the given pulse to find
   * all computed nodes that transitively depend on it.
   */
  invalidateDownstream(pulse) {
    const visited = /* @__PURE__ */ new Set();
    const walk = (observers) => {
      for (const obs of observers) {
        if (visited.has(obs)) continue;
        visited.add(obs);
        if ("compute" in obs) {
          this.dirtyComputeds.add(obs);
        }
        if ("dispose" in obs && !("compute" in obs)) {
          this.pendingEffects.push(obs);
        }
        if (obs.observers && obs.observers.length > 0) {
          walk(obs.observers);
        }
      }
    };
    walk(pulse.observers);
  }
  /**
   * Releases all internal state after commit or abort.
   */
  cleanup() {
    this.pulseOverrides.clear();
    this.computedCache.clear();
    this.dirtyComputeds.clear();
    this.pendingEffects.length = 0;
  }
};
var laneStack = [];
var activeLane = null;
function setActiveLane(lane) {
  if (lane === null) {
    laneStack.pop();
    activeLane = laneStack[laneStack.length - 1] ?? null;
  } else {
    laneStack.push(lane);
    activeLane = lane;
  }
}
function forkLane(priority = "transition") {
  return new Lane(priority, activeLane);
}
function transition(fn) {
  const lane = forkLane("transition");
  lane.run(fn);
  lane.commit();
}
function speculate(fn, priority = "transition") {
  const lane = forkLane(priority);
  lane.run(fn);
  return lane;
}

// src/react-hooks.ts
import "react";
import { useRef, useState, useEffect, useMemo, useCallback } from "react";
function usePulse(pulse) {
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
function useComputed(fn) {
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
function useObserver(render) {
  const [, forceUpdate] = useState(0);
  const effectRef = useRef(null);
  if (!effectRef.current) {
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
  const effect = effectRef.current;
  const prevObserver = activeObserver;
  setObserver(effect);
  let result = null;
  try {
    result = render();
  } finally {
    setObserver(prevObserver);
  }
  return result;
}
function useEffectPulse(fn) {
  useEffect(() => {
    const effect = new EffectNode(fn);
    return () => effect.dispose();
  }, []);
}
function useScope() {
  const scopeRef = useRef(null);
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
  return scopeRef.current;
}
function useLaneXTransition() {
  const [isPending, setIsPending] = useState(false);
  const laneRef = useRef(null);
  const startTransition = useCallback((fn) => {
    if (laneRef.current && laneRef.current.status === "active") {
      laneRef.current.abort();
    }
    setIsPending(true);
    const lane = forkLane("transition");
    laneRef.current = lane;
    lane.run(fn);
    Promise.resolve().then(() => {
      if (laneRef.current === lane && lane.status === "active") {
        lane.commit();
        setIsPending(false);
        laneRef.current = null;
      }
    });
  }, []);
  useEffect(() => {
    return () => {
      if (laneRef.current && laneRef.current.status === "active") {
        laneRef.current.abort();
      }
    };
  }, []);
  return [isPending, startTransition];
}
function useLane(priority = "transition") {
  const laneRef = useRef(null);
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
  return laneRef.current;
}
export {
  ComputedNode,
  DISPOSE,
  ERROR,
  EffectNode,
  GraphBridge,
  Lane,
  LaneTypes,
  NodeFlags,
  PulseNode,
  RemoteComputed,
  RemotePulse,
  Scope,
  TRANSACTION,
  activeLane,
  activeObserver,
  activeScope,
  connectWorker,
  createScope,
  createWorkerBridge,
  defineEffect,
  epoch,
  forkLane,
  onCleanup,
  perform,
  schedule,
  setObserver,
  speculate,
  tick,
  transition,
  useComputed,
  useEffectPulse,
  useLane,
  useObserver,
  usePulse,
  useScope,
  useLaneXTransition
};
