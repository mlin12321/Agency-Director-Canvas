/**
 * In-memory org tree. The store owns the two derived fields on every node
 * (`childIds` and `descendantCounts`) and is the only thing that emits
 * `OrgEvent`s, so every subscriber sees one consistent tree.
 *
 * @import { HealthCounts, NodeHealth, NodeId, OrgEvent, OrgNode } from "../../src/api/director/types.ts"
 */

/** @type {readonly NodeHealth[]} */
export const NODE_HEALTHS = Object.freeze([
  "converging",
  "negotiating_split",
  "collision",
  "needs_attention",
  "pruned",
  "done",
]);

/** @returns {HealthCounts} */
export function emptyHealthCounts() {
  return /** @type {HealthCounts} */ (
    Object.fromEntries(NODE_HEALTHS.map((health) => [health, 0]))
  );
}

/**
 * What a caller supplies; the store fills in the derived fields.
 * @typedef {Omit<OrgNode, "childIds" | "descendantCounts">} OrgNodeInput
 * @typedef {(event: OrgEvent) => void} OrgListener
 * @typedef {{ event: OrgEvent, id: NodeId, parentId: NodeId | null }} Emission
 */

export class OrgStoreError extends Error {
  constructor(message) {
    super(message);
    this.name = "OrgStoreError";
  }
}

/** @param {HealthCounts} a @param {HealthCounts} b */
function sameCounts(a, b) {
  return NODE_HEALTHS.every((health) => a[health] === b[health]);
}

export class OrgStore {
  /** @type {Map<NodeId, OrgNode>} */
  #nodes = new Map();

  /** @type {NodeId | null} */
  #rootId = null;

  /** @type {Set<(emission: Emission) => void>} */
  #listeners = new Set();

  get rootId() {
    return this.#rootId;
  }

  get size() {
    return this.#nodes.size;
  }

  /** @param {NodeId} id @returns {OrgNode | undefined} */
  get(id) {
    return this.#nodes.get(id);
  }

  /** @param {NodeId} id @returns {OrgNode[]} */
  children(id) {
    const node = this.#nodes.get(id);
    if (!node) return [];
    return node.childIds.flatMap((childId) => {
      const child = this.#nodes.get(childId);
      return child ? [child] : [];
    });
  }

  /**
   * @param {NodeId} id
   * @returns {OrgNode[]} Root first, excluding the node itself.
   */
  ancestors(id) {
    /** @type {OrgNode[]} */
    const chain = [];
    let parentId = this.#nodes.get(id)?.parentId ?? null;
    while (parentId !== null) {
      const parent = this.#nodes.get(parentId);
      if (!parent) break;
      chain.unshift(parent);
      parentId = parent.parentId;
    }
    return chain;
  }

  /** @returns {OrgNode[]} Every node, parents before children. */
  all() {
    /** @type {OrgNode[]} */
    const ordered = [];
    const queue = this.#rootId === null ? [] : [this.#rootId];
    for (let index = 0; index < queue.length; index += 1) {
      const node = this.#nodes.get(queue[index]);
      if (node) {
        ordered.push(node);
        queue.push(...node.childIds);
      }
    }
    return ordered;
  }

  /**
   * Insert a node or update an existing one. A node cannot move to a
   * different parent; remove it and insert it again instead.
   *
   * @param {OrgNodeInput} input
   * @returns {OrgNode}
   */
  upsert(input) {
    const existing = this.#nodes.get(input.id);
    if (existing) {
      if (existing.parentId !== input.parentId) {
        throw new OrgStoreError(
          `Node ${input.id} cannot change parent from ${existing.parentId} to ${input.parentId}`,
        );
      }
    } else if (input.parentId === null) {
      if (this.#rootId !== null) {
        throw new OrgStoreError(
          `The tree already has a root (${this.#rootId}); ${input.id} needs a parent`,
        );
      }
    } else if (!this.#nodes.has(input.parentId)) {
      throw new OrgStoreError(
        `Parent ${input.parentId} of node ${input.id} does not exist`,
      );
    }

    /** @type {OrgNode} */
    const node = {
      ...structuredClone(input),
      childIds: existing ? existing.childIds : [],
      descendantCounts: existing
        ? existing.descendantCounts
        : emptyHealthCounts(),
    };
    this.#nodes.set(node.id, node);

    if (!existing) {
      if (node.parentId === null) {
        this.#rootId = node.id;
      } else {
        const parent = /** @type {OrgNode} */ (this.#nodes.get(node.parentId));
        this.#nodes.set(parent.id, {
          ...parent,
          childIds: [...parent.childIds, node.id],
        });
      }
    }

    this.#emit({ type: "node_upsert", node }, node.id, node.parentId);
    // A new child changes its parent's `childIds`, so the parent is always
    // re-announced on insert; above that, only changed rollups are.
    this.#refreshAncestors(node.parentId, !existing);
    return node;
  }

  /**
   * Remove a node and everything below it.
   *
   * @param {NodeId} id
   * @returns {boolean} Whether the node existed.
   */
  remove(id) {
    const node = this.#nodes.get(id);
    if (!node) return false;

    /** @type {OrgNode[]} */
    const doomed = [];
    const stack = [node];
    while (stack.length > 0) {
      const current = /** @type {OrgNode} */ (stack.pop());
      doomed.push(current);
      stack.push(...this.children(current.id));
    }
    // Leaves first, so a subscriber never holds a child of a missing parent.
    doomed.reverse();

    if (node.parentId === null) {
      this.#rootId = null;
    } else {
      const parent = this.#nodes.get(node.parentId);
      if (parent) {
        this.#nodes.set(parent.id, {
          ...parent,
          childIds: parent.childIds.filter((childId) => childId !== id),
        });
      }
    }
    // Announce while the doomed nodes are still resolvable, so a subscriber
    // focused inside the removed subtree can still be matched.
    doomed.forEach((gone) => {
      this.#emit({ type: "node_removed", id: gone.id }, gone.id, gone.parentId);
    });
    doomed.forEach((gone) => this.#nodes.delete(gone.id));

    this.#refreshAncestors(node.parentId, true);
    return true;
  }

  /**
   * Replace the whole tree without emitting events. Used when loading
   * persisted state or a fixture. Leaves the store untouched if the input
   * is not one well-formed tree.
   *
   * @param {OrgNodeInput[]} inputs In any order.
   */
  replaceAll(inputs) {
    /** @type {Map<NodeId, OrgNode>} */
    const nodes = new Map();
    inputs.forEach((input) => {
      if (nodes.has(input.id)) {
        throw new OrgStoreError(`Duplicate node id ${input.id}`);
      }
      nodes.set(input.id, {
        ...structuredClone(input),
        childIds: [],
        descendantCounts: emptyHealthCounts(),
      });
    });

    /** @type {NodeId | null} */
    let rootId = null;
    nodes.forEach((node) => {
      if (node.parentId === null) {
        if (rootId !== null) {
          throw new OrgStoreError(
            `More than one root node (${rootId}, ${node.id})`,
          );
        }
        rootId = node.id;
        return;
      }
      const parent = nodes.get(node.parentId);
      if (!parent) {
        throw new OrgStoreError(
          `Parent ${node.parentId} of node ${node.id} does not exist`,
        );
      }
      parent.childIds.push(node.id);
    });
    if (nodes.size > 0 && rootId === null) {
      throw new OrgStoreError("The tree has no root node");
    }

    const previous = { nodes: this.#nodes, rootId: this.#rootId };
    this.#nodes = nodes;
    this.#rootId = rootId;

    const ordered = this.all();
    if (ordered.length !== nodes.size) {
      this.#nodes = previous.nodes;
      this.#rootId = previous.rootId;
      throw new OrgStoreError("The tree contains a cycle");
    }
    for (let index = ordered.length - 1; index >= 0; index -= 1) {
      ordered[index].descendantCounts = this.#rollup(ordered[index]);
    }
  }

  /**
   * The focused node, its ancestors and its direct reports.
   *
   * @param {NodeId} focusId
   * @returns {Extract<OrgEvent, { type: "snapshot" }> | null}
   */
  snapshot(focusId) {
    const focus = this.#nodes.get(focusId);
    if (!focus) return null;
    return {
      type: "snapshot",
      focusId,
      nodes: [...this.ancestors(focusId), focus, ...this.children(focusId)],
    };
  }

  /**
   * Receive events for the nodes a snapshot of `focusId` contains.
   *
   * @param {NodeId} focusId
   * @param {OrgListener} listener
   * @returns {() => void} Unsubscribe.
   */
  subscribe(focusId, listener) {
    /** @param {Emission} emission */
    const filtered = (emission) => {
      if (this.#isVisibleFrom(focusId, emission.id, emission.parentId)) {
        listener(emission.event);
      }
    };
    this.#listeners.add(filtered);
    return () => {
      this.#listeners.delete(filtered);
    };
  }

  /**
   * @param {NodeId} focusId
   * @param {NodeId} id
   * @param {NodeId | null} parentId
   */
  #isVisibleFrom(focusId, id, parentId) {
    if (id === focusId || parentId === focusId) return true;
    return this.ancestors(focusId).some((ancestor) => ancestor.id === id);
  }

  /** @param {OrgNode} node @returns {HealthCounts} */
  #rollup(node) {
    const counts = emptyHealthCounts();
    this.children(node.id).forEach((child) => {
      counts[child.health] += 1;
      NODE_HEALTHS.forEach((health) => {
        counts[health] += child.descendantCounts[health];
      });
    });
    return counts;
  }

  /**
   * Recompute rollups from `startId` up to the root, announcing every node
   * whose rollup changed.
   *
   * @param {NodeId | null} startId
   * @param {boolean} alwaysAnnounceFirst
   */
  #refreshAncestors(startId, alwaysAnnounceFirst) {
    let currentId = startId;
    let first = true;
    while (currentId !== null) {
      const current = this.#nodes.get(currentId);
      if (!current) return;
      const counts = this.#rollup(current);
      const changed = !sameCounts(counts, current.descendantCounts);
      const announced = changed
        ? { ...current, descendantCounts: counts }
        : current;
      if (changed) this.#nodes.set(announced.id, announced);
      if (changed || (first && alwaysAnnounceFirst)) {
        this.#emit(
          { type: "node_upsert", node: announced },
          announced.id,
          announced.parentId,
        );
      }
      first = false;
      currentId = current.parentId;
    }
  }

  /**
   * @param {OrgEvent} event
   * @param {NodeId} id
   * @param {NodeId | null} parentId
   */
  #emit(event, id, parentId) {
    [...this.#listeners].forEach((listener) =>
      listener({ event, id, parentId }),
    );
  }
}
