import { describe, expect, it } from "vitest";
import { fitFocusedChart } from "#/components/features/org-chart/focused-chart";

const team = (reports: number, hasSubTeams = false, hasParent = true) => ({
  reports,
  hasParent,
  hasSubTeams,
});
const ROOMY = { width: 1100, height: 500 };

describe("fitFocusedChart", () => {
  it("keeps cards at their size and puts the reports in one row when they fit", () => {
    expect(fitFocusedChart(team(6, true), ROOMY)).toEqual({
      columns: 6,
      scale: 1,
    });
  });

  it("uses the fewest rows that fit, evened out, before it shrinks anything", () => {
    // Six fit in a row here; fifteen take three rows of five.
    expect(fitFocusedChart(team(15), ROOMY)).toEqual({ columns: 5, scale: 1 });
  });

  it("shrinks the chart only when no arrangement fits, and never enlarges it", () => {
    const tight = fitFocusedChart(team(15), { width: 700, height: 250 });
    expect(tight.scale).toBeLessThan(1);
    expect(tight.scale).toBeGreaterThanOrEqual(0.4);

    expect(fitFocusedChart(team(0), { width: 4000, height: 3000 })).toEqual({
      columns: 1,
      scale: 1,
    });
    expect(fitFocusedChart(team(2), { width: 4000, height: 3000 }).scale).toBe(
      1,
    );
  });

  it("shrinks a team without reports to a space smaller than its card", () => {
    expect(
      fitFocusedChart(team(0, false, false), { width: 80, height: 500 }),
    ).toEqual({ columns: 1, scale: 0.5 });
  });

  it("stops shrinking while names are still readable and lets the chart scroll", () => {
    const fit = fitFocusedChart(team(1000, true), ROOMY);

    expect(fit.scale).toBe(0.4);
    // As many to a row as fit across at that scale.
    expect(fit.columns).toBe(15);
  });

  it("draws at full size until the space is known", () => {
    expect(fitFocusedChart(team(15), { width: 0, height: 0 })).toEqual({
      columns: 15,
      scale: 1,
    });
  });
});
