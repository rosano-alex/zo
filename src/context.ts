import type { Node } from "./node";

export let activeObserver: Node | null = null;

export function setObserver(node: Node | null) {
  activeObserver = node;
}
