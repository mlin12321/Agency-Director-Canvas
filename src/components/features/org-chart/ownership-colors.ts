import type { NodeId } from "#/api/director/types";

// One hue per team, in this order. Each is stepped separately for light and
// dark surfaces; the set keeps neighbours apart for colour-blind readers.
// Tailwind only sees class names that are written out.
const SWATCHES = [
  "bg-[#2a78d6] dark:bg-[#3987e5]",
  "bg-[#eb6834] dark:bg-[#d95926]",
  "bg-[#1baf7a] dark:bg-[#199e70]",
  "bg-[#eda100] dark:bg-[#c98500]",
  "bg-[#e87ba4] dark:bg-[#d55181]",
  "bg-[#008300] dark:bg-[#008300]",
  "bg-[#6250d6] dark:bg-[#9085e9]",
  "bg-[#e34948] dark:bg-[#e66767]",
];
/** Teams past the last hue share this one; their names still tell them apart. */
const OTHER_SWATCH = "bg-muted";
/** What the team itself kept: an outline, not a hue. */
export const KEPT_SWATCH = "border border-border-input";

/**
 * The swatch of each team, by its place among the reports, so a team keeps
 * its colour while the list of reports does.
 */
export function ownerSwatches(owners: readonly NodeId[]) {
  return new Map(
    owners.map((id, index) => [id, SWATCHES[index] ?? OTHER_SWATCH]),
  );
}
