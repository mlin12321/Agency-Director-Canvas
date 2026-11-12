import { CircleHelp, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { OpenEscalation } from "#/api/director/types";
import { I18nKey } from "#/i18n/declaration";
import { cn } from "#/utils/utils";
import { ESCALATION_LABEL_KEYS } from "./org-chart-presentation";

interface EscalationsPanelProps {
  /** In the server's order: critical issues first, then longest waiting. */
  escalations: OpenEscalation[];
  /** Show the team that raised it in the chart. */
  onReveal: (escalation: OpenEscalation) => void;
}

/**
 * The only work the chart puts in front of the human: what teams could not
 * settle themselves, each with the chain of teams it came up through.
 */
export function EscalationsPanel({
  escalations,
  onReveal,
}: EscalationsPanelProps) {
  const { t } = useTranslation("openhands");
  const title = t(I18nKey.ORG_CHART$ESCALATIONS);

  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h2 className="flex items-center gap-2 text-sm font-medium text-contrast">
        {title}
        {escalations.length > 0 ? (
          <span className="rounded-full bg-surface-raised px-1.5 text-xs text-text-secondary">
            {escalations.length}
          </span>
        ) : null}
      </h2>
      {escalations.length === 0 ? (
        <p className="text-sm text-muted">
          {t(I18nKey.ORG_CHART$ESCALATIONS_EMPTY)}
        </p>
      ) : (
        <ul className="flex max-h-56 flex-wrap gap-2 overflow-y-auto">
          {escalations.map((item) => {
            const { escalation } = item;
            const critical = escalation.kind === "critical_issue";
            const Icon = critical ? TriangleAlert : CircleHelp;
            return (
              <li
                key={`${item.node_id}/${escalation.id}`}
                className="min-w-64 flex-1"
              >
                <button
                  type="button"
                  onClick={() => onReveal(item)}
                  className="flex h-full w-full flex-col items-start gap-1 rounded-lg border border-border bg-surface p-2.5 text-left hover:bg-surface-raised"
                >
                  <span
                    className={cn(
                      "flex items-center gap-1 text-xs font-medium",
                      critical ? "text-feedback-error" : "text-text-secondary",
                    )}
                  >
                    <Icon width={12} height={12} aria-hidden="true" />
                    {t(ESCALATION_LABEL_KEYS[escalation.kind])}
                  </span>
                  <span className="text-sm text-contrast">
                    {escalation.title}
                  </span>
                  {escalation.detail ? (
                    <span className="line-clamp-2 text-xs text-text-secondary">
                      {escalation.detail}
                    </span>
                  ) : null}
                  <span className="text-xs text-muted">
                    {item.path.map((step) => step.title).join(" › ")}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
