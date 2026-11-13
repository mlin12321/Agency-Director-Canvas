import { describe, expect, it } from "vitest";
import { fitFocusedChart } from "#/components/features/org-chart/focused-chart";

const team = (reports: number, hasSubTeams = false, hasParent = true) => ({
  reports,
  hasParent,
  hasSubTeams,
});
const ROOMY = { width: 1100, height: 500 };

describe("fitFocusedChart", () => {
  it("zooms a team to the width it has when one row is the largest it gets", () => {
    // Six in a row are 1040 wide and 229 tall.
    const fit = fitFocusedChart(team(6, true), { width: 1300, height: 300 });

    expect(fit.columns).toBe(6);
    expect(fit.scale).toBeCloseTo(1.25);
  });

  it("wraps the reports into rows when that makes the team larger", () => {
    // One row of fifteen would be 0.38; three rows of five are 864 by 381.
    const fit = fitFocusedChart(team(15), { width: 1000, height: 500 });

    expect(fit.columns).toBe(5);
    expect(fit.scale).toBeCloseTo(1000 / 864);
  });

  it("enlarges a small team by a quarter and no further, in one row", () => {
    const vast = { width: 4000, height: 3000 };

    expect(fitFocusedChart(team(0), vast)).toEqual({ columns: 1, scale: 1.25 });
    expect(fitFocusedChart(team(3), vast)).toEqual({ columns: 3, scale: 1.25 });
  });

  it("shrinks a team that does not fit at its own size", () => {
    const tight = fitFocusedChart(team(15), { width: 700, height: 250 });

    expect(tight.scale).toBeLessThan(1);
    expect(tight.scale).toBeGreaterThanOrEqual(0.4);
  });

  it("shrinks a team without reports to a space smaller than its card", () => {
    expect(
      fitFocusedChart(team(0, false, false), { width: 80, height: 500 }),
    ).toEqual({ columns: 1, scale: 0.5 });
  });

  it("stops shrinking while names are readable and lets the chart scroll", () => {
    const fit = fitFocusedChart(team(1000, true), ROOMY);

    expect(fit.scale).toBe(0.4);
    // As many to a row as fit across at that scale.
    expect(fit.columns).toBe(15);
  });

  it("does not zoom until the space is known", () => {
    expect(fitFocusedChart(team(15), { width: 0, height: 0 })).toEqual({
      columns: 15,
      scale: 1,
    });
  });
});
