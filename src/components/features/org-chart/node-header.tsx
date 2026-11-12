import { useTranslation } from "react-i18next";
import type { AgentRef, OrgNode } from "#/api/director/types";
import { I18nKey } from "#/i18n/declaration";
import { HealthBadge } from "./health-badge";
import { HEALTH_ORDER, ROLE_LABEL_KEYS } from "./org-chart-presentation";

interface NodeHeaderProps {
  node: OrgNode;
  onInspectAgent: (agent: AgentRef) => void;
}

export function NodeHeader({ node, onInspectAgent }: NodeHeaderProps) {
  const { t } = useTranslation("openhands");
  const below = HEALTH_ORDER.filter(
    (health) => node.descendant_counts[health] > 0,
  );

  return (
    <header className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-contrast">{node.title}</h1>
        <HealthBadge health={node.health} />
      </div>
      {node.spec_summary ? (
        <p className="text-sm text-text-secondary">{node.spec_summary}</p>
      ) : null}

      <section
        aria-label={t(I18nKey.ORG_CHART$AGENTS)}
        className="flex flex-wrap gap-2"
      >
        {node.agents.map((agent) => (
          <button
            key={agent.role}
            type="button"
            onClick={() => onInspectAgent(agent)}
            className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1 text-sm text-contrast hover:bg-surface-raised"
          >
            {t(ROLE_LABEL_KEYS[agent.role])}
            <span className="text-xs text-muted">{agent.status}</span>
          </button>
        ))}
      </section>

      {below.length > 0 ? (
        <section
          aria-label={t(I18nKey.ORG_CHART$TEAMS_BELOW)}
          className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-3"
        >
          <span className="text-xs text-muted">
            {t(I18nKey.ORG_CHART$TEAMS_BELOW)}
          </span>
          {below.map((health) => (
            <HealthBadge
              key={health}
              health={health}
              count={node.descendant_counts[health]}
            />
          ))}
        </section>
      ) : null}
    </header>
  );
}
