import type { ColorThemeDefinition, ColorThemeKey } from "../types";
import { openhandsDeepsea } from "./openhands-deepsea";
import { openhandsNeutral } from "./openhands-neutral";
import { openhandsNeo } from "./openhands-neo";
import { lightPlus } from "./light-plus";
import { solarizedLight } from "./solarized-light";
import { paper } from "./paper";
import { director } from "./director";

/**
 * The theme registry.
 *
 * To add a theme: create a sibling module exporting a `ColorThemeDefinition`,
 * add its key to `ColorThemeKey` in `../types.ts`, and register it below.
 */
export const COLOR_THEMES: Record<ColorThemeKey, ColorThemeDefinition> = {
  "openhands-deepsea": openhandsDeepsea,
  "openhands-neutral": openhandsNeutral,
  "openhands-neo": openhandsNeo,
  "light-plus": lightPlus,
  "solarized-light": solarizedLight,
  paper,
  director,
};

/** What the app applies when the reader has not chosen a palette. */
export const DEFAULT_COLOR_THEME: ColorThemeKey = "director";

/**
 * What a root reports before any palette is applied: the stylesheet's own
 * dark defaults. An embedded root that never applies one stays on these.
 */
export const UNAPPLIED_COLOR_THEME: ColorThemeKey = "openhands-neutral";

export const AVAILABLE_COLOR_THEMES = Object.entries(COLOR_THEMES).map(
  ([key, def]) => ({ key: key as ColorThemeKey, label: def.label }),
);
