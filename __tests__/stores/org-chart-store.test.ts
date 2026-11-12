import { beforeEach, describe, expect, it } from "vitest";
import { ORG_CHART_ZOOM, useOrgChartStore } from "#/stores/org-chart-store";

const STORAGE_KEY = "openhands-org-chart";

function restore(state: unknown) {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ state, version: 0 }),
  );
  return useOrgChartStore.persist.rehydrate();
}

describe("org-chart store", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useOrgChartStore.setState({ view: "focused", zoom: 1 });
  });

  it("restores the view and zoom of the last visit", async () => {
    await restore({ view: "full", zoom: 0.6 });

    expect(useOrgChartStore.getState()).toMatchObject({
      view: "full",
      zoom: 0.6,
    });
  });

  it.each([
    [
      { view: "sideways", zoom: "big" },
      { view: "focused", zoom: 1 },
    ],
    [{ zoom: 40 }, { view: "focused", zoom: ORG_CHART_ZOOM.max }],
    [
      { view: "full", zoom: 0.01 },
      { view: "full", zoom: ORG_CHART_ZOOM.min },
    ],
    [{ zoom: 0.74 }, { view: "focused", zoom: 0.7 }],
    [null, { view: "focused", zoom: 1 }],
  ])("falls back to usable values for a stored %j", async (state, expected) => {
    await restore(state);

    expect(useOrgChartStore.getState()).toMatchObject(expected);
  });

  it("steps the zoom by a tenth without drifting", () => {
    const { zoomOut, zoomIn } = useOrgChartStore.getState();

    for (let i = 0; i < 3; i += 1) zoomOut();
    expect(useOrgChartStore.getState().zoom).toBe(0.7);
    for (let i = 0; i < 20; i += 1) zoomIn();
    expect(useOrgChartStore.getState().zoom).toBe(ORG_CHART_ZOOM.max);
    for (let i = 0; i < 40; i += 1) zoomOut();
    expect(useOrgChartStore.getState().zoom).toBe(ORG_CHART_ZOOM.min);
  });
});
