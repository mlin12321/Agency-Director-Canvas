import { useTranslation } from "react-i18next";
import type { NodeId, OrgNode } from "#/api/director/types";
import { I18nKey } from "#/i18n/declaration";
import { StatusBadge } from "./status-badge";
import {
  ESCALATION_LABEL_KEYS,
  ISOLATION_LABEL_KEYS,
  ROLE_LABEL_KEYS,
} from "./org-chart-presentation";

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-1.5">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 text-contrast">{children}</dd>
    </div>
  );
}

interface NodeHoverCardProps {
  node: OrgNode;
  /** Title of a team by id, when the page has it. */
  titleOf: (id: NodeId) => string;
}

/**
 * What a team is doing and what it owns. Shown only while its card is
 * hovered or focused, so the chart itself stays a plain picture of the org.
 */
export function NodeHoverCard({ node, titleOf }: NodeHoverCardProps) {
  const { t } = useTranslation("openhands");
  const { boundary } = node;

  return (
    <div className="flex w-80 max-w-full flex-col gap-2 break-normal p-1 text-left text-xs">
      <p className="text-sm font-medium text-contrast">{node.title}</p>
      {node.spec_summary ? (
        <p className="text-text-secondary">{node.spec_summary}</p>
      ) : null}
      <dl className="flex flex-col gap-1">
        <Row label={t(I18nKey.ORG_CHART$STATUS)}>
          <StatusBadge status={node.status} />
        </Row>
        <Row label={t(I18nKey.ORG_CHART$BOUNDARY)}>
          <code className="break-all">
            {boundary.path || t(I18nKey.ORG_CHART$BOUNDARY_ROOT)}
          </code>
          <span className="text-muted">
            {" · "}
            {t(ISOLATION_LABEL_KEYS[node.isolation])}
          </span>
        </Row>
        {boundary.writable.length > 0 ? (
          <Row label={t(I18nKey.ORG_CHART$WRITABLE)}>
            <code className="break-all">{boundary.writable.join(", ")}</code>
          </Row>
        ) : null}
        {boundary.readonly.length > 0 ? (
          <Row label={t(I18nKey.ORG_CHART$READONLY)}>
            <code className="break-all">{boundary.readonly.join(", ")}</code>
          </Row>
        ) : null}
        {node.agents.length > 0 ? (
          <Row label={t(I18nKey.ORG_CHART$AGENTS)}>
            {node.agents
              .map(
                (agent) =>
                  `${t(ROLE_LABEL_KEYS[agent.role])} (${agent.status})`,
              )
              .join(", ")}
          </Row>
        ) : null}
      </dl>
      {node.escalations.length > 0 ? (
        // What this team sent up, and which team above is dealing with it.
        <ul className="flex flex-col gap-1 border-t border-border pt-2">
          {node.escalations.map((escalation) => (
            <li key={escalation.id} className="flex flex-col">
              <span className="text-contrast">{escalation.title}</span>
              <span className="text-muted">
                {t(ESCALATION_LABEL_KEYS[escalation.kind])}
                {" · "}
                {escalation.held_by === null
                  ? t(I18nKey.ORG_CHART$ESCALATION_WAITING)
                  : t(I18nKey.ORG_CHART$ESCALATION_HELD_BY, {
                      team: titleOf(escalation.held_by),
                    })}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
