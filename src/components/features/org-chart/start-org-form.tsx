import React from "react";
import { useTranslation } from "react-i18next";
import type { OrgSummary, RoutedMessage } from "#/api/director/types";
import {
  AcpOrgUnsupportedError,
  useSendToOrg,
} from "#/hooks/mutation/use-send-to-org";
import { I18nKey } from "#/i18n/declaration";

interface StartOrgFormProps {
  org: OrgSummary;
  /** Called once the org exists, with the team that took the message. */
  onStarted: (routed: RoutedMessage) => void;
}

/**
 * What the chart shows while the director has no org: room for a first
 * message. Sending it starts the org: a root team takes the message as its
 * task, is named from it, and splits the work into sub-teams as needed.
 */
export function StartOrgForm({ org, onStarted }: StartOrgFormProps) {
  const { t } = useTranslation("openhands");
  const [text, setText] = React.useState("");
  const textId = React.useId();
  const send = useSendToOrg();
  const ready = text.trim() !== "";

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    send.mutate(
      { text: text.trim(), startIn: org.repo_path },
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
      <label htmlFor={textId} className="text-xs text-muted">
        {t(I18nKey.ORG_CHART$START_TASK_LABEL)}
      </label>
      <textarea
        id={textId}
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={5}
        className="rounded-md border border-border-input bg-field p-2 text-sm text-field-foreground"
      />
      {send.isError ? (
        <p role="alert" className="text-xs text-feedback-error">
          {send.error instanceof AcpOrgUnsupportedError
            ? t(I18nKey.ORG_CHART$START_ACP_UNSUPPORTED)
            : t(I18nKey.ORG_CHART$START_FAILED, {
                reason: send.error.message,
              })}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={!ready || send.isPending}
        className="self-start rounded-md border border-border px-3 py-1.5 text-sm text-contrast hover:bg-surface-raised disabled:opacity-50"
      >
        {send.isPending
          ? t(I18nKey.ORG_CHART$START_STARTING)
          : t(I18nKey.ORG_CHART$START_SUBMIT)}
      </button>
    </form>
  );
}
