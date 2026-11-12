import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/** `focused`: one team and its direct reports. `full`: the whole org. */
export type OrgChartViewMode = "focused" | "full";

export const ORG_CHART_ZOOM = { min: 0.3, max: 2, step: 0.1, initial: 1 };

interface OrgChartState {
  view: OrgChartViewMode;
  /** Scale of the chart; 1 is actual size. */
  zoom: number;
}

interface OrgChartActions {
  setView: (view: OrgChartViewMode) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
}

/** Keeps zoom on a step and in range, whatever was stored. */
function toZoom(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return ORG_CHART_ZOOM.initial;
  }
  const { min, max, step } = ORG_CHART_ZOOM;
  const stepped = Math.round(value / step) * step;
  return Number(Math.min(max, Math.max(min, stepped)).toFixed(2));
}

/** How the org chart is drawn. Remembered across visits, per browser. */
export const useOrgChartStore = create<OrgChartState & OrgChartActions>()(
  persist(
    (set) => ({
      view: "focused",
      zoom: ORG_CHART_ZOOM.initial,
      setView: (view) => set({ view }),
      zoomIn: () =>
        set((state) => ({ zoom: toZoom(state.zoom + ORG_CHART_ZOOM.step) })),
      zoomOut: () =>
        set((state) => ({ zoom: toZoom(state.zoom - ORG_CHART_ZOOM.step) })),
      resetZoom: () => set({ zoom: ORG_CHART_ZOOM.initial }),
    }),
    {
      name: "openhands-org-chart",
      storage: createJSONStorage(() => localStorage),
      partialize: (state): OrgChartState => ({
        view: state.view,
        zoom: state.zoom,
      }),
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<OrgChartState>;
        return {
          ...current,
          view: stored.view === "full" ? "full" : "focused",
          zoom: toZoom(stored.zoom),
        };
      },
    },
  ),
);
