/**
 * Wire contract between the director service (`director/`) and the org-chart
 * UI. The director's `.mjs` modules reference these types through JSDoc, so
 * this file is the single definition of every shape that crosses the wire.
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
  conversationId: string | null;
  status: string;
}

export type HealthCounts = Record<NodeHealth, number>;

export interface OrgNode {
  id: NodeId;
  parentId: NodeId | null;
  childIds: NodeId[];
  title: string;
  boundary: Boundary;
  isolation: IsolationMode;
  worktreePath: string;
  branch: string;
  agents: AgentRef[];
  health: NodeHealth;
  specSummary: string;
  /**
   * Health of every node below this one, so a parent can summarize its whole
   * subtree without the client loading it.
   */
  descendantCounts: HealthCounts;
}

export interface SpawnProposalChild {
  title: string;
  boundary: Boundary;
  isolation: IsolationMode;
  task: string;
}

export interface SpawnProposal {
  nodeId: NodeId;
  rationale: string;
  contracts: string;
  children: SpawnProposalChild[];
}

export interface Autopsy {
  nodeId: NodeId;
  at: string;
  approach: string;
  whyFailed: string;
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
  | { type: "snapshot"; focusId: NodeId; nodes: OrgNode[] }
  | { type: "node_upsert"; node: OrgNode }
  | { type: "node_removed"; id: NodeId }
  | { type: "collision"; nodeIds: NodeId[]; paths: string[] };

export const DIRECTOR_BASE_PATH = "/api/director";
