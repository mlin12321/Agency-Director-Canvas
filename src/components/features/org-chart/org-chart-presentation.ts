import type {
  AgentRole,
  EscalationKind,
  IsolationMode,
  NodeHealth,
} from "#/api/director/types";
import { I18nKey } from "#/i18n/declaration";

export const HEALTH_LABEL_KEYS: Record<NodeHealth, I18nKey> = {
  converging: I18nKey.ORG_CHART$HEALTH_CONVERGING,
  negotiating_split: I18nKey.ORG_CHART$HEALTH_NEGOTIATING_SPLIT,
  collision: I18nKey.ORG_CHART$HEALTH_COLLISION,
  needs_attention: I18nKey.ORG_CHART$HEALTH_NEEDS_ATTENTION,
  pruned: I18nKey.ORG_CHART$HEALTH_PRUNED,
  done: I18nKey.ORG_CHART$HEALTH_DONE,
};

export const HEALTH_DOT_CLASSES: Record<NodeHealth, string> = {
  converging: "bg-info",
  negotiating_split: "bg-accent",
  collision: "bg-danger",
  needs_attention: "bg-warning",
  pruned: "bg-muted",
  done: "bg-success",
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
