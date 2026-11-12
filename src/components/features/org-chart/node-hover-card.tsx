import { useTranslation } from "react-i18next";
import type { OrgNode } from "#/api/director/types";
import { I18nKey } from "#/i18n/declaration";
import { HealthBadge } from "./health-badge";
import {
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

/**
 * What a team is doing and what it owns. Shown only while its card is
 * hovered or focused, so the chart itself stays a plain picture of the org.
 */
export function NodeHoverCard({ node }: { node: OrgNode }) {
  const { t } = useTranslation("openhands");
  const { boundary } = node;

  return (
    <div className="flex w-80 max-w-full flex-col gap-2 break-normal p-1 text-left text-xs">
      {node.spec_summary ? (
        <p className="text-text-secondary">{node.spec_summary}</p>
      ) : null}
      <dl className="flex flex-col gap-1">
        <Row label={t(I18nKey.ORG_CHART$STATUS)}>
          <HealthBadge health={node.health} />
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
    </div>
  );
}
