import type {
  AgentRole,
  BoundaryEnforcement,
  EscalationKind,
  IsolationMode,
  NodeStatus,
  SplitStatus,
} from "#/api/director/types";
import { I18nKey } from "#/i18n/declaration";

export const STATUS_LABEL_KEYS: Record<NodeStatus, I18nKey> = {
  idle: I18nKey.ORG_CHART$STATUS_IDLE,
  working: I18nKey.ORG_CHART$STATUS_WORKING,
  done: I18nKey.ORG_CHART$STATUS_DONE,
  blocked: I18nKey.ORG_CHART$STATUS_BLOCKED,
};

export const STATUS_DOT_CLASSES: Record<NodeStatus, string> = {
  idle: "bg-muted",
  working: "bg-info",
  done: "bg-success",
  blocked: "bg-danger",
};

export const ROLE_LABEL_KEYS: Record<AgentRole, I18nKey> = {
  ic: I18nKey.ORG_CHART$ROLE_IC,
  manager: I18nKey.ORG_CHART$ROLE_MANAGER,
};

export const ISOLATION_LABEL_KEYS: Record<IsolationMode, I18nKey> = {
  worktree: I18nKey.ORG_CHART$ISOLATION_WORKTREE,
  shared: I18nKey.ORG_CHART$ISOLATION_SHARED,
};

export const ESCALATION_LABEL_KEYS: Record<EscalationKind, I18nKey> = {
  critical_issue: I18nKey.ORG_CHART$ESCALATION_CRITICAL,
  design_decision: I18nKey.ORG_CHART$ESCALATION_DECISION,
};

export const ENFORCEMENT_LABEL_KEYS: Record<BoundaryEnforcement, I18nKey> = {
  sandbox: I18nKey.ORG_CHART$ENFORCED_SANDBOX,
  checks: I18nKey.ORG_CHART$ENFORCED_CHECKS,
};

export const SPLIT_LABEL_KEYS: Record<SplitStatus, I18nKey> = {
  proposed: I18nKey.ORG_CHART$SPLIT_PROPOSED,
  refine_requested: I18nKey.ORG_CHART$SPLIT_REFINE_REQUESTED,
  approved: I18nKey.ORG_CHART$SPLIT_APPROVED,
};
