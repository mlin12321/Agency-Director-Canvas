import React from "react";
import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { NodeId, OrgNode } from "#/api/director/types";
import { NavigationLink } from "#/components/shared/navigation-link";
import { Tooltip } from "#/components/shared/tooltip";
import { orgNodePath } from "#/constants/org-chart";
import { I18nKey } from "#/i18n/declaration";
import { useOrgChartStore } from "#/stores/org-chart-store";
import { cn } from "#/utils/utils";
import { NodeHoverCard } from "./node-hover-card";

interface NodeCardProps {
  node: OrgNode;
  /** The team the page is on. Its card opens its details. */
  current: boolean;
  titleOf: (id: NodeId) => string;
  onOpenDetails: () => void;
  /** Bring the current team to the middle of a chart that scrolls. */
  centerInScroller?: boolean;
  /** Take all the room the chart gives the card, instead of a fixed width. */
  fill?: boolean;
}

const MAIN_CLASS =
  "flex size-full flex-col justify-center gap-1 rounded-lg p-2 hover:bg-surface-raised";

/**
 * One team. Clicking it moves the page to that team; clicking the team the
 * page is already on opens its details.
 */
export function NodeCard({
  node,
  current,
  titleOf,
  onOpenDetails,
  centerInScroller = false,
  fill = false,
}: NodeCardProps) {
  const { t } = useTranslation("openhands");
  const ref = React.useRef<HTMLDivElement>(null);
  // Only the card being kept in the middle follows the zoom.
  const zoom = useOrgChartStore((state) =>
    current && centerInScroller ? state.zoom : null,
  );
  const onScreen = React.useRef(false);
  const lastZoom = React.useRef<number | null>(null);

  React.useLayoutEffect(() => {
    if (zoom !== null) {
      ref.current?.scrollIntoView?.({
        block: "center",
        inline: "center",
        // Glide when the page moves to a team already on screen; jump on
        // arrival and when zooming, so the team stays under the reader.
        behavior:
          onScreen.current && lastZoom.current === null ? "smooth" : "instant",
      });
    }
    lastZoom.current = zoom;
    onScreen.current = true;
  }, [zoom]);

  const mainClass = cn(
    MAIN_CLASS,
    fill ? "items-center text-center" : "items-start text-left",
  );
  const body = (
    <>
      <span className="flex max-w-full items-start gap-1.5">
        {/* Long names wrap: a card may grow taller, never wider. */}
        <span
          className={cn(
            "min-w-0 break-words font-medium text-contrast",
            fill ? "text-base" : "flex-1 text-sm",
          )}
        >
          {node.title}
        </span>
        {node.escalation_count > 0 ? (
          <span
            role="img"
            aria-label={t(I18nKey.ORG_CHART$ESCALATION_COUNT, {
              count: node.escalation_count,
            })}
            className="flex shrink-0 items-center gap-0.5 pt-0.5 text-xs font-medium text-feedback-error"
          >
            <TriangleAlert width={12} height={12} aria-hidden="true" />
            {node.escalation_count}
          </span>
        ) : null}
      </span>
      {node.child_ids.length > 0 ? (
        <span className="text-xs text-muted">
          {t(I18nKey.ORG_CHART$SUB_TEAMS, { count: node.child_ids.length })}
        </span>
      ) : null}
    </>
  );

  return (
    <div
      ref={ref}
      data-testid={`org-node-${node.id}`}
      data-current={current || undefined}
      className={cn(
        "rounded-lg border bg-surface",
        fill ? "size-full" : "w-40",
        current ? "border-primary ring-1 ring-primary" : "border-border",
      )}
    >
      <Tooltip
        content={<NodeHoverCard node={node} titleOf={titleOf} />}
        placement="bottom"
        delay={300}
      >
        {current ? (
          <button
            type="button"
            aria-current="true"
            aria-label={t(I18nKey.ORG_CHART$OPEN_DETAILS, {
              title: node.title,
            })}
            onClick={onOpenDetails}
            className={mainClass}
          >
            {body}
          </button>
        ) : (
          <NavigationLink to={orgNodePath(node.id)} className={mainClass}>
            {body}
          </NavigationLink>
        )}
      </Tooltip>
    </div>
  );
}
