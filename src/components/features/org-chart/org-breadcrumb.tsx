import { useTranslation } from "react-i18next";
import type { OrgNode } from "#/api/director/types";
import { NavigationLink } from "#/components/shared/navigation-link";
import { orgNodePath } from "#/constants/org-chart";
import { I18nKey } from "#/i18n/declaration";

interface OrgBreadcrumbProps {
  /** Root first. */
  ancestors: OrgNode[];
  current: OrgNode;
}

export function OrgBreadcrumb({ ancestors, current }: OrgBreadcrumbProps) {
  const { t } = useTranslation("openhands");
  return (
    <nav aria-label={t(I18nKey.ORG_CHART$BREADCRUMB_LABEL)}>
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
        {ancestors.map((ancestor) => (
          <li key={ancestor.id} className="flex items-center gap-1.5">
            <NavigationLink
              to={orgNodePath(ancestor.id)}
              className="hover:text-contrast hover:underline"
            >
              {ancestor.title}
            </NavigationLink>
            <span aria-hidden="true">/</span>
          </li>
        ))}
        <li aria-current="page" className="font-medium text-contrast">
          {current.title}
        </li>
      </ol>
    </nav>
  );
}
