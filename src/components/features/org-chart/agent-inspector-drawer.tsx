import React from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AgentRef, OrgNode } from "#/api/director/types";
import {
  NavigationProvider,
  useNavigation,
} from "#/context/navigation-context";
import { I18nKey } from "#/i18n/declaration";
import { BoundaryMemory } from "./boundary-memory";
import { ROLE_LABEL_KEYS } from "./org-chart-presentation";

// The conversation view pulls in the chat, terminal and diff stack, so it
// only loads once an agent with a live conversation is inspected.
const ConversationView = React.lazy(() =>
  import("#/routes/conversation").then((module) => ({
    default: module.ConversationView,
  })),
);

/**
 * Mounts the stock conversation view for one agent by re-targeting the
 * navigation context. Conversation state is a single global "active"
 * conversation, so exactly one of these may be mounted at a time.
 */
function InspectedConversation({ conversationId }: { conversationId: string }) {
  const navigation = useNavigation();
  const value = React.useMemo(
    () => ({ ...navigation, conversationId }),
    [navigation, conversationId],
  );
  return (
    <NavigationProvider value={value}>
      <React.Suspense fallback={null}>
        <ConversationView />
      </React.Suspense>
    </NavigationProvider>
  );
}

interface AgentInspectorDrawerProps {
  node: OrgNode;
  agent: AgentRef;
  onClose: () => void;
}

export function AgentInspectorDrawer({
  node,
  agent,
  onClose,
}: AgentInspectorDrawerProps) {
  const { t } = useTranslation("openhands");
  const roleLabel = t(ROLE_LABEL_KEYS[agent.role]);
  const titleId = React.useId();

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <aside
      role="dialog"
      aria-labelledby={titleId}
      className="flex h-full w-1/2 max-w-2xl shrink-0 flex-col border-l border-border bg-surface"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border p-3">
        <h2 id={titleId} className="min-w-0 truncate text-sm text-contrast">
          <span className="font-medium">{roleLabel}</span>
          <span className="text-muted">
            {" · "}
            {node.title}
          </span>
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t(I18nKey.ORG_CHART$INSPECTOR_CLOSE)}
          className="rounded-md p-1 text-muted hover:bg-surface-raised hover:text-contrast"
        >
          <X width={16} height={16} aria-hidden="true" />
        </button>
      </div>

      <div className="border-b border-border p-3">
        <BoundaryMemory node={node} />
      </div>

      <div className="min-h-0 flex-1">
        {agent.conversationId ? (
          <InspectedConversation
            key={agent.conversationId}
            conversationId={agent.conversationId}
          />
        ) : (
          <p className="p-6 text-center text-sm text-muted">
            {t(I18nKey.ORG_CHART$NO_CONVERSATION)}
          </p>
        )}
      </div>
    </aside>
  );
}
