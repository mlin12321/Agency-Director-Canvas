import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { DirectorClient } from "#/api/director/director-client";
import type { NodeBlackboard, OrgNode } from "#/api/director/types";
import { useActiveBackend } from "#/contexts/active-backend-context";
import { DIRECTOR_QUERY_KEYS } from "#/hooks/query/query-keys";
import { I18nKey } from "#/i18n/declaration";

interface BoundaryMemoryProps {
  node: OrgNode;
}

/**
 * The permanent rules attached to a node's boundary, and the "teach" form
 * that turns a human correction into a new one.
 */
export function BoundaryMemory({ node }: BoundaryMemoryProps) {
  const { t } = useTranslation("openhands");
  const { backend } = useActiveBackend();
  const queryClient = useQueryClient();
  const queryKey = DIRECTOR_QUERY_KEYS.blackboard(backend.id, node.id);
  const [draft, setDraft] = React.useState("");
  const inputId = React.useId();

  const blackboard = useQuery({
    queryKey,
    queryFn: () => DirectorClient.getNodeBlackboard(node.id),
    retry: false,
  });

  const teach = useMutation({
    mutationFn: (rule: string) => DirectorClient.teach(node.id, rule),
    onSuccess: (memory) => {
      queryClient.setQueryData<NodeBlackboard>(queryKey, (current) =>
        current ? { ...current, memory } : current,
      );
      setDraft("");
    },
  });

  const rule = draft.trim();
  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (rule) teach.mutate(rule);
  };

  let body: React.ReactNode;
  if (blackboard.isPending) {
    body = null;
  } else if (blackboard.isError) {
    body = (
      <p role="alert" className="text-xs text-feedback-error">
        {t(I18nKey.ORG_CHART$MEMORY_UNAVAILABLE)}
      </p>
    );
  } else {
    const { rules } = blackboard.data.memory;
    body = (
      <>
        {rules.length === 0 ? (
          <p className="text-xs text-muted">
            {t(I18nKey.ORG_CHART$MEMORY_EMPTY)}
          </p>
        ) : (
          <ul className="flex list-disc flex-col gap-1 pl-4 text-xs text-text-secondary">
            {rules.map((existing) => (
              <li key={existing}>{existing}</li>
            ))}
          </ul>
        )}
        <form onSubmit={onSubmit} className="flex flex-col gap-2">
          <label htmlFor={inputId} className="text-xs text-muted">
            {t(I18nKey.ORG_CHART$TEACH_LABEL)}
          </label>
          <textarea
            id={inputId}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={2}
            className="rounded-md border border-border-input bg-field p-2 text-sm text-field-foreground"
          />
          {teach.isError ? (
            <p role="alert" className="text-xs text-feedback-error">
              {t(I18nKey.ORG_CHART$TEACH_ERROR)}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={!rule || teach.isPending}
            className="self-start rounded-md border border-border px-2.5 py-1 text-sm text-contrast hover:bg-surface-raised disabled:opacity-50"
          >
            {t(I18nKey.ORG_CHART$TEACH_SUBMIT)}
          </button>
        </form>
      </>
    );
  }

  return (
    <section
      aria-label={t(I18nKey.ORG_CHART$MEMORY_TITLE)}
      className="flex flex-col gap-2"
    >
      <h3 className="text-sm font-medium text-contrast">
        {t(I18nKey.ORG_CHART$MEMORY_TITLE)}
      </h3>
      {body}
    </section>
  );
}
