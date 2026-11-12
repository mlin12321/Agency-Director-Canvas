import React from "react";
import { useTranslation } from "react-i18next";
import type { AgentRole, NodeId } from "#/api/director/types";
import { NavigationLink } from "#/components/shared/navigation-link";
import { ORG_CHART_PATH } from "#/constants/org-chart";
import { useOrgTree } from "#/hooks/use-org-tree";
import { I18nKey } from "#/i18n/declaration";
import { cn } from "#/utils/utils";
import { AgentInspectorDrawer } from "./agent-inspector-drawer";
import { BoundaryMap } from "./boundary-map";
import { NodeHeader } from "./node-header";
import { OrgBreadcrumb } from "./org-breadcrumb";
import { ReportsGrid } from "./reports-grid";

interface OrgNodeWorkspaceProps {
  /** `null` shows the root of the tree. */
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

/**
 * The same three-part workspace at every level of the org chart: the focused
 * node and its direct reports, how its scope is split among them, and an
 * inspector for any one of its agents.
 */
export function OrgNodeWorkspace({ nodeId }: OrgNodeWorkspaceProps) {
  const { t } = useTranslation("openhands");
  const { status, focus, ancestors, reports } = useOrgTree(nodeId);
  // Tracked by role so the drawer follows the agent across live updates.
  const [inspectedRole, setInspectedRole] = React.useState<AgentRole | null>(
    null,
  );
  const closeInspector = React.useCallback(() => setInspectedRole(null), []);

  // The inspector belongs to the node it was opened on.
  React.useEffect(() => {
    setInspectedRole(null);
  }, [nodeId]);

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

  const inspected =
    focus.agents.find((agent) => agent.role === inspectedRole) ?? null;

  return (
    <div data-testid="org-node-workspace" className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <OrgBreadcrumb ancestors={ancestors} current={focus} />
          {status === "reconnecting" ? (
            <span role="status" className="text-xs text-feedback-warning">
              {t(I18nKey.ORG_CHART$RECONNECTING)}
            </span>
          ) : null}
        </div>
        <NodeHeader
          node={focus}
          onInspectAgent={(agent) => setInspectedRole(agent.role)}
        />
        <div
          className={cn(
            "grid grid-cols-1 gap-4",
            inspected ? null : "lg:grid-cols-3",
          )}
        >
          <section
            aria-label={t(I18nKey.ORG_CHART$DIRECT_REPORTS)}
            className={inspected ? undefined : "lg:col-span-2"}
          >
            <ReportsGrid reports={reports} compact={inspected !== null} />
          </section>
          <BoundaryMap reports={reports} />
        </div>
      </div>
      {inspected ? (
        <AgentInspectorDrawer
          node={focus}
          agent={inspected}
          onClose={closeInspector}
        />
      ) : null}
    </div>
  );
}
