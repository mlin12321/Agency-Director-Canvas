import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import type { NodeHealth, OrgEvent } from "#/api/director/types";
import { server as mswServer } from "#/mocks/node";
import { GitBlackboard } from "../../director/blackboard/git-blackboard.mjs";
import { git } from "../../director/blackboard/git.mjs";
import { OrgStore, type OrgNodeInput } from "../../director/org/org-store.mjs";
import { createDirectorServer } from "../../director/server.mjs";

// These tests talk to a real loopback server, so MSW must stay out of the way.
beforeAll(() => mswServer.close());
afterAll(() => mswServer.listen({ onUnhandledFrame: "bypass" }));

const KEY = "test-session-key";
const AUTH = { "X-Session-API-Key": KEY };

function input(
  id: string,
  parentId: string | null,
  health: NodeHealth = "converging",
  path = id,
): OrgNodeInput {
  return {
    id,
    parentId,
    title: id,
    boundary: { path, writable: [], readonly: [] },
    isolation: "shared",
    worktreePath: ".",
    branch: "main",
    agents: [],
    health,
    specSummary: "",
  };
}

let store: OrgStore;
let server: Server;
let base: string;
let repoDir: string | null = null;

async function start(options: {
  blackboard?: GitBlackboard | null;
  sessionApiKey?: string | null;
}) {
  server = createDirectorServer({ store, heartbeatMs: 20, ...options });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}/api/director`;
}

const pause = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

beforeEach(() => {
  store = new OrgStore();
  store.upsert(input("root", null, "converging", ""));
  store.upsert(input("auth", "root", "converging", "services/auth"));
  store.upsert(input("oauth", "auth", "done", "services/auth/oauth"));
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => {
    server.close(resolve);
  });
  if (repoDir) await rm(repoDir, { recursive: true, force: true });
  repoDir = null;
});

/** Reads server-sent events off a streaming response. */
async function openStream(url: string, headers: Record<string, string> = AUTH) {
  const controller = new AbortController();
  const response = await fetch(url, { headers, signal: controller.signal });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawHeartbeat = false;

  async function next(): Promise<OrgEvent> {
    for (;;) {
      const end = buffer.indexOf("\n\n");
      if (end !== -1) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice("data: ".length))
          .join("\n");
        if (data) return JSON.parse(data) as OrgEvent;
        if (frame.startsWith(":")) sawHeartbeat = true;
      } else {
        const { done, value } = await reader.read();
        if (done) throw new Error("stream ended");
        buffer += decoder.decode(value, { stream: true });
      }
    }
  }

  return {
    response,
    next,
    heartbeatSeen: () => sawHeartbeat,
    close: () => controller.abort(),
  };
}

function ids(event: OrgEvent) {
  return event.type === "snapshot" ? event.nodes.map((node) => node.id) : null;
}

describe("director server", () => {
  describe("routing and auth", () => {
    beforeEach(() => start({ sessionApiKey: KEY }));

    it("answers health without a key", async () => {
      const response = await fetch(`${base}/health`);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "ok", nodes: 3 });
    });

    it.each([
      ["no key", {}],
      ["a wrong key", { "X-Session-API-Key": "nope" }],
      [
        "a key of the right length but wrong value",
        { "X-Session-API-Key": "x".repeat(KEY.length) },
      ],
    ])("rejects %s on protected routes", async (_label, headers) => {
      const node = await fetch(`${base}/org/nodes/root`, { headers });
      const stream = await fetch(`${base}/org/tree-stream`, { headers });

      expect(node.status).toBe(401);
      expect(stream.status).toBe(401);
    });

    it("returns a node with its ancestors and children", async () => {
      const response = await fetch(`${base}/org/nodes/auth`, { headers: AUTH });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.node.id).toBe("auth");
      expect(body.ancestors.map((n: { id: string }) => n.id)).toEqual(["root"]);
      expect(body.children.map((n: { id: string }) => n.id)).toEqual(["oauth"]);
    });

    it("resolves node ids that need URL encoding", async () => {
      store.upsert(input("a/b c", "root"));

      const response = await fetch(
        `${base}/org/nodes/${encodeURIComponent("a/b c")}`,
        { headers: AUTH },
      );

      expect((await response.json()).node.id).toBe("a/b c");
    });

    it.each([
      ["an unknown node", "GET", "/org/nodes/missing", 404],
      ["an unknown route", "GET", "/nope", 404],
      ["a malformed escape", "GET", "/org/nodes/%E0%A4%A", 400],
      ["an unsupported method", "DELETE", "/org/nodes/root", 404],
      ["an unknown node action", "POST", "/org/nodes/root/explode", 404],
      ["a path below a known action", "POST", "/org/nodes/root/teach/x", 404],
      ["steer, which is not built yet", "POST", "/org/nodes/root/steer", 501],
      ["prune, which is not built yet", "POST", "/org/nodes/root/prune", 501],
    ])("answers %s with a JSON error", async (_label, method, path, status) => {
      const response = await fetch(`${base}${path}`, { method, headers: AUTH });

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: expect.any(String) });
    });

    it("does not serve paths outside its base prefix", async () => {
      const origin = new URL(base).origin;

      const sibling = await fetch(`${origin}/api/directory/health`);
      const root = await fetch(`${origin}/health`);

      expect(sibling.status).toBe(404);
      expect(root.status).toBe(404);
    });

    it("reports the blackboard as unavailable when there is no repository", async () => {
      const read = await fetch(`${base}/org/nodes/auth/blackboard`, {
        headers: AUTH,
      });
      const teach = await fetch(`${base}/org/nodes/auth/teach`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ rule: "x" }),
      });

      expect(read.status).toBe(503);
      expect(teach.status).toBe(503);
    });
  });

  describe("tree stream", () => {
    beforeEach(() => start({ sessionApiKey: KEY }));

    it("sends a snapshot of the root by default, then live updates", async () => {
      const stream = await openStream(`${base}/org/tree-stream`);
      try {
        expect(stream.response.status).toBe(200);
        expect(stream.response.headers.get("content-type")).toContain(
          "text/event-stream",
        );

        const snapshot = await stream.next();
        expect(snapshot).toMatchObject({ type: "snapshot", focusId: "root" });
        expect(ids(snapshot)).toEqual(["root", "auth"]);

        store.upsert(input("auth", "root", "needs_attention", "services/auth"));

        expect(await stream.next()).toMatchObject({
          type: "node_upsert",
          node: { id: "auth", health: "needs_attention" },
        });
        expect(await stream.next()).toMatchObject({
          type: "node_upsert",
          node: { id: "root", descendantCounts: { needs_attention: 1 } },
        });
      } finally {
        stream.close();
      }
    });

    it("scopes the stream to the requested node", async () => {
      const stream = await openStream(`${base}/org/tree-stream?node=auth`);
      try {
        expect(ids(await stream.next())).toEqual(["root", "auth", "oauth"]);

        store.upsert(input("billing", "root"));
        store.remove("oauth");

        // The sibling insert only reaches this viewer as the root's update.
        expect(await stream.next()).toMatchObject({
          type: "node_upsert",
          node: { id: "root", childIds: ["auth", "billing"] },
        });
        expect(await stream.next()).toEqual({
          type: "node_removed",
          id: "oauth",
        });
      } finally {
        stream.close();
      }
    });

    it("rejects a stream for an unknown node before starting it", async () => {
      const response = await fetch(`${base}/org/tree-stream?node=missing`, {
        headers: AUTH,
      });

      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );
    });

    it("rejects a stream when the tree is empty", async () => {
      store.replaceAll([]);

      const response = await fetch(`${base}/org/tree-stream`, {
        headers: AUTH,
      });

      expect(response.status).toBe(404);
    });

    it("keeps idle connections alive with heartbeats", async () => {
      const stream = await openStream(`${base}/org/tree-stream`);
      try {
        await stream.next();
        await pause(80);
        store.upsert(input("late", "root"));
        await stream.next();

        expect(stream.heartbeatSeen()).toBe(true);
      } finally {
        stream.close();
      }
    });

    it("keeps working for other viewers after one disconnects", async () => {
      const leaving = await openStream(`${base}/org/tree-stream`);
      const staying = await openStream(`${base}/org/tree-stream`);
      try {
        await leaving.next();
        await staying.next();

        leaving.close();
        await pause(50);
        store.upsert(input("after", "root"));

        expect(await staying.next()).toMatchObject({
          type: "node_upsert",
          node: { id: "after" },
        });
      } finally {
        staying.close();
      }
    });

    it("serves viewers at different depths at once", async () => {
      const focusIds = ["root", "auth", "oauth", "root", "auth"];
      const streams = await Promise.all(
        focusIds.map((id) => openStream(`${base}/org/tree-stream?node=${id}`)),
      );
      try {
        const snapshots = await Promise.all(streams.map((s) => s.next()));

        expect(
          snapshots.map((s) => (s.type === "snapshot" ? s.focusId : null)),
        ).toEqual(focusIds);
      } finally {
        streams.forEach((s) => s.close());
      }
    });
  });

  describe("without a session key configured", () => {
    it("serves protected routes openly", async () => {
      await start({});

      const response = await fetch(`${base}/org/nodes/root`);

      expect(response.status).toBe(200);
    });
  });

  describe("blackboard", () => {
    let board: GitBlackboard;

    beforeEach(async () => {
      repoDir = await mkdtemp(join(tmpdir(), "director-server-"));
      await git(repoDir, ["init", "--quiet"]);
      await writeFile(join(repoDir, "README.md"), "hi\n");
      board = new GitBlackboard({ repoDir });
      await start({ blackboard: board, sessionApiKey: KEY });
    });

    it("returns inherited specs, memory and autopsies for a node's boundary", async () => {
      const autopsy = {
        nodeId: "auth",
        at: "2026-11-11T00:00:00Z",
        approach: "a",
        whyFailed: "b",
      };
      await board.write("", "spec.md", "root spec\n");
      await board.write("services/auth", "spec.md", "auth spec\n");
      await board.appendAutopsy("services/auth", autopsy);

      const response = await fetch(`${base}/org/nodes/auth/blackboard`, {
        headers: AUTH,
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        specs: [
          { path: "", spec: "root spec\n", readonly: true },
          { path: "services/auth", spec: "auth spec\n", readonly: false },
        ],
        memory: { rules: [] },
        autopsies: [autopsy],
      });
    });

    it("teaches a rule into the node's own boundary and returns the memory", async () => {
      const response = await fetch(`${base}/org/nodes/auth/teach`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ rule: "  Never log tokens.  " }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ rules: ["Never log tokens."] });
      expect(await board.memory("services/auth")).toEqual({
        rules: ["Never log tokens."],
      });
      expect(await board.memory("")).toEqual({ rules: [] });
      expect(await git(repoDir!, ["status", "--porcelain"])).toBe(
        "?? README.md\n",
      );
    });

    it.each([
      ["a missing rule", JSON.stringify({})],
      ["a blank rule", JSON.stringify({ rule: "   " })],
      ["a non-string rule", JSON.stringify({ rule: 42 })],
      ["a JSON null body", "null"],
      ["invalid JSON", "{not json"],
    ])("rejects %s without writing", async (_label, body) => {
      const response = await fetch(`${base}/org/nodes/auth/teach`, {
        method: "POST",
        headers: AUTH,
        body,
      });

      expect(response.status).toBe(400);
      expect(await board.head()).toBeNull();
    });

    it("rejects an oversized body", async () => {
      const response = await fetch(`${base}/org/nodes/auth/teach`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ rule: "x".repeat(70_000) }),
      });

      expect(response.status).toBe(413);
      expect(await board.head()).toBeNull();
    });
  });
});
