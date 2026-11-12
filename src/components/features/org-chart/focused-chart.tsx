import { Ellipsis } from "lucide-react";
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

/** Stands for the part of the org that is not drawn. */
function More() {
  return <Ellipsis width={16} height={16} aria-hidden="true" />;
}

/**
 * One team and its direct reports, filling the chart. The rest of the org
 * is only hinted at: an ellipsis above the team when there is a team above
 * it, and one below each report that has sub-teams of its own.
 */
export function FocusedChart({
  current,
  parent,
  reports,
  titleOf,
  onOpenDetails,
}: FocusedChartProps) {
  const { t } = useTranslation("openhands");
  const anyReportHasSubTeams = reports.some(
    (report) => report.child_ids.length > 0,
  );

  return (
    <div className="flex w-full flex-col items-center">
      {parent ? (
        <NavigationLink
          to={orgNodePath(parent.id)}
          aria-label={t(I18nKey.ORG_CHART$GO_UP, { title: parent.title })}
          className="group flex shrink-0 flex-col items-center text-muted hover:text-contrast"
        >
          <More />
          <span
            aria-hidden="true"
            className={`h-4 ${LINE} group-hover:bg-contrast`}
          />
        </NavigationLink>
      ) : null}
      <div className="min-h-16 w-full flex-1">
        <NodeCard
          node={current}
          current
          fill
          titleOf={titleOf}
          onOpenDetails={onOpenDetails}
        />
      </div>
      {reports.length > 0 ? (
        <>
          <span aria-hidden="true" className={`h-4 shrink-0 ${LINE}`} />
          {/* As many to a row as fit. Rows share the height, and the cards
              of a row share its width, so a short last row leaves no gap. */}
          <ul className="flex w-full flex-2 flex-wrap gap-4 border-t border-border pt-3">
            {reports.map((report) => (
              <li
                key={report.id}
                className="flex min-w-36 flex-1 basis-36 flex-col"
              >
                <div className="min-h-14 flex-1">
                  <NodeCard
                    node={report}
                    current={false}
                    fill
                    titleOf={titleOf}
                    onOpenDetails={onOpenDetails}
                  />
                </div>
                {report.child_ids.length > 0 ? (
                  <span
                    aria-hidden="true"
                    data-has-sub-teams
                    className="flex shrink-0 flex-col items-center text-muted"
                  >
                    <span className={`h-2 ${LINE}`} />
                    <More />
                  </span>
                ) : (
                  // Keeps a row of cards the same height when only some
                  // of them have sub-teams.
                  anyReportHasSubTeams && (
                    <span aria-hidden="true" className="h-6 shrink-0" />
                  )
                )}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
