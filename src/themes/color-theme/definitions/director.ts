import type { AgentServerUICssVariableName } from "#/styles/agent-server-ui-style-scope";
import type { ColorThemeDefinition } from "../types";
// Director inherits Light+ token values, overriding only what differs.
import { LIGHT_PLUS_HEROUI, LIGHT_PLUS_TOKENS } from "./light-plus";

const INK = "#000000";
const PAGE = "#FFFFFF";
// Drawn, never read: lines, rings and dots.
const BRIGHT_RED = "#E60012";
// Read as text, so it stays legible on the gray areas too.
const TEXT_RED = "#C00010";

const DIRECTOR_SCALE = {
  "--cool-grey-50": INK,
  "--cool-grey-100": "#0A0A0A",
  "--cool-grey-200": "#333333",
  "--cool-grey-300": "#474747",
  "--cool-grey-400": "#595959",
  "--cool-grey-500": "#666666",
  "--cool-grey-600": "#8A8A8A",
  "--cool-grey-700": "#D4D4D4",
  "--cool-grey-800": "#E5E5E5",
  "--cool-grey-900": "#EDEDED",
  "--cool-grey-925": "#F5F5F5",
  "--cool-grey-950": PAGE,
  "--cool-grey-975": "#FAFAFA",
};

const DIRECTOR_TOKENS: Partial<Record<AgentServerUICssVariableName, string>> = {
  ...LIGHT_PLUS_TOKENS,
  // White first: the page and every panel, the terminal's included.
  "--oh-color-base": PAGE,
  "--oh-background": PAGE,
  "--oh-surface": PAGE,
  "--oh-overlay": PAGE,
  "--oh-bg-workspace": PAGE,
  // Light gray marks an area within a panel.
  "--oh-color-base-secondary": "#F5F5F5",
  "--oh-surface-raised": "#F0F0F0",
  "--oh-surface-deep": "#F0F0F0",
  "--oh-color-tertiary": "#EBEBEB",
  "--oh-interactive-selected": "#E5E5E5",
  "--oh-segment": "#F5F5F5",
  "--oh-bg-light": "#F5F5F5",
  "--oh-bg-editor-sidebar": "#F5F5F5",
  "--oh-bg-editor-active": "#EBEBEB",
  // Black second: text, and primary actions in reverse.
  "--oh-color-primary": INK,
  "--oh-foreground": INK,
  "--oh-contrast": INK,
  "--oh-surface-foreground": INK,
  "--oh-overlay-foreground": INK,
  "--oh-modal-title-foreground": INK,
  "--oh-color-content": INK,
  "--oh-color-content-2": INK,
  "--oh-default-foreground": INK,
  "--oh-segment-foreground": INK,
  "--oh-context-window-foreground": INK,
  "--oh-text-editor-active": INK,
  "--oh-accent": INK,
  "--oh-accent-foreground": PAGE,
  // Notices that are neither good nor bad news stay in ink, not blue.
  "--oh-info": INK,
  "--oh-scrollbar": "rgba(0, 0, 0, 0.24)",
  "--oh-scrollbar-hover": "rgba(0, 0, 0, 0.4)",
  // Red last: lines and detail, and what you can follow or must notice.
  "--oh-line-accent": BRIGHT_RED,
  "--oh-focus": BRIGHT_RED,
  "--oh-color-logo": BRIGHT_RED,
  "--oh-status-error": BRIGHT_RED,
  "--oh-link": TEXT_RED,
  "--oh-color-danger": TEXT_RED,
  "--oh-danger": TEXT_RED,
  "--oh-feedback-error": TEXT_RED,
};

export const director: ColorThemeDefinition = {
  label: "Director",
  appearance: "light",
  scale: DIRECTOR_SCALE,
  heroui: LIGHT_PLUS_HEROUI,
  tokens: DIRECTOR_TOKENS,
};
