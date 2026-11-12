import { ChevronUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { NodeId, OrgNode } from "#/api/director/types";
import { NavigationLink } from "#/components/shared/navigation-link";
import { orgNodePath } from "#/constants/org-chart";
import { I18nKey } from "#/i18n/declaration";
import { NodeCard } from "./node-card";

interface FocusedChartProps {
  current: OrgNode;
  parent: OrgNode | null;
  reports: OrgNode[];
  titleOf: (id: NodeId) => string;
  onOpenDetails: () => void;
}

const LINE = "w-px bg-border";

/**
 * One team and its direct reports, and nothing else of the org. A line
 * leaving the top of the team says it has a team above it; a line leaving
 * the bottom of a report says that report has sub-teams of its own.
 */
export function FocusedChart({
  current,
  parent,
  reports,
  titleOf,
  onOpenDetails,
}: FocusedChartProps) {
  const { t } = useTranslation("openhands");

  return (
    <div className="flex w-full flex-col items-center">
      {parent ? (
        <NavigationLink
          to={orgNodePath(parent.id)}
          aria-label={t(I18nKey.ORG_CHART$GO_UP, { title: parent.title })}
          className="group flex flex-col items-center text-muted hover:text-contrast"
        >
          <ChevronUp width={14} height={14} aria-hidden="true" />
          <span
            aria-hidden="true"
            className={`h-6 ${LINE} group-hover:bg-contrast`}
          />
        </NavigationLink>
      ) : null}
      <NodeCard
        node={current}
        current
        titleOf={titleOf}
        onOpenDetails={onOpenDetails}
      />
      {reports.length > 0 ? (
        <>
          <span aria-hidden="true" className={`h-6 ${LINE}`} />
          <ul className="flex max-w-full flex-wrap justify-center gap-x-3 gap-y-1 border-t border-border pt-3">
            {reports.map((report) => (
              <li key={report.id} className="flex flex-col items-center">
                <NodeCard
                  node={report}
                  current={false}
                  titleOf={titleOf}
                  onOpenDetails={onOpenDetails}
                />
                <span
                  aria-hidden="true"
                  data-has-sub-teams={report.child_ids.length > 0 || undefined}
                  className={
                    report.child_ids.length > 0 ? `h-3 ${LINE}` : "h-3"
                  }
                />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
