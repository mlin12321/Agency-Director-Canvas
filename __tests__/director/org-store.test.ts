import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { NodeHealth, OrgEvent } from "#/api/director/types";
import { git } from "../../director/blackboard/git.mjs";
import { buildFixtureNodes } from "../../director/org/fixture.mjs";
import {
  createOrgBoard,
  loadOrg,
  ORG_REF,
  saveOrg,
} from "../../director/org/org-persistence.mjs";
import {
  emptyHealthCounts,
  NODE_HEALTHS,
  OrgStore,
  OrgStoreError,
  type OrgNodeInput,
} from "../../director/org/org-store.mjs";

function input(
  id: string,
  parentId: string | null,
  health: NodeHealth = "converging",
): OrgNodeInput {
  return {
    id,
    parentId,
    title: id,
    boundary: { path: id, writable: [`${id}/**`], readonly: [] },
    isolation: "worktree",
    worktreePath: `.worktrees/${id}`,
    branch: `agents/${id}`,
    agents: [],
    health,
    specSummary: "",
  };
}

/**
 * root
 * ├── a (needs_attention)
 * │   ├── a1 (done)
 * │   └── a2 (collision)
 * └── b (converging)
 */
function buildTree() {
  const store = new OrgStore();
  store.upsert(input("root", null));
  store.upsert(input("a", "root", "needs_attention"));
  store.upsert(input("b", "root"));
  store.upsert(input("a1", "a", "done"));
  store.upsert(input("a2", "a", "collision"));
  return store;
}

function record(store: OrgStore, focusId: string) {
  const events: OrgEvent[] = [];
  const unsubscribe = store.subscribe(focusId, (event) => events.push(event));
  return { events, unsubscribe };
}

function summarize(events: OrgEvent[]) {
  return events.map((event) => {
    if (event.type === "node_upsert") return `upsert:${event.node.id}`;
    if (event.type === "node_removed") return `removed:${event.id}`;
    return event.type;
  });
}

describe("OrgStore", () => {
  it("derives child lists, ancestors and subtree health rollups", () => {
    const store = buildTree();

    expect(store.rootId).toBe("root");
    expect(store.get("root")?.childIds).toEqual(["a", "b"]);
    expect(store.children("a").map((node) => node.id)).toEqual(["a1", "a2"]);
    expect(store.ancestors("a2").map((node) => node.id)).toEqual(["root", "a"]);
    expect(store.get("a")?.descendantCounts).toEqual({
      ...emptyHealthCounts(),
      done: 1,
      collision: 1,
    });
    expect(store.get("root")?.descendantCounts).toEqual({
      ...emptyHealthCounts(),
      needs_attention: 1,
      converging: 1,
      done: 1,
      collision: 1,
    });
    expect(store.get("a1")?.descendantCounts).toEqual(emptyHealthCounts());
  });

  it("snapshots the focus, its ancestors and its direct reports only", () => {
    const store = buildTree();

    expect(store.snapshot("a")?.nodes.map((node) => node.id)).toEqual([
      "root",
      "a",
      "a1",
      "a2",
    ]);
    expect(store.snapshot("root")?.nodes.map((node) => node.id)).toEqual([
      "root",
      "a",
      "b",
    ]);
    expect(store.snapshot("missing")).toBeNull();
  });

  it("propagates a health change up the rollups and announces each changed ancestor", () => {
    const store = buildTree();
    const { events } = record(store, "a");

    store.upsert(input("a1", "a", "needs_attention"));

    expect(summarize(events)).toEqual(["upsert:a1", "upsert:a", "upsert:root"]);
    expect(store.get("a")?.descendantCounts.done).toBe(0);
    expect(store.get("a")?.descendantCounts.needs_attention).toBe(1);
    expect(store.get("root")?.descendantCounts.needs_attention).toBe(2);
  });

  it("does not announce ancestors when an update leaves the rollups unchanged", () => {
    const store = buildTree();
    const { events } = record(store, "a");

    store.upsert({ ...input("a1", "a", "done"), title: "renamed" });

    expect(summarize(events)).toEqual(["upsert:a1"]);
    expect(store.get("a1")?.title).toBe("renamed");
  });

  it("keeps a node's children and rollup when the node itself is updated", () => {
    const store = buildTree();

    store.upsert({ ...input("a", "root", "done"), title: "renamed" });

    expect(store.get("a")?.childIds).toEqual(["a1", "a2"]);
    expect(store.get("a")?.descendantCounts).toEqual({
      ...emptyHealthCounts(),
      done: 1,
      collision: 1,
    });
    expect(store.get("root")?.descendantCounts.needs_attention).toBe(0);
    expect(store.get("root")?.descendantCounts.done).toBe(2);
  });

  it("only delivers events for nodes the subscriber's snapshot contains", () => {
    const store = buildTree();
    const atRoot = record(store, "root");
    const atB = record(store, "b");

    // a1 is a grandchild of root and unrelated to b.
    store.upsert({ ...input("a1", "a", "done"), title: "renamed" });
    expect(atRoot.events).toEqual([]);
    expect(atB.events).toEqual([]);

    // A health change two levels down still reaches root through rollups.
    store.upsert(input("a1", "a", "pruned"));
    expect(summarize(atRoot.events)).toEqual(["upsert:a", "upsert:root"]);
    expect(summarize(atB.events)).toEqual(["upsert:root"]);
  });

  it("announces a new child and its parent's updated child list", () => {
    const store = buildTree();
    const { events } = record(store, "b");

    store.upsert(input("b1", "b", "converging"));

    expect(summarize(events)).toEqual(["upsert:b1", "upsert:b", "upsert:root"]);
    const parent = events.find(
      (event) => event.type === "node_upsert" && event.node.id === "b",
    );
    expect(parent).toMatchObject({ node: { childIds: ["b1"] } });
  });

  it("removes a whole subtree, leaves first, and fixes the rollups above it", () => {
    const store = buildTree();
    const atRoot = record(store, "root");
    const insideSubtree = record(store, "a1");

    expect(store.remove("a")).toBe(true);

    expect(store.size).toBe(2);
    expect(store.get("a1")).toBeUndefined();
    expect(store.get("root")?.childIds).toEqual(["b"]);
    expect(store.get("root")?.descendantCounts).toEqual({
      ...emptyHealthCounts(),
      converging: 1,
    });
    expect(summarize(atRoot.events)).toEqual(["removed:a", "upsert:root"]);
    // A viewer focused inside the removed subtree learns its focus is gone.
    expect(summarize(insideSubtree.events)).toEqual([
      "removed:a1",
      "removed:a",
    ]);
    expect(store.remove("a")).toBe(false);
  });

  it("can remove the root and accept a new one", () => {
    const store = buildTree();

    store.remove("root");

    expect(store.size).toBe(0);
    expect(store.rootId).toBeNull();
    expect(store.upsert(input("fresh", null)).id).toBe("fresh");
  });

  it("stops delivering after unsubscribe", () => {
    const store = buildTree();
    const { events, unsubscribe } = record(store, "root");

    unsubscribe();
    store.upsert(input("b", "root", "done"));

    expect(events).toEqual([]);
  });

  it.each([
    ["a second root", () => buildTree().upsert(input("other", null))],
    ["an unknown parent", () => buildTree().upsert(input("x", "missing"))],
    ["a parent change", () => buildTree().upsert(input("a1", "b"))],
  ])("rejects %s", (_label, act) => {
    expect(act).toThrow(OrgStoreError);
  });

  it("does not let callers mutate stored nodes through the input object", () => {
    const store = new OrgStore();
    const root = input("root", null);

    store.upsert(root);
    root.boundary.writable.push("everything/**");

    expect(store.get("root")?.boundary.writable).toEqual(["root/**"]);
  });

  describe("replaceAll", () => {
    it("loads nodes given in any order and computes rollups", () => {
      const store = new OrgStore();

      store.replaceAll([
        input("a1", "a", "done"),
        input("a", "root", "collision"),
        input("root", null),
      ]);

      expect(store.all().map((node) => node.id)).toEqual(["root", "a", "a1"]);
      expect(store.get("root")?.descendantCounts).toEqual({
        ...emptyHealthCounts(),
        collision: 1,
        done: 1,
      });
    });

    it.each([
      ["duplicate ids", [input("root", null), input("root", null)]],
      ["two roots", [input("root", null), input("other", null)]],
      ["a missing parent", [input("root", null), input("x", "missing")]],
      ["no root", [input("a", "b"), input("b", "a")]],
      [
        "a cycle beside a valid root",
        [input("root", null), input("a", "b"), input("b", "a")],
      ],
    ])("rejects %s and keeps the existing tree", (_label, nodes) => {
      const store = buildTree();

      expect(() => store.replaceAll(nodes)).toThrow(OrgStoreError);
      expect(store.size).toBe(5);
      expect(store.rootId).toBe("root");
    });

    it("accepts an empty tree", () => {
      const store = buildTree();

      store.replaceAll([]);

      expect(store.size).toBe(0);
      expect(store.rootId).toBeNull();
    });
  });

  describe("fixture", () => {
    it("builds one consistent tree whose root rollup counts every other node", () => {
      const store = new OrgStore();

      store.replaceAll(buildFixtureNodes());

      const root = store.get("root");
      const total = NODE_HEALTHS.reduce(
        (sum, health) => sum + (root?.descendantCounts[health] ?? 0),
        0,
      );
      expect(store.size).toBeGreaterThanOrEqual(400);
      expect(total).toBe(store.size - 1);
      expect(store.children("root")).toHaveLength(6);
    });

    it("is deterministic", () => {
      expect(buildFixtureNodes()).toEqual(buildFixtureNodes());
    });
  });

  describe("persistence", () => {
    it("round-trips the tree through a hidden git ref", async () => {
      const repoDir = await mkdtemp(join(tmpdir(), "org-persist-"));
      try {
        await git(repoDir, ["init", "--quiet"]);
        await writeFile(join(repoDir, "README.md"), "hi\n");
        const board = createOrgBoard(repoDir);
        const original = buildTree();

        expect(await loadOrg(board, new OrgStore())).toBe(false);
        await saveOrg(board, original);
        const head = await board.head();
        await saveOrg(board, original);
        const restored = new OrgStore();
        const found = await loadOrg(board, restored);

        expect(found).toBe(true);
        expect(restored.all()).toEqual(original.all());
        // Saving an unchanged tree must not grow history.
        expect(await board.head()).toBe(head);
        expect(await git(repoDir, ["status", "--porcelain"])).toBe(
          "?? README.md\n",
        );
        expect(
          (await git(repoDir, ["for-each-ref", "--format=%(refname)"])).trim(),
        ).toBe(ORG_REF);
      } finally {
        await rm(repoDir, { recursive: true, force: true });
      }
    });

    it("refuses a saved tree in an unknown format", async () => {
      const repoDir = await mkdtemp(join(tmpdir(), "org-persist-"));
      try {
        await git(repoDir, ["init", "--quiet"]);
        const board = createOrgBoard(repoDir);
        await board.write("", "org.json", JSON.stringify({ version: 99 }));

        await expect(loadOrg(board, new OrgStore())).rejects.toThrow(
          /Unrecognized/,
        );
      } finally {
        await rm(repoDir, { recursive: true, force: true });
      }
    });
  });
});
