import React from "react";
import { useTranslation } from "react-i18next";
import type { OrgSummary } from "#/api/director/types";
import {
  AcpOrgUnsupportedError,
  useStartOrg,
} from "#/hooks/mutation/use-start-org";
import { I18nKey } from "#/i18n/declaration";

interface StartOrgFormProps {
  org: OrgSummary;
  /** Called once the org exists, so the page can follow it at once. */
  onStarted: () => void;
}

/**
 * What the chart shows while the director has no org: a task for the root
 * team, whose IC starts on it and splits the work into sub-teams as needed.
 */
export function StartOrgForm({ org, onStarted }: StartOrgFormProps) {
  const { t } = useTranslation("openhands");
  const [title, setTitle] = React.useState("");
  const [task, setTask] = React.useState("");
  const titleId = React.useId();
  const taskId = React.useId();
  const start = useStartOrg();
  const ready = title.trim() !== "" && task.trim() !== "";

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    start.mutate(
      { title: title.trim(), task: task.trim(), repoPath: org.repo_path },
      { onSuccess: onStarted },
    );
  };

  if (!org.is_git_repository) {
    return (
      <p role="alert" className="max-w-md text-sm text-muted">
        {t(I18nKey.ORG_CHART$START_NEEDS_GIT, { path: org.repo_path })}
      </p>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      aria-label={t(I18nKey.ORG_CHART$START_TITLE)}
      className="flex w-full max-w-md flex-col gap-3 text-left"
    >
      <p className="text-sm text-muted">
        {t(I18nKey.ORG_CHART$START_BODY, { path: org.repo_path })}
      </p>
      <label htmlFor={titleId} className="text-xs text-muted">
        {t(I18nKey.ORG_CHART$START_NAME_LABEL)}
      </label>
      <input
        id={titleId}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        className="rounded-md border border-border-input bg-field p-2 text-sm text-field-foreground"
      />
      <label htmlFor={taskId} className="text-xs text-muted">
        {t(I18nKey.ORG_CHART$START_TASK_LABEL)}
      </label>
      <textarea
        id={taskId}
        value={task}
        onChange={(event) => setTask(event.target.value)}
        rows={5}
        className="rounded-md border border-border-input bg-field p-2 text-sm text-field-foreground"
      />
      {start.isError ? (
        <p role="alert" className="text-xs text-feedback-error">
          {start.error instanceof AcpOrgUnsupportedError
            ? t(I18nKey.ORG_CHART$START_ACP_UNSUPPORTED)
            : t(I18nKey.ORG_CHART$START_FAILED, {
                reason: start.error.message,
              })}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={!ready || start.isPending}
        className="self-start rounded-md border border-border px-3 py-1.5 text-sm text-contrast hover:bg-surface-raised disabled:opacity-50"
      >
        {start.isPending
          ? t(I18nKey.ORG_CHART$START_STARTING)
          : t(I18nKey.ORG_CHART$START_SUBMIT)}
      </button>
    </form>
  );
}
