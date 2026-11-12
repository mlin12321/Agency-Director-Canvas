import React from "react";
import { useTranslation } from "react-i18next";
import type { NodeId, OpenEscalation } from "#/api/director/types";
import { NavigationLink } from "#/components/shared/navigation-link";
import { ORG_CHART_PATH } from "#/constants/org-chart";
import { useOrgTree } from "#/hooks/use-org-tree";
import { I18nKey } from "#/i18n/declaration";
import { AgentInspectorDrawer } from "./agent-inspector-drawer";
import { EscalationsPanel } from "./escalations-panel";
import { OrgBreadcrumb } from "./org-breadcrumb";
import { OrgTree, type OrgTreeHighlight } from "./org-tree";

interface OrgChartViewProps {
  /** The node at the top of the chart; `null` is the root of the tree. */
  nodeId: NodeId | null;
}

function Notice({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <h1 className="text-base font-medium text-contrast">{title}</h1>
      {children}
    </div>
  );
}

function OrgChart({ nodeId }: OrgChartViewProps) {
  const { t } = useTranslation("openhands");
  // The top node starts expanded and is tracked apart from the rest, because
  // its id is not known until the server answers.
  const [topCollapsed, setTopCollapsed] = React.useState(false);
  const [expanded, setExpanded] = React.useState<ReadonlySet<NodeId>>(
    () => new Set(),
  );
  const [detailsId, setDetailsId] = React.useState<NodeId | null>(null);
  const [highlight, setHighlight] = React.useState<OrgTreeHighlight | null>(
    null,
  );
  const expandedIds = React.useMemo(() => [...expanded], [expanded]);
  const { status, focus, ancestors, nodes, escalations } = useOrgTree(
    nodeId,
    expandedIds,
  );
  const focusId = focus?.id ?? null;

  const isExpanded = React.useCallback(
    (id: NodeId) => (id === focusId ? !topCollapsed : expanded.has(id)),
    [focusId, topCollapsed, expanded],
  );
  const toggle = React.useCallback(
    (id: NodeId) => {
      if (id === focusId) {
        setTopCollapsed((collapsed) => !collapsed);
        return;
      }
      setExpanded((current) => {
        const next = new Set(current);
        if (!next.delete(id)) next.add(id);
        return next;
      });
    },
    [focusId],
  );
  const reveal = React.useCallback(
    (item: OpenEscalation) => {
      const path = item.path.map((step) => step.id);
      // Open every team between the top of this chart and the one that
      // raised the escalation, so its card is on screen.
      const between = path.slice(path.indexOf(focusId ?? "") + 1, -1);
      setTopCollapsed(false);
      setExpanded((current) => new Set([...current, ...between]));
      setHighlight({ id: item.node_id, at: Date.now() });
    },
    [focusId],
  );
  const closeDetails = React.useCallback(() => setDetailsId(null), []);

  if (status === "not_found") {
    return (
      <Notice title={t(I18nKey.ORG_CHART$NOT_FOUND_TITLE)}>
        <NavigationLink
          to={ORG_CHART_PATH}
          className="text-sm text-link hover:underline"
        >
          {t(I18nKey.ORG_CHART$BACK_TO_ROOT)}
        </NavigationLink>
      </Notice>
    );
  }

  if (!focus) {
    return status === "unavailable" ? (
      <Notice title={t(I18nKey.ORG_CHART$UNAVAILABLE_TITLE)}>
        <p className="max-w-md text-sm text-muted">
          {t(I18nKey.ORG_CHART$UNAVAILABLE_BODY)}
        </p>
      </Notice>
    ) : (
      <Notice title={t(I18nKey.ORG_CHART$LOADING)} />
    );
  }

  // Collapsing a team takes its sub-teams off the chart, and their details
  // with them.
  const details = detailsId === null ? null : (nodes.get(detailsId) ?? null);
  const stale = status === "reconnecting" || status === "unavailable";

  return (
    <div data-testid="org-chart" className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col gap-4 p-4">
        {ancestors.length > 0 || stale ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            {ancestors.length > 0 ? (
              <OrgBreadcrumb ancestors={ancestors} current={focus} />
            ) : (
              <span />
            )}
            {stale ? (
              <span role="status" className="text-xs text-feedback-warning">
                {t(I18nKey.ORG_CHART$RECONNECTING)}
              </span>
            ) : null}
          </div>
        ) : null}
        <EscalationsPanel escalations={escalations} onReveal={reveal} />
        <section
          aria-label={t(I18nKey.ORG_CHART$NAV)}
          className="min-h-0 flex-1 overflow-auto rounded-xl border border-border p-4"
        >
          <OrgTree
            root={focus}
            nodes={nodes}
            isExpanded={isExpanded}
            onToggle={toggle}
            onOpenDetails={setDetailsId}
            highlight={highlight}
          />
        </section>
      </div>
      {details ? (
        <AgentInspectorDrawer
          key={details.id}
          node={details}
          isTop={details.id === focus.id}
          onClose={closeDetails}
        />
      ) : null}
    </div>
  );
}

/**
 * An org chart of agent teams, drawn top-down from `nodeId`. Teams expand one
 * at a time; besides the org itself, only escalations are shown outright.
 */
export function OrgChartView({ nodeId }: OrgChartViewProps) {
  // What is expanded, highlighted or open belongs to one chart.
  return <OrgChart key={nodeId ?? ""} nodeId={nodeId} />;
}
