/**
 * The Agent Server's director API, as the org-chart UI consumes it. The
 * contract is defined by the server (`openhands.agent_server.director.models`
 * in the SDK); these types mirror it and must not add to it.
 */

export type NodeId = string;

/**
 * A pod has an IC and a Manager. A team's IC leads that team, is a report
 * of the team above, and does the code work in its boundary that no
 * sub-team has taken on.
 */
export type AgentRole = "ic" | "manager";

export type NodeStatus = "idle" | "working" | "done" | "blocked";

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

/** A node that tried to settle an escalation, could not, and passed it up. */
export interface EscalationHandoff {
  node_id: NodeId;
  /** Why this node could not settle it. */
  reason: string;
  /** ISO 8601 timestamp. */
  at: string;
}

/**
 * Something a node cannot settle itself. It goes to the node above, which
 * settles it or passes it up in turn; it waits on the human only once every
 * node above the one that raised it has passed it up.
 */
export interface Escalation {
  /** Unique within the node that raised it. */
  id: string;
  kind: EscalationKind;
  title: string;
  detail: string;
  /** ISO 8601 timestamp. */
  raised_at: string;
  /** The node working on it now; `null` when it waits on the human. */
  held_by: NodeId | null;
  /** The nodes that passed it up, nearest to the one that raised it first. */
  handoffs: EscalationHandoff[];
}

export type StatusCounts = Record<NodeStatus, number>;

export type SplitStatus = "proposed" | "refine_requested" | "approved";

/** A sub-team an IC proposes to hand part of its boundary to. */
export interface SplitChild {
  title: string;
  /** Directory the sub-team owns, inside the proposing node's boundary. */
  path: string;
  writable: string[];
  readonly: string[];
  isolation: IsolationMode;
  /** What the sub-team is to deliver. */
  task: string;
}

/** An IC's proposal to split its boundary, for its Manager to decide. */
export interface SplitProposal {
  children: SplitChild[];
  contracts: string;
  status: SplitStatus;
  /** What the Manager wants changed, when it asked. */
  feedback: string;
  /** ISO 8601 timestamp. */
  proposed_at: string;
}

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
  status: NodeStatus;
  spec_summary: string;
  /** Open escalations this node raised, wherever above they are held. */
  escalations: Escalation[];
  /** A split of this node's boundary that is not carried out yet. */
  pending_split: SplitProposal | null;
  /**
   * Status of every node below this one, so a parent can summarize its whole
   * subtree without the client loading it.
   */
  descendant_counts: StatusCounts;
  /** Escalations from this node or below that wait on the human. */
  escalation_count: number;
}

/** Whether the director has an org, and where it would keep one. */
export interface OrgSummary {
  /** `null` when no org has been started. */
  root_id: NodeId | null;
  node_count: number;
  /** The directory the org works in. */
  repo_path: string;
  /** An org can only be started in a git repository. */
  is_git_repository: boolean;
  /** The tree is a fixed sample; its agents are not running. */
  fixture: boolean;
}

/** Start an org: a root team that works on `task`. */
export interface CreateOrgRequest {
  title: string;
  task: string;
  /**
   * How to start the root team's IC, as for a normal conversation. Every
   * other agent of the org is derived from it.
   */
  conversation: Record<string, unknown>;
}

/** An escalation that waits on the human, with the nodes it came up through. */
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
 * A snapshot holds the focused node, its ancestors and its direct reports
 * (or, for a full stream, every node below it), plus every escalation in the
 * tree that waits on the human. Node events are limited to that same set of
 * nodes; an `escalations` event carries the whole new list.
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
