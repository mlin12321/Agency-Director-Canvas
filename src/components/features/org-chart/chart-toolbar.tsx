import { Minus, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import {
  ORG_CHART_ZOOM,
  useOrgChartStore,
  type OrgChartViewMode,
} from "#/stores/org-chart-store";
import { cn } from "#/utils/utils";

const BUTTON =
  "flex h-7 items-center justify-center rounded-md px-2 text-xs text-text-secondary hover:bg-surface-raised hover:text-contrast disabled:opacity-40 disabled:hover:bg-transparent";

const VIEWS: Array<{ mode: OrgChartViewMode; label: I18nKey }> = [
  { mode: "focused", label: I18nKey.ORG_CHART$VIEW_FOCUSED },
  { mode: "full", label: I18nKey.ORG_CHART$VIEW_FULL },
];

/** Which chart is drawn, and how large. Both are remembered. */
export function ChartToolbar() {
  const { t } = useTranslation("openhands");
  const { view, zoom, setView, zoomIn, zoomOut, resetZoom } =
    useOrgChartStore();

  return (
    <div className="flex items-center gap-3">
      <div
        role="group"
        aria-label={t(I18nKey.ORG_CHART$VIEW)}
        className="flex rounded-lg border border-border p-0.5"
      >
        {VIEWS.map(({ mode, label }) => (
          <button
            key={mode}
            type="button"
            aria-pressed={view === mode}
            onClick={() => setView(mode)}
            className={cn(
              BUTTON,
              view === mode
                ? "bg-surface-raised text-contrast director:bg-primary director:text-on-accent director:hover:bg-primary director:hover:text-on-accent"
                : null,
            )}
          >
            {t(label)}
          </button>
        ))}
      </div>
      <div
        role="group"
        aria-label={t(I18nKey.ORG_CHART$ZOOM)}
        className="flex items-center rounded-lg border border-border p-0.5"
      >
        <button
          type="button"
          aria-label={t(I18nKey.ORG_CHART$ZOOM_OUT)}
          disabled={zoom <= ORG_CHART_ZOOM.min}
          onClick={zoomOut}
          className={BUTTON}
        >
          <Minus width={14} height={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={t(I18nKey.ORG_CHART$ZOOM_RESET)}
          onClick={resetZoom}
          className={cn(BUTTON, "w-12 tabular-nums")}
        >
          {`${Math.round(zoom * 100)}%`}
        </button>
        <button
          type="button"
          aria-label={t(I18nKey.ORG_CHART$ZOOM_IN)}
          disabled={zoom >= ORG_CHART_ZOOM.max}
          onClick={zoomIn}
          className={BUTTON}
        >
          <Plus width={14} height={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
