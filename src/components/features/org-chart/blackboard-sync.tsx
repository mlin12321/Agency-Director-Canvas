import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { DirectorClient } from "#/api/director/director-client";
import type { BlackboardSync as SyncResult } from "#/api/director/types";
import { I18nKey } from "#/i18n/declaration";

const BUTTON =
  "flex h-7 items-center justify-center rounded-md px-2 text-xs text-text-secondary hover:bg-surface-raised hover:text-contrast disabled:opacity-40 disabled:hover:bg-transparent";

function outcomeKey(result: SyncResult) {
  if (result.pushed) return I18nKey.ORG_CHART$BLACKBOARD_PUSHED;
  return result.changed
    ? I18nKey.ORG_CHART$BLACKBOARD_PULLED
    : I18nKey.ORG_CHART$BLACKBOARD_UP_TO_DATE;
}

/**
 * Shares the org's specs, contracts and rules with the repository's
 * `origin`. Nothing is shared until one of the two is pressed.
 */
export function BlackboardSync() {
  const { t } = useTranslation("openhands");
  const queryClient = useQueryClient();
  const sync = useMutation({
    mutationFn: (direction: "pull" | "push") =>
      direction === "pull"
        ? DirectorClient.pullBlackboard()
        : DirectorClient.pushBlackboard(),
    onSuccess: (result) => {
      if (result.changed) {
        queryClient.invalidateQueries({ queryKey: ["director", "blackboard"] });
      }
    },
    meta: { disableToast: true },
  });
  const result = sync.data;

  return (
    <div className="flex items-center gap-2">
      <div
        role="group"
        aria-label={t(I18nKey.ORG_CHART$SHARED_MEMORY)}
        className="flex items-center rounded-lg border border-border p-0.5"
      >
        <span className="px-2 text-xs text-muted">
          {t(I18nKey.ORG_CHART$SHARED_MEMORY)}
        </span>
        <button
          type="button"
          disabled={sync.isPending}
          onClick={() => sync.mutate("pull")}
          className={BUTTON}
        >
          {t(I18nKey.ORG_CHART$BLACKBOARD_PULL)}
        </button>
        <button
          type="button"
          disabled={sync.isPending}
          onClick={() => sync.mutate("push")}
          className={BUTTON}
        >
          {t(I18nKey.ORG_CHART$BLACKBOARD_PUSH)}
        </button>
      </div>
      {sync.isError ? (
        <span role="alert" className="text-xs text-feedback-error">
          {t(I18nKey.ORG_CHART$BLACKBOARD_ERROR)}
        </span>
      ) : null}
      {result && !sync.isError ? (
        <span role="status" className="text-xs text-muted">
          {t(outcomeKey(result), { remote: result.remote })}
          {result.kept_local.length > 0 ? (
            <span className="text-feedback-warning">
              {" "}
              {t(I18nKey.ORG_CHART$BLACKBOARD_KEPT_LOCAL, {
                paths: result.kept_local.join(", "),
              })}
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
