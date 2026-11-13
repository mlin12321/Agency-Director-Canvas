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

/**
 * `pending`: the IC of the team above has the work to review. `unreviewed`:
 * the root team's, which has nobody above.
 */
export type ReviewState =
  "pending" | "changes_requested" | "accepted" | "unreviewed";

/** One thing a review found wrong in a team's work. */
export interface ReviewFinding {
  /** The file, relative to the repository; `""` when it is about no one file. */
  path: string;
  line: number | null;
  issue: string;
  evidence: string;
}

/**
 * The review of the work a team reported as done. The IC of the team above
 * reviews it; before that, the team's own IC is asked to describe the changes
 * and to review them.
 */
export interface Review {
  state: ReviewState;
  /** 1 the first time; one more each time the work comes back. */
  round: number;
  /** What the team said it delivered. */
  summary: string;
  /** The team's own account of what it changed, as markdown. Absent on a
   * server that asks for none. */
  description?: string;
  /** Whether the team's IC, asked to review the changes, gave an answer. */
  automated_ran: boolean;
  /** What it found. */
  automated: ReviewFinding[];
  /** What the reviewing IC wants changed, when it asked. */
  findings: ReviewFinding[];
  /** ISO 8601 timestamp of the last change. */
  at: string;
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
  /**
   * One line on what the team is delivering, written by a model from the
   * team's task and its latest report. Empty on a server that writes none.
   */
  headline?: string;
  spec_summary: string;
  /** Open escalations this node raised, wherever above they are held. */
  escalations: Escalation[];
  /** A split of this node's boundary that is not carried out yet. */
  pending_split: SplitProposal | null;
  /**
   * The review of what the team last reported as done. Absent on a server
   * that has no reviews.
   */
  review?: Review | null;
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
  /**
   * The directory the org works in. For a server started in a git submodule
   * that has no org, the nearest repository above it that has one.
   */
  repo_path: string;
  /**
   * The directory the server was started for, relative to `repo_path`.
   * Absent on a server that does not say; `""` when they are the same.
   */
  directory?: string;
  /** An org can only be started in a git repository. */
  is_git_repository: boolean;
  /** The tree is a fixed sample; its agents are not running. */
  fixture: boolean;
  /** Absent on a server that does not hold teams to their boundaries. */
  boundary_enforcement?: BoundaryEnforcement;
}

/**
 * How far a team is held to its boundary. `sandbox`: the shell of an agent
 * can write only the directory its team owns, and its file tools are refused
 * anything else. `checks`: only the file tools are refused.
 */
export type BoundaryEnforcement = "sandbox" | "checks";

/** Something the human says to the org, from somewhere in the repository. */
export interface RouteMessageRequest {
  text: string;
  /** The directory the message is about, repo-relative. Default: the root. */
  path?: string;
  /**
   * How to start the root team's IC when there is no org yet, as for a
   * normal conversation; the message then becomes the org's task and every
   * other agent is derived from this one.
   */
  conversation?: Record<string, unknown>;
}

/** Where a message to the org went. */
export interface RoutedMessage {
  /** The team that received it. */
  node_id: NodeId;
  /** The conversation of that team's IC. */
  conversation_id: string;
  /** There was no org, and the message started one. */
  started_org: boolean;
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
  /** The git ref that holds the uncommitted changes the prune discarded. */
  saved_ref?: string | null;
}

export interface BoundaryMemory {
  rules: string[];
}

export interface InheritedSpec {
  path: string;
  spec: string;
  /** False for the spec of the node's own boundary, which its IC writes. */
  readonly: boolean;
}

/** What the sub-teams of one boundary must keep between them. */
export interface BoundaryContracts {
  /** The boundary that was split. */
  path: string;
  contracts: string;
  /**
   * True for the contracts between the node's own sub-teams; false for the
   * ones the team above set, which the node keeps with the teams beside it.
   */
  own: boolean;
}

export interface NodeBlackboard {
  /** The spec of the node's own boundary, when it has one. */
  specs: InheritedSpec[];
  contracts?: BoundaryContracts[];
  memory: BoundaryMemory;
  autopsies: Autopsy[];
}

/** A direct report, as the owner of a directory. */
export interface BoundaryOwner {
  node_id: NodeId;
  title: string;
  /** The directory it owns, relative to the repository. */
  path: string;
  isolation: IsolationMode;
  branch: string;
}

export interface OwnedFile {
  /** Relative to the repository. */
  path: string;
  /** The direct report that owns the file; null when the node kept it. */
  owner: NodeId | null;
}

/** A file the committed work of two teams changed in ways that do not merge. */
export interface Collision {
  path: string;
  /** The teams whose checkouts collide, the node itself included. */
  node_ids: NodeId[];
}

/** How a node's boundary is divided among its direct reports. */
export interface NodeOwnership {
  node_id: NodeId;
  owners: BoundaryOwner[];
  /** The unignored files of the node's boundary in its own checkout. */
  files: OwnedFile[];
  truncated: boolean;
  /** From the tips of the checkouts; uncommitted changes are not compared. */
  collisions: Collision[];
  /** False when the server's git is too old to look for collisions. */
  collisions_checked: boolean;
}

/**
 * A snapshot holds the focused node, its ancestors and its direct reports
 * (or, for a full stream, every node below it), plus every escalation in the
 * tree that waits on the human. Node events are limited to that same set of
 * nodes; an `escalations` event carries the whole new list.
 */
/** What a pull or a push of the blackboard did. */
export interface BlackboardSync {
  remote: string;
  /** The local blackboard's commit afterwards; `null` when it is empty. */
  head: string | null;
  /** The local blackboard took in remote changes. */
  changed: boolean;
  /**
   * Specs and contracts both sides had changed. The local text was kept;
   * the remote text is in the blackboard's history.
   */
  kept_local: string[];
  /** The remote now has the local blackboard. */
  pushed: boolean;
}

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
