import React from "react";
import {
  UNAPPLIED_COLOR_THEME,
  getActiveColorTheme,
  subscribeColorTheme,
} from "#/themes/color-themes";

export function useColorTheme() {
  return React.useSyncExternalStore(
    subscribeColorTheme,
    getActiveColorTheme,
    () => UNAPPLIED_COLOR_THEME,
  );
}
