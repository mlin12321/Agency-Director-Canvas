import React from "react";
import { ConversationOverviewDrawerProvider } from "#/components/features/conversation/conversation-overview-drawer-context";
import { WebSocketProviderWrapper } from "#/contexts/websocket-provider-wrapper";
import { useAgentStore } from "#/stores/agent-store";
import { useConversationStateStore } from "#/stores/conversation-state-store";
import { useConversationStore } from "#/stores/conversation-store";
import { useErrorMessageStore } from "#/stores/error-message-store";
import { AgentState } from "#/types/agent-state";
import { EventHandler } from "#/wrapper/event-handler";

interface ConversationSurfaceProps {
  conversationId: string;
  children: React.ReactNode;
}

/**
 * Everything a live conversation's UI needs around it, and nothing that
 * belongs to a page: the per-conversation state resets, the socket and the
 * event handling. It never navigates and never records the conversation as
 * the one last visited, so it can be mounted outside the conversation route.
 * Conversation state is a single global "active" conversation, so exactly
 * one surface may be mounted at a time.
 */
export function ConversationSurface({
  conversationId,
  children,
}: ConversationSurfaceProps) {
  const { resetConversationState } = useConversationStore();
  const resetConversationRuntimeState = useConversationStateStore(
    (state) => state.reset,
  );
  const setCurrentAgentState = useAgentStore(
    (state) => state.setCurrentAgentState,
  );
  const removeErrorMessage = useErrorMessageStore(
    (state) => state.removeErrorMessage,
  );
  const resetForConversation = React.useRef<string | null>(null);

  // Per-conversation UI/runtime resets. The event store is cleared separately,
  // inside ConversationWebSocketProvider, so the clear is ordered *before* the
  // preloaded-history re-seed (see the note there) — clearing it here would run
  // too late and wipe the freshly seeded history on a conversation switch.
  React.useEffect(() => {
    if (resetForConversation.current === conversationId) return;
    resetForConversation.current = conversationId;
    resetConversationState();
    resetConversationRuntimeState();
    setCurrentAgentState(AgentState.LOADING);
    removeErrorMessage();
  }, [
    conversationId,
    resetConversationState,
    resetConversationRuntimeState,
    setCurrentAgentState,
    removeErrorMessage,
  ]);

  return (
    <WebSocketProviderWrapper conversationId={conversationId}>
      <EventHandler>
        <ConversationOverviewDrawerProvider>
          {children}
        </ConversationOverviewDrawerProvider>
      </EventHandler>
    </WebSocketProviderWrapper>
  );
}
