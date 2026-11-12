import { useTranslation } from "react-i18next";
import type { OrgNode } from "#/api/director/types";
import { NavigationLink } from "#/components/shared/navigation-link";
import { orgNodePath } from "#/constants/org-chart";
import { I18nKey } from "#/i18n/declaration";
import { cn } from "#/utils/utils";
import { HealthBadge } from "./health-badge";
import {
  HEALTH_LABEL_KEYS,
  HEALTH_ORDER,
  ownerSwatchClass,
} from "./org-chart-presentation";

interface ReportsGridProps {
  /** In the team's own order; a report's position is its owner number. */
  reports: OrgNode[];
  /** Fewer columns, for when the inspector takes part of the width. */
  compact?: boolean;
}

/** Direct reports of the focused node, grouped by operational state. */
export function ReportsGrid({ reports, compact = false }: ReportsGridProps) {
  const { t } = useTranslation("openhands");

  if (reports.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
        {t(I18nKey.ORG_CHART$NO_REPORTS)}
      </p>
    );
  }

  const numbered = reports.map((node, index) => ({ node, index }));

  return (
    <div className="flex flex-col gap-5">
      {HEALTH_ORDER.map((health) => {
        const group = numbered.filter(({ node }) => node.health === health);
        if (group.length === 0) return null;
        return (
          <section
            key={health}
            aria-label={t(HEALTH_LABEL_KEYS[health])}
            className="flex flex-col gap-2"
          >
            <h2>
              <HealthBadge health={health} count={group.length} />
            </h2>
            <ul
              className={cn(
                "grid grid-cols-1 gap-2",
                compact ? "xl:grid-cols-2" : "sm:grid-cols-2 xl:grid-cols-3",
              )}
            >
              {group.map(({ node, index }) => {
                const subTeams = node.child_ids.length;
                return (
                  <li key={node.id}>
                    <NavigationLink
                      to={orgNodePath(node.id)}
                      className="flex h-full flex-col gap-1.5 rounded-lg border border-border bg-surface p-3 hover:bg-surface-raised"
                    >
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className={cn(
                            "size-2.5 shrink-0 rounded-sm",
                            ownerSwatchClass(index),
                          )}
                        />
                        <span className="text-xs text-muted">{index + 1}</span>
                        <span className="truncate text-sm font-medium text-contrast">
                          {node.title}
                        </span>
                      </span>
                      <span className="line-clamp-2 text-xs text-text-secondary">
                        {node.spec_summary}
                      </span>
                      {subTeams > 0 ? (
                        <span className="text-xs text-muted">
                          {t(I18nKey.ORG_CHART$SUB_TEAMS, { count: subTeams })}
                        </span>
                      ) : null}
                    </NavigationLink>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
