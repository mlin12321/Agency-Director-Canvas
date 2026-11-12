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

export type EscalationKind = "critical_issue" | "design_decision";

/** Something a node cannot settle itself and has sent up to the human. */
export interface Escalation {
  /** Unique within the node that raised it. */
  id: string;
  kind: EscalationKind;
  title: string;
  detail: string;
  /** ISO 8601 timestamp. */
  raised_at: string;
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
  /** Open escalations this node raised, oldest first. */
  escalations: Escalation[];
  /**
   * Health of every node below this one, so a parent can summarize its whole
   * subtree without the client loading it.
   */
  descendant_counts: HealthCounts;
  /**
   * Open escalations on this node and every node below it, so a collapsed
   * parent still shows that something below needs the human.
   */
  escalation_count: number;
}

/** An escalation with the chain of nodes it travelled up. */
export interface OpenEscalation {
  /** The node that raised it. */
  node_id: NodeId;
  escalation: Escalation;
  /** Root first, ending at the node that raised it. */
  path: Array<{ id: NodeId; title: string }>;
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
 * A snapshot holds the focused node, its ancestors (for the breadcrumb), its
 * direct reports and the direct reports of every expanded node, plus every
 * open escalation at or below the focused node. Node events are limited to
 * that same set; an `escalations` event carries the whole new list.
 */
export type OrgEvent =
  | {
      type: "snapshot";
      focus_id: NodeId;
      nodes: OrgNode[];
      escalations: OpenEscalation[];
    }
  | { type: "node_upsert"; node: OrgNode }
  | { type: "node_removed"; id: NodeId }
  | { type: "escalations"; escalations: OpenEscalation[] };

export const DIRECTOR_BASE_PATH = "/api/director";
