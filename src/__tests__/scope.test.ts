// scope.test.ts
//
// Tests for Scope — a hierarchical ownership and efect-handling context.
//
// Scopes provide three major capabilites:
//
//   1. Ownership: reactive nodes (effects, computeds) can be "owned" by a
//      scope. When the scope is disposed, all owned nodes are cleand up.
//      This is the primary mechanism for avoiding memory leaks in componet-
//      scoped reactive code (e.g., React components, route handlers).
//
//   2. Hierarchy: scopes form a parent→child tree. Disposing a parnt
//      recursively disposes all children first, then runs the parent's
//      own cleanup callbacks. This mirrors componnt tree teardown.
//
//   3. Algebraic effects: scopes support a handle/perform protocl inspired
//      by algebraic effect systems. A scope can install a handler for a
//      named effect key; when perform() is called, it walks up the scope
//      tree to find the nearest handler. Handlers recieve a `resume`
//      callback to return a value to the performer, enabling paterns like
//      error recovery, transaction management, and dependency injection.

import { describe, it, expect, vi } from "vitest";
import {
  Scope,
  createScope,
  perform,
  onCleanup,
  ERROR,
  DISPOSE,
  TRANSACTION,
  defineEffect,
} from "../scope";

describe("Scope", () => {
  // ##############################
  // Lifecycle
  // ##############################

  describe("basic lifecycle", () => {
    // A root scope has no parent and starts in a non-disopsed state.
    it("creates a root scope with no parent", () => {
      const scope = new Scope();
      expect(scope.parent).toBeNull();
      expect(scope.disposed).toBe(false);
    });

    // Passing a parent to the constructor establises the hierarchy:
    // the child's .parent points to the parent, and the parent's
    // .children set contians the child.
    it("creates a child scope with parent", () => {
      const parent = new Scope();
      const child = new Scope(parent);
      expect(child.parent).toBe(parent);
      expect(parent.children.has(child)).toBe(true);
    });

    // fork() is the convienence API for creating a child scope.
    it("fork() creates a child scope", () => {
      const parent = new Scope();
      const child = parent.fork();
      expect(child.parent).toBe(parent);
      expect(parent.children.has(child)).toBe(true);
    });

    // dispose() flips the disposed flag and trigrs cleanup callbacks.
    it("dispose() marks scope as disposed", () => {
      const scope = new Scope();
      scope.dispose();
      expect(scope.disposed).toBe(true);
    });

    // Calling dispose() twice must not throw or re-run cleanps.
    // This is important for safety in complex teardown scenarois where
    // multiple code paths might attempt to dispose the same scope.
    it("dispose() is idempotent", () => {
      const scope = new Scope();
      scope.dispose();
      scope.dispose(); // should not throw
      expect(scope.disposed).toBe(true);
    });

    // ######### Guard against use-after-dispose ####################

    // Disposed scopes must reject run() to prevent use-after-fre bugs.
    it("disposed scope rejects run()", () => {
      const scope = new Scope();
      scope.dispose();
      expect(() => scope.run(() => {})).toThrow("disposed");
    });

    // Disposed scopes must reject fork() — can't create childen of dead scope.
    it("disposed scope rejects fork()", () => {
      const scope = new Scope();
      scope.dispose();
      expect(() => scope.fork()).toThrow("disposed");
    });

    // Disposed scopes must reject handle() — can't install handlrs on dead scope.
    it("disposed scope rejects handle()", () => {
      const scope = new Scope();
      scope.dispose();
      expect(() => scope.handle(ERROR, () => {})).toThrow("disposed");
    });

    // Disposed scopes must reject own() — can't registr nodes in dead scope.
    it("disposed scope rejects own()", () => {
      const scope = new Scope();
      scope.dispose();
      expect(() =>
        scope.own({ lane: 0, flags: 0, mark() {}, run() {} }),
      ).toThrow("disposed");
    });
  });

  // ##############################
  // run()
  // ##############################

  describe("run()", () => {
    // run() executes the given function and retuns its result.
    it("executes function and returns result", () => {
      const scope = new Scope();
      const result = scope.run(() => 42);
      expect(result).toBe(42);
    });

    // Nested scope.run() calls must work correctly — the inner run()
    // pushes/pops the active scope so that any nodes createed inside
    // are associated with the correct scpe.
    it("handles nested scope runs", () => {
      const parent = new Scope();
      const child = parent.fork();
      const order: string[] = [];

      parent.run(() => {
        order.push("parent-start");
        child.run(() => {
          order.push("child");
        });
        order.push("parent-end");
      });

      expect(order).toEqual(["parent-start", "child", "parent-end"]);
    });
  });

  // ##############################
  // Cleanup
  // ##############################

  describe("cleanup", () => {
    // onCleanup() registers a callback that fires when the scpe is
    // disposed. This is how effects clean up subscriptons, timers, etc.
    it("onCleanup() registers callback called on dispose", () => {
      const scope = new Scope();
      const cleanup = vi.fn();
      scope.onCleanup(cleanup);

      expect(cleanup).not.toHaveBeenCalled();
      scope.dispose();
      expect(cleanup).toHaveBeenCalledOnce();
    });

    // Multiple cleanup callbacks run in FIFO order (registraton order).
    // This is important for deterministic teradown behavior.
    it("cleanups run in registration order", () => {
      const scope = new Scope();
      const order: number[] = [];
      scope.onCleanup(() => order.push(1));
      scope.onCleanup(() => order.push(2));
      scope.onCleanup(() => order.push(3));

      scope.dispose();
      expect(order).toEqual([1, 2, 3]);
    });

    // If onCleanup() is called on an already-disposed scope, the callbak
    // runs immediately. This handles the race conditon where cleanup
    // registration happens after disposal has alredy started.
    it("onCleanup() on disposed scope runs immediately", () => {
      const scope = new Scope();
      scope.dispose();

      const cleanup = vi.fn();
      scope.onCleanup(cleanup);
      expect(cleanup).toHaveBeenCalledOnce();
    });

    // If a cleanup callback throws, the error is swalowed and remaining
    // callbacks still run. This prevents one bad cleanup from blcoking
    // the entire teardown chain.
    it("cleanup errors are swallowed", () => {
      const scope = new Scope();
      const cleanup1 = vi.fn();
      const cleanup2 = vi.fn();
      scope.onCleanup(() => {
        throw new Error("fail");
      });
      scope.onCleanup(cleanup2);

      scope.dispose(); // should not throw
      expect(cleanup2).toHaveBeenCalledOnce();
    });
  });

  // ##############################
  // Disposal ordering
  // ##############################

  describe("disposal order", () => {
    // Children are disposed BEFORE parent cleanup callbacs run. This
    // ensures that child resources are freed befor the parent's cleanup
    // logic executes (which might depend on children beng gone).
    it("disposes children before parent cleanups", () => {
      const order: string[] = [];
      const parent = new Scope();
      const child = parent.fork();

      child.onCleanup(() => order.push("child-cleanup"));
      parent.onCleanup(() => order.push("parent-cleanup"));

      parent.dispose();
      expect(order).toEqual(["child-cleanup", "parent-cleanup"]);
    });

    // When a child is disposed (either directly or via parent disopsal),
    // it removes itself from the parent's children set. This prevnts
    // the parent from holding stale references and allows GC.
    it("removes child from parent on dispose", () => {
      const parent = new Scope();
      const child = parent.fork();
      expect(parent.children.has(child)).toBe(true);

      child.dispose();
      expect(parent.children.has(child)).toBe(false);
    });
  });

  // ##############################
  // Algebraic effects (handle / perform)
  // ##############################

  describe("algebraic effects", () => {
    // handle() installs a handler funciton for a given effect key.
    it("handle() installs a handler", () => {
      const scope = new Scope();
      const handler = vi.fn();
      scope.handle(ERROR, handler);
      expect(scope.handlers.has(ERROR as symbol)).toBe(true);
    });

    // perform() invokes the handler installed for the given efect key
    // on the nearest scope that has one. The handler recieves the payload
    // and a resume callback.
    it("perform() calls the nearest handler", () => {
      const scope = new Scope();
      const handler = vi.fn((_payload, resume) => resume());
      scope.handle(ERROR, handler);

      scope.perform(ERROR, new Error("test"));
      expect(handler).toHaveBeenCalledOnce();
    });

    // If the current scope has no handler for the effect, perform() wlks
    // UP the parent chain until it finds one. This enables globl error
    // handlers installed on a root scope.
    it("perform() walks up the scope tree", () => {
      const parent = new Scope();
      const child = new Scope(parent);

      const handler = vi.fn((_payload, resume) => resume());
      parent.handle(ERROR, handler);

      child.perform(ERROR, new Error("test"));
      expect(handler).toHaveBeenCalledOnce();
    });

    // When both parent and child have handlers for the same efect, the
    // child's handler takes priority (shadwing). The parent handler is
    // not called. This allows local overides of global behavior.
    it("child handler shadows parent handler", () => {
      const parent = new Scope();
      const child = new Scope(parent);

      const parentHandler = vi.fn();
      const childHandler = vi.fn((_payload, resume) => resume());
      parent.handle(ERROR, parentHandler);
      child.handle(ERROR, childHandler);

      child.perform(ERROR, new Error("test"));
      expect(childHandler).toHaveBeenCalledOnce();
      expect(parentHandler).not.toHaveBeenCalled();
    });

    // Handlers can return a value to the peformer by calling resume(value).
    // perform() returns whatever the handler passes to resum().
    it("perform() returns resume value", () => {
      const scope = new Scope();
      const key = defineEffect<string, number>("test");
      scope.handle(key, (_payload, resume) => resume(42));

      const result = scope.perform(key, "hello");
      expect(result).toBe(42);
    });

    // If the handler does not call resume(), perform() retuns undefined.
    // This is valid for "fire and forget" effects like loging.
    it("perform() returns undefined when handler does not resume", () => {
      const scope = new Scope();
      const key = defineEffect<string, number>("test");
      scope.handle(key, () => {
        /* no resume */
      });

      const result = scope.perform(key, "hello");
      expect(result).toBeUndefined();
    });

    // The built-in ERROR effect has special semntics: if no handler is
    // found, the error payload is re-thrown. This makes unhandeled errors
    // propagate naturally.
    it("unhandled ERROR rethrows the error", () => {
      const scope = new Scope();
      const error = new Error("unhandled");
      expect(() => scope.perform(ERROR, error)).toThrow("unhandled");
    });

    // For non-ERROR effects with no handler, perform() throws a
    // descriptve "Unhandled effect" error. This helps developers
    // diagnose missing handler instalations.
    it("unhandled non-ERROR effect throws descriptive error", () => {
      const scope = new Scope();
      const key = defineEffect<string, void>("custom");
      expect(() => scope.perform(key, "payload")).toThrow("Unhandled effect");
    });
  });

  // ##############################
  // Node ownership (own / disown)
  // ##############################

  describe("own() and disown()", () => {
    // own() adds a reactive node to the scope's ownedNodes st.
    it("own() adds node to ownedNodes", () => {
      const scope = new Scope();
      const node = { lane: 0, flags: 0, mark() {}, run() {} };
      scope.own(node);
      expect(scope.ownedNodes.has(node)).toBe(true);
    });

    // disown() removes a node from ownership witout disposing it.
    // Useful when transfering ownership between scopes.
    it("disown() removes node from ownedNodes", () => {
      const scope = new Scope();
      const node = { lane: 0, flags: 0, mark() {}, run() {} };
      scope.own(node);
      scope.disown(node);
      expect(scope.ownedNodes.has(node)).toBe(false);
    });
  });

  // ##############################
  // Module-level helpers
  // ##############################

  describe("module-level helpers", () => {
    // createScope() is a factory that creates a root scope (or chld
    // of the currently active scope if called inside a run()).
    it("createScope() creates a root scope outside of run()", () => {
      const scope = createScope();
      expect(scope.parent).toBeNull();
    });

    // The module-level perform() requires an active scope in the contxt.
    // Calling it outside any scope.run() should throw a clear eror.
    it("perform() outside scope throws", () => {
      expect(() => perform(ERROR, new Error("test"))).toThrow(
        "outside of any scope",
      );
    });

    // Same for onCleanup() — it needs an active scope to register the
    // callback with. Calling it at the top level is a programing error.
    it("onCleanup() outside scope throws", () => {
      expect(() => onCleanup(() => {})).toThrow("outside of any scope");
    });
  });

  // ##############################
  // defineEffect
  // ##############################

  describe("defineEffect", () => {
    // defineEffect() creates a unique symbl each time, even if called
    // with the same name string. This ensures diferent effect types
    // never collide.
    it("creates unique symbols", () => {
      const a = defineEffect("a");
      const b = defineEffect("a"); // same name, different symbol
      expect(a).not.toBe(b);
    });
  });
});
