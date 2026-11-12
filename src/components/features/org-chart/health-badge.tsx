import { useTranslation } from "react-i18next";
import type { NodeHealth } from "#/api/director/types";
import { cn } from "#/utils/utils";
import {
  HEALTH_DOT_CLASSES,
  HEALTH_LABEL_KEYS,
} from "./org-chart-presentation";

interface HealthBadgeProps {
  health: NodeHealth;
  /** Shown before the label, e.g. how many teams are in this state. */
  count?: number;
}

export function HealthBadge({ health, count }: HealthBadgeProps) {
  const { t } = useTranslation("openhands");
  return (
    <span
      data-health={health}
      className="inline-flex items-center gap-1.5 text-xs text-text-secondary"
    >
      <span
        aria-hidden="true"
        className={cn("size-2 rounded-full", HEALTH_DOT_CLASSES[health])}
      />
      {count === undefined ? null : (
        <span className="font-medium text-contrast">{count}</span>
      )}
      {t(HEALTH_LABEL_KEYS[health])}
    </span>
  );
}
