import { describe, expect, it } from "vitest";
import {
  AVAILABLE_COLOR_THEMES,
  COLOR_THEMES,
  DEFAULT_COLOR_THEME,
} from "#/themes/color-themes";
import { contrast, surfaceColor } from "./theme-color-resolver";

const WHITE = surfaceColor("director", "--oh-color-base");

describe("Director palette", () => {
  it("is what a reader without a chosen palette gets", () => {
    expect(DEFAULT_COLOR_THEME).toBe("director");
    expect(COLOR_THEMES.director.appearance).toBe("light");
  });

  it.each(["--oh-background", "--oh-surface", "--oh-overlay"] as const)(
    "paints %s white",
    (surface) => {
      expect(COLOR_THEMES.director.tokens?.[surface]).toBe("#FFFFFF");
    },
  );

  it.each([
    "--oh-foreground",
    "--oh-contrast",
    "--oh-surface-foreground",
  ] as const)("prints %s in black", (ink) => {
    expect(COLOR_THEMES.director.tokens?.[ink]).toBe("#000000");
  });

  it("draws joining lines in a red that stands out from the page", () => {
    const line = surfaceColor("director", "--oh-line-accent");
    expect(line).not.toEqual(surfaceColor("director", "--oh-border"));
    expect(contrast(line, WHITE)).toBeGreaterThanOrEqual(3);
  });

  it.each(
    AVAILABLE_COLOR_THEMES.filter(({ key }) => key !== "director").map(
      ({ key }) => key,
    ),
  )("leaves the joining lines of %s on its border colour", (theme) => {
    expect(surfaceColor(theme, "--oh-line-accent")).toEqual(
      surfaceColor(theme, "--oh-border"),
    );
  });
});
