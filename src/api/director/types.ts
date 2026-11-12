/**
 * The Agent Server's director API, as the org-chart UI consumes it. The
 * contract is defined by the server (`openhands.agent_server.director.models`
 * in the SDK); these types mirror it and must not add to it.
 */

export type NodeId = string;

export type AgentRole = "lead_ic" | "manager" | "reviewer" | "worker";

export type NodeHealth =
  | "converging"
  | "negotiating_split"
  | "collision"
  | "needs_attention"
  | "pruned"
  | "done";

/** `worktree`: own git worktree. `shared`: same directory as the parent. */
export type IsolationMode = "worktree" | "shared";

/** A codeowner boundary. All paths and globs are repo-relative. */
export interface Boundary {
  /** Directory the boundary is rooted at; `""` is the repository root. */
  path: string;
  writable: string[];
  readonly: string[];
}

export interface AgentRef {
  role: AgentRole;
  /** `null` until the director has started a conversation for this agent. */
  conversation_id: string | null;
  status: string;
}

export type HealthCounts = Record<NodeHealth, number>;

export interface OrgNode {
  id: NodeId;
  parent_id: NodeId | null;
  child_ids: NodeId[];
  title: string;
  boundary: Boundary;
  isolation: IsolationMode;
  worktree_path: string;
  branch: string;
  agents: AgentRef[];
  health: NodeHealth;
  spec_summary: string;
  /**
   * Health of every node below this one, so a parent can summarize its whole
   * subtree without the client loading it.
   */
  descendant_counts: HealthCounts;
}

export interface Autopsy {
  node_id: NodeId;
  at: string;
  approach: string;
  why_failed: string;
}

export interface BoundaryMemory {
  rules: string[];
}

export interface InheritedSpec {
  path: string;
  spec: string;
  /** Ancestor specs are invariants; only the node's own spec is writable. */
  readonly: boolean;
}

export interface NodeBlackboard {
  specs: InheritedSpec[];
  memory: BoundaryMemory;
  autopsies: Autopsy[];
}

/**
 * A snapshot holds the focused node, its ancestors (for the breadcrumb) and
 * its direct reports. Later events are limited to that same set.
 */
export type OrgEvent =
  | { type: "snapshot"; focus_id: NodeId; nodes: OrgNode[] }
  | { type: "node_upsert"; node: OrgNode }
  | { type: "node_removed"; id: NodeId };

export const DIRECTOR_BASE_PATH = "/api/director";
