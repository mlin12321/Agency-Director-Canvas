import { useTranslation } from "react-i18next";
import type { NodeStatus } from "#/api/director/types";
import { cn } from "#/utils/utils";
import {
  STATUS_DOT_CLASSES,
  STATUS_LABEL_KEYS,
} from "./org-chart-presentation";

interface StatusBadgeProps {
  status: NodeStatus;
  /** Shown before the label, e.g. how many teams are in this state. */
  count?: number;
}

export function StatusBadge({ status, count }: StatusBadgeProps) {
  const { t } = useTranslation("openhands");
  return (
    <span
      data-status={status}
      className="inline-flex items-center gap-1.5 text-xs text-text-secondary"
    >
      <span
        aria-hidden="true"
        className={cn("size-2 rounded-full", STATUS_DOT_CLASSES[status])}
      />
      {count === undefined ? null : (
        <span className="font-medium text-contrast">{count}</span>
      )}
      {t(STATUS_LABEL_KEYS[status])}
    </span>
  );
}
