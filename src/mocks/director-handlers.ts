import { http, HttpResponse } from "msw";
import {
  DIRECTOR_BASE_PATH,
  type AgentRef,
  type HealthCounts,
  type NodeBlackboard,
  type NodeHealth,
  type NodeId,
  type OrgEvent,
  type OrgNode,
} from "#/api/director/types";

/**
 * MSW handlers for the Agent Server director API, so `npm run dev:mock` renders the
 * org chart without one running. The tree is small and static: one root, a
 * few domains, and a few modules under each.
 */
const NODE_QUERY_PARAM = "node";
const BASE = `*${DIRECTOR_BASE_PATH}`;
const ROOT_ID = "root";

const POD: AgentRef[] = [
  { role: "lead_ic", conversation_id: null, status: "running" },
  { role: "manager", conversation_id: null, status: "idle" },
  { role: "reviewer", conversation_id: null, status: "idle" },
];

const DOMAINS: Array<{ name: string; health: NodeHealth }> = [
  { name: "platform", health: "converging" },
  { name: "payments", health: "needs_attention" },
  { name: "identity", health: "negotiating_split" },
  { name: "search", health: "done" },
];

const MODULES: Array<{ name: string; health: NodeHealth }> = [
  { name: "api", health: "converging" },
  { name: "worker", health: "collision" },
  { name: "storage", health: "done" },
];

function zeroCounts(): HealthCounts {
  return {
    converging: 0,
    negotiating_split: 0,
    collision: 0,
    needs_attention: 0,
    pruned: 0,
    done: 0,
  };
}

function buildMockTree() {
  const nodes = new Map<NodeId, OrgNode>();
  const moduleCounts = zeroCounts();
  MODULES.forEach(({ health }) => {
    moduleCounts[health] += 1;
  });

  const rootCounts = zeroCounts();
  DOMAINS.forEach((domain) => {
    const path = `services/${domain.name}`;
    rootCounts[domain.health] += 1;
    MODULES.forEach((module) => {
      rootCounts[module.health] += 1;
      const id = `${domain.name}.${module.name}`;
      nodes.set(id, {
        id,
        parent_id: domain.name,
        child_ids: [],
        title: `${domain.name}/${module.name}`,
        boundary: {
          path: `${path}/${module.name}`,
          writable: [`${path}/${module.name}/**`],
          readonly: [`${path}/contracts/**`],
        },
        isolation: "shared",
        worktree_path: `.worktrees/${domain.name}`,
        branch: `agents/${domain.name}`,
        agents: POD,
        health: module.health,
        spec_summary: `Implements ${module.name} for ${domain.name}.`,
        descendant_counts: zeroCounts(),
      });
    });
    nodes.set(domain.name, {
      id: domain.name,
      parent_id: ROOT_ID,
      child_ids: MODULES.map((module) => `${domain.name}.${module.name}`),
      title: `${domain.name} domain`,
      boundary: { path, writable: [`${path}/*.md`], readonly: [] },
      isolation: "worktree",
      worktree_path: `.worktrees/${domain.name}`,
      branch: `agents/${domain.name}`,
      agents: POD,
      health: domain.health,
      spec_summary: `Interface contracts between the ${domain.name} services.`,
      descendant_counts: { ...moduleCounts },
    });
  });
  nodes.set(ROOT_ID, {
    id: ROOT_ID,
    parent_id: null,
    child_ids: DOMAINS.map((domain) => domain.name),
    title: "Root organization",
    boundary: { path: "", writable: [], readonly: ["**"] },
    isolation: "worktree",
    worktree_path: ".",
    branch: "main",
    agents: POD,
    health: "converging",
    spec_summary: "Owns cross-domain contracts and the release plan.",
    descendant_counts: rootCounts,
  });
  return nodes;
}

const tree = buildMockTree();

function snapshot(focusId: NodeId): OrgEvent | null {
  const focus = tree.get(focusId);
  if (!focus) return null;
  const ancestors: OrgNode[] = [];
  let parent = focus.parent_id === null ? undefined : tree.get(focus.parent_id);
  while (parent) {
    ancestors.unshift(parent);
    parent = parent.parent_id === null ? undefined : tree.get(parent.parent_id);
  }
  const reports = focus.child_ids.flatMap((id) => tree.get(id) ?? []);
  return {
    type: "snapshot",
    focus_id: focusId,
    nodes: [...ancestors, focus, ...reports],
  };
}

let taughtRules = new Map<NodeId, string[]>();

export function resetDirectorMockData() {
  taughtRules = new Map();
}

function notFound(id: string) {
  return HttpResponse.json({ detail: `Unknown node: ${id}` }, { status: 404 });
}

export const DIRECTOR_HANDLERS = [
  http.get(`${BASE}/org/tree-stream`, ({ request }) => {
    const focusId =
      new URL(request.url).searchParams.get(NODE_QUERY_PARAM) ?? ROOT_ID;
    const event = snapshot(focusId);
    if (!event) return notFound(focusId);

    // One snapshot, then the stream stays open like the real one does.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
          ),
        );
      },
    });
    return new HttpResponse(stream, {
      headers: { "Content-Type": "text/event-stream; charset=utf-8" },
    });
  }),

  http.get(`${BASE}/org/nodes/:nodeId/blackboard`, ({ params }) => {
    const nodeId = String(params.nodeId);
    if (!tree.has(nodeId)) return notFound(nodeId);
    const body: NodeBlackboard = {
      specs: [],
      memory: { rules: taughtRules.get(nodeId) ?? [] },
      autopsies: [],
    };
    return HttpResponse.json(body);
  }),

  http.post(`${BASE}/org/nodes/:nodeId/teach`, async ({ params, request }) => {
    const nodeId = String(params.nodeId);
    if (!tree.has(nodeId)) return notFound(nodeId);
    const payload = (await request.json()) as { rule?: unknown } | null;
    const rule = typeof payload?.rule === "string" ? payload.rule.trim() : "";
    if (!rule) {
      return HttpResponse.json(
        { detail: "`rule` must be a non-empty string" },
        { status: 400 },
      );
    }
    const rules = taughtRules.get(nodeId) ?? [];
    if (!rules.includes(rule)) taughtRules.set(nodeId, [...rules, rule]);
    return HttpResponse.json({ rules: taughtRules.get(nodeId) ?? [] });
  }),
];
