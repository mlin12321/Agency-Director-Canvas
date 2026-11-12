import React from "react";
import { PanelRightOpen, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { NodeId, OrgNode } from "#/api/director/types";
import { DisclosureCaret } from "#/components/shared/disclosure-caret";
import { Tooltip } from "#/components/shared/tooltip";
import { I18nKey } from "#/i18n/declaration";
import { cn } from "#/utils/utils";
import { NodeHoverCard } from "./node-hover-card";

export interface OrgTreeHighlight {
  id: NodeId;
  /** Changes on every request, so asking twice scrolls twice. */
  at: number;
}

interface OrgTreeProps {
  /** The node at the top of the chart. */
  root: OrgNode;
  nodes: ReadonlyMap<NodeId, OrgNode>;
  isExpanded: (id: NodeId) => boolean;
  onToggle: (id: NodeId) => void;
  onOpenDetails: (id: NodeId) => void;
  highlight: OrgTreeHighlight | null;
}

type BranchProps = Omit<OrgTreeProps, "root"> & {
  node: OrgNode;
  isTop: boolean;
};

const LINE = "bg-border";

/**
 * From this many reports up, a team whose reports all have no sub-teams
 * lists them in a column. Side by side they would push the rest of the
 * chart off screen without showing any more structure.
 */
const MIN_STACKED_REPORTS = 3;

function NodeCard({
  node,
  expanded,
  onToggle,
  onOpenDetails,
  highlight,
}: {
  node: OrgNode;
  expanded: boolean;
  onToggle: (id: NodeId) => void;
  onOpenDetails: (id: NodeId) => void;
  highlight: OrgTreeHighlight | null;
}) {
  const { t } = useTranslation("openhands");
  const ref = React.useRef<HTMLDivElement>(null);
  const reports = node.child_ids.length;
  const highlightedAt = highlight?.id === node.id ? highlight.at : null;

  React.useEffect(() => {
    if (highlightedAt === null) return;
    ref.current?.scrollIntoView?.({
      block: "center",
      inline: "center",
      behavior: "smooth",
    });
  }, [highlightedAt]);

  const escalations =
    node.escalation_count > 0 ? (
      <span
        role="img"
        aria-label={t(I18nKey.ORG_CHART$ESCALATION_COUNT, {
          count: node.escalation_count,
        })}
        className={cn(
          "flex shrink-0 items-center gap-0.5 text-xs font-medium",
          // Solid where the escalation was raised, quiet on the way up to it.
          node.escalations.length > 0
            ? "text-feedback-error"
            : "text-feedback-warning",
        )}
      >
        <TriangleAlert width={12} height={12} aria-hidden="true" />
        {node.escalation_count}
      </span>
    ) : null;

  const body = (
    <>
      <span className="flex w-full items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-contrast">
          {node.title}
        </span>
        {escalations}
      </span>
      {reports > 0 ? (
        <span className="flex items-center gap-1 text-xs text-muted">
          <DisclosureCaret open={expanded} />
          {t(I18nKey.ORG_CHART$SUB_TEAMS, { count: reports })}
        </span>
      ) : null}
    </>
  );
  const mainClass =
    "flex min-w-0 flex-1 flex-col items-start gap-1 rounded-l-lg p-2.5 text-left hover:bg-surface-raised";

  return (
    <div
      ref={ref}
      data-testid={`org-node-${node.id}`}
      data-highlighted={highlightedAt === null ? undefined : true}
      className={cn(
        "flex w-52 items-stretch rounded-lg border border-border bg-surface",
        highlightedAt === null ? null : "ring-2 ring-primary",
      )}
    >
      <Tooltip
        content={<NodeHoverCard node={node} />}
        placement="bottom"
        delay={300}
      >
        {reports > 0 ? (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => onToggle(node.id)}
            className={mainClass}
          >
            {body}
          </button>
        ) : (
          // A team without sub-teams has nothing to expand; its details are
          // the only place left to go.
          <button
            type="button"
            onClick={() => onOpenDetails(node.id)}
            className={mainClass}
          >
            {body}
          </button>
        )}
      </Tooltip>
      {reports > 0 ? (
        <button
          type="button"
          onClick={() => onOpenDetails(node.id)}
          aria-label={t(I18nKey.ORG_CHART$OPEN_DETAILS, { title: node.title })}
          className="flex items-center rounded-r-lg border-l border-border px-1.5 text-muted hover:bg-surface-raised hover:text-contrast"
        >
          <PanelRightOpen width={14} height={14} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

function Branch({ node, isTop, ...tree }: BranchProps) {
  const { t } = useTranslation("openhands");
  const expanded = node.child_ids.length > 0 && tree.isExpanded(node.id);
  const reports = expanded
    ? node.child_ids.flatMap((id) => tree.nodes.get(id) ?? [])
    : [];
  const stacked =
    reports.length >= MIN_STACKED_REPORTS &&
    reports.every((report) => report.child_ids.length === 0);

  return (
    <li
      className={cn(
        "relative flex shrink-0 flex-col items-center",
        // The rail to the siblings is drawn as two halves per node, so it
        // stops at the middle of the first and of the last one.
        isTop
          ? null
          : [
              "px-2 pt-5",
              "before:absolute before:left-0 before:top-0 before:h-px before:w-1/2 before:bg-border first:before:hidden",
              "after:absolute after:right-0 after:top-0 after:h-px after:w-1/2 after:bg-border last:after:hidden",
            ],
      )}
    >
      {isTop ? null : (
        <span
          aria-hidden="true"
          className={cn("absolute left-1/2 top-0 h-5 w-px", LINE)}
        />
      )}
      <NodeCard
        node={node}
        expanded={expanded}
        onToggle={tree.onToggle}
        onOpenDetails={tree.onOpenDetails}
        highlight={tree.highlight}
      />
      {expanded ? (
        <>
          <span aria-hidden="true" className={cn("h-5 w-px", LINE)} />
          {stacked ? (
            <ul
              className={cn(
                "relative flex flex-col gap-2 pl-4 pt-2",
                // From under the team's card across to the rail on the left.
                "after:absolute after:left-0 after:top-0 after:h-px after:w-1/2 after:bg-border",
              )}
            >
              {reports.map((report) => (
                <li
                  key={report.id}
                  className={cn(
                    "relative",
                    // The rail, drawn one report at a time so that it ends
                    // level with the last one.
                    "after:absolute after:-left-4 after:-top-2 after:bottom-0 after:w-px after:bg-border last:after:bottom-1/2",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn("absolute -left-4 top-1/2 h-px w-4", LINE)}
                  />
                  <NodeCard
                    node={report}
                    expanded={false}
                    onToggle={tree.onToggle}
                    onOpenDetails={tree.onOpenDetails}
                    highlight={tree.highlight}
                  />
                </li>
              ))}
            </ul>
          ) : reports.length > 0 ? (
            <ul className="flex">
              {reports.map((report) => (
                <Branch key={report.id} node={report} isTop={false} {...tree} />
              ))}
            </ul>
          ) : (
            // Expanded before the server has sent its reports.
            <span className="text-xs text-muted">
              {t(I18nKey.ORG_CHART$LOADING)}
            </span>
          )}
        </>
      ) : null}
    </li>
  );
}

/**
 * A top-down org chart. Each team is one card; a team's sub-teams hang
 * below it once it is expanded, side by side, or in a column when none of
 * them has sub-teams of its own.
 */
export function OrgTree({ root, ...tree }: OrgTreeProps) {
  return (
    <ul className="flex w-max min-w-full justify-center">
      <Branch node={root} isTop {...tree} />
    </ul>
  );
}
