import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import AgentServerConversationService from "#/api/conversation-service/agent-server-conversation-service.api";
import { LAST_CONVERSATION_STORAGE_KEY } from "#/api/backend-registry/last-conversation-store";
import { AgentConversation } from "#/components/features/org-chart/agent-conversation";
import { useNavigation } from "#/context/navigation-context";
import { useActiveConversation } from "#/hooks/query/use-active-conversation";
import { useAgentStore } from "#/stores/agent-store";
import { AgentState } from "#/types/agent-state";
import { displayErrorToast } from "#/utils/custom-toast-handlers";
import { renderWithProviders } from "test-utils";

vi.mock(
  "#/api/conversation-service/agent-server-conversation-service.api",
  () => ({ default: { batchGetAppConversations: vi.fn() } }),
);
// The chat stack needs a live agent server; this stand-in asks for the
// conversation the way the real one does.
vi.mock(
  "#/components/features/conversation/conversation-main/conversation-main",
  () => ({
    ConversationMain: () => {
      const { conversationId } = useNavigation();
      const { isSuccess, data } = useActiveConversation();
      return (
        <div data-testid="conversation-main">
          {conversationId}:{isSuccess && !data ? "missing" : "pending"}
        </div>
      );
    },
  }),
);
vi.mock("#/wrapper/event-handler", () => ({
  EventHandler: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("#/contexts/websocket-provider-wrapper", () => ({
  WebSocketProviderWrapper: ({ children }: { children: React.ReactNode }) =>
    children,
}));
vi.mock("#/hooks/query/use-is-authed", () => ({
  useIsAuthed: () => ({ data: true }),
}));
vi.mock("#/utils/custom-toast-handlers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#/utils/custom-toast-handlers")>()),
  displayErrorToast: vi.fn(),
}));

const navigate = vi.fn();

function renderOnOrgPage(conversationId: string) {
  return renderWithProviders(
    <AgentConversation conversationId={conversationId} />,
    { navigation: { currentPath: "/org/auth", conversationId: "", navigate } },
  );
}

beforeEach(() => {
  window.localStorage.clear();
  navigate.mockReset();
  vi.mocked(displayErrorToast).mockReset();
  vi.mocked(
    AgentServerConversationService.batchGetAppConversations,
  ).mockReset();
});

describe("AgentConversation", () => {
  it("shows the agent's conversation, starting from a clean conversation state", async () => {
    vi.mocked(
      AgentServerConversationService.batchGetAppConversations,
    ).mockResolvedValue([null]);
    useAgentStore.setState({ curAgentState: AgentState.RUNNING });

    renderOnOrgPage("conv-ic");

    expect(await screen.findByTestId("conversation-main")).toHaveTextContent(
      "conv-ic",
    );
    expect(useAgentStore.getState().curAgentState).toBe(AgentState.LOADING);
  });

  it("stays on the org page and remembers nothing when the conversation is gone", async () => {
    vi.mocked(
      AgentServerConversationService.batchGetAppConversations,
    ).mockResolvedValue([null]);

    renderOnOrgPage("conv-gone");

    expect(await screen.findByText("conv-gone:missing")).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
    expect(displayErrorToast).not.toHaveBeenCalled();
    expect(
      window.localStorage.getItem(LAST_CONVERSATION_STORAGE_KEY),
    ).toBeNull();
  });
});
