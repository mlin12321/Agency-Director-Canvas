import React from "react";
import { useTranslation } from "react-i18next";
import type { OrgNode, RoutedMessage } from "#/api/director/types";
import { useSendToOrg } from "#/hooks/mutation/use-send-to-org";
import { I18nKey } from "#/i18n/declaration";

const FIELD_CLASS =
  "rounded-md border border-border-input bg-field px-2 py-1.5 text-sm text-field-foreground";

interface AskOrgFormProps {
  /** The team the page is on; a message starts out from its folder. */
  node: OrgNode;
  /** Title of a team by id, when the page has it. */
  titleOf: (id: string) => string;
  /** Called with the team that took the message. */
  onSent: (routed: RoutedMessage) => void;
}

/**
 * A message to the org from a folder of the repository. The director hands
 * it to the nearest team at or above that folder, so the human does not have
 * to know which team owns what.
 */
export function AskOrgForm({ node, titleOf, onSent }: AskOrgFormProps) {
  const { t } = useTranslation("openhands");
  const [text, setText] = React.useState("");
  const [path, setPath] = React.useState(node.boundary.path);
  const textId = React.useId();
  const pathId = React.useId();
  const hintId = React.useId();
  const send = useSendToOrg();
  const ready = text.trim() !== "";

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    send.mutate(
      { text: text.trim(), path: path.trim() },
      {
        onSuccess: (routed) => {
          setText("");
          onSent(routed);
        },
      },
    );
  };

  return (
    <form
      onSubmit={onSubmit}
      aria-label={t(I18nKey.ORG_CHART$ASK_LABEL)}
      className="flex flex-col gap-1"
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex w-48 flex-col gap-1">
          <label htmlFor={pathId} className="text-xs text-muted">
            {t(I18nKey.ORG_CHART$ASK_PATH_LABEL)}
          </label>
          <input
            id={pathId}
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder={t(I18nKey.ORG_CHART$BOUNDARY_ROOT)}
            aria-describedby={
              send.isError || send.isSuccess ? undefined : hintId
            }
            spellCheck={false}
            className={`${FIELD_CLASS} font-mono`}
          />
        </div>
        <div className="flex min-w-48 flex-1 flex-col gap-1">
          <label htmlFor={textId} className="text-xs text-muted">
            {t(I18nKey.ORG_CHART$ASK_LABEL)}
          </label>
          <input
            id={textId}
            value={text}
            onChange={(event) => setText(event.target.value)}
            className={FIELD_CLASS}
          />
        </div>
        <button
          type="submit"
          disabled={!ready || send.isPending}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-contrast hover:bg-surface-raised disabled:opacity-50"
        >
          {send.isPending
            ? t(I18nKey.ORG_CHART$ASK_SENDING)
            : t(I18nKey.ORG_CHART$ASK_SEND)}
        </button>
      </div>
      {send.isError ? (
        <p role="alert" className="text-xs text-feedback-error">
          {t(I18nKey.ORG_CHART$ASK_FAILED, { reason: send.error.message })}
        </p>
      ) : null}
      {send.isSuccess ? (
        <p role="status" className="text-xs text-muted">
          {t(I18nKey.ORG_CHART$ASK_SENT, { team: titleOf(send.data.node_id) })}
        </p>
      ) : null}
      {send.isError || send.isSuccess ? null : (
        <p id={hintId} className="text-xs text-muted">
          {t(I18nKey.ORG_CHART$ASK_HINT)}
        </p>
      )}
    </form>
  );
}
