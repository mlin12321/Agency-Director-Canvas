import type {
  AgentRole,
  IsolationMode,
  NodeHealth,
} from "#/api/director/types";
import { I18nKey } from "#/i18n/declaration";

/** Most urgent first: this is the order sections appear in the grid. */
export const HEALTH_ORDER: readonly NodeHealth[] = [
  "needs_attention",
  "collision",
  "negotiating_split",
  "converging",
  "done",
  "pruned",
];

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
  lead_ic: I18nKey.ORG_CHART$ROLE_LEAD_IC,
  manager: I18nKey.ORG_CHART$ROLE_MANAGER,
  reviewer: I18nKey.ORG_CHART$ROLE_REVIEWER,
  worker: I18nKey.ORG_CHART$ROLE_WORKER,
};

export const ISOLATION_LABEL_KEYS: Record<IsolationMode, I18nKey> = {
  worktree: I18nKey.ORG_CHART$ISOLATION_WORKTREE,
  shared: I18nKey.ORG_CHART$ISOLATION_SHARED,
};

/**
 * Swatches that tie a boundary row to its owner's card. There are fewer
 * colors than a team can have reports, so the owner's number is the
 * unambiguous key and the color only a visual aid.
 */
const OWNER_SWATCH_CLASSES = [
  "bg-info",
  "bg-success",
  "bg-warning",
  "bg-accent",
  "bg-danger",
  "bg-primary",
] as const;

export function ownerSwatchClass(index: number) {
  return OWNER_SWATCH_CLASSES[index % OWNER_SWATCH_CLASSES.length];
}
