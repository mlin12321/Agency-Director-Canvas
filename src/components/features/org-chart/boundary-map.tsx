import { useTranslation } from "react-i18next";
import type { OrgNode } from "#/api/director/types";
import { I18nKey } from "#/i18n/declaration";
import { cn } from "#/utils/utils";
import {
  ISOLATION_LABEL_KEYS,
  ownerSwatchClass,
} from "./org-chart-presentation";

interface BoundaryMapProps {
  /** Same order as the reports grid, so owner numbers line up. */
  reports: OrgNode[];
}

/**
 * How the focused node's scope is partitioned among its direct reports:
 * one row per owned boundary, keyed to the report's card by number and color.
 */
export function BoundaryMap({ reports }: BoundaryMapProps) {
  const { t } = useTranslation("openhands");
  if (reports.length === 0) return null;

  return (
    <section
      aria-label={t(I18nKey.ORG_CHART$BOUNDARIES)}
      className="flex flex-col gap-2"
    >
      <h2 className="text-sm font-medium text-contrast">
        {t(I18nKey.ORG_CHART$BOUNDARIES)}
      </h2>
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {reports.map((node, index) => (
          <li
            key={node.id}
            className="flex flex-col gap-1 p-2.5 text-xs text-text-secondary"
          >
            <span className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={cn(
                  "size-2.5 shrink-0 rounded-sm",
                  ownerSwatchClass(index),
                )}
              />
              <span className="text-muted">{index + 1}</span>
              <code className="break-all text-contrast">
                {node.boundary.path || t(I18nKey.ORG_CHART$BOUNDARY_ROOT)}
              </code>
            </span>
            <span className="text-muted">
              {t(ISOLATION_LABEL_KEYS[node.isolation])}
              {node.isolation === "worktree" ? (
                <>
                  {" · "}
                  <code>{node.branch}</code>
                </>
              ) : null}
            </span>
            {node.boundary.writable.length > 0 ? (
              <span>
                {t(I18nKey.ORG_CHART$WRITABLE)}{" "}
                <code className="break-all">
                  {node.boundary.writable.join(", ")}
                </code>
              </span>
            ) : null}
            {node.boundary.readonly.length > 0 ? (
              <span>
                {t(I18nKey.ORG_CHART$READONLY)}{" "}
                <code className="break-all">
                  {node.boundary.readonly.join(", ")}
                </code>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
