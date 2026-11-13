import { useMutation, useQueryClient } from "@tanstack/react-query";
import { v4 as uuidv4 } from "uuid";
import {
  buildStartConversationRequestWithEncryptedSettings,
  buildWorkspaceTags,
} from "#/api/agent-server-adapter";
import { DirectorClient } from "#/api/director/director-client";
import type { RoutedMessage } from "#/api/director/types";
import SettingsService from "#/api/settings-service/settings-service.api";
import { useActiveBackend } from "#/contexts/active-backend-context";
import { DIRECTOR_QUERY_KEYS } from "#/hooks/query/query-keys";
import {
  assertLaunchLlmReady,
  resolveConversationLaunch,
} from "#/hooks/mutation/resolve-conversation-launch";

/** An org's agents use tools only the Agent Server's own agent can be given. */
export class AcpOrgUnsupportedError extends Error {
  constructor() {
    super("An org cannot be led by an ACP agent profile");
    this.name = "AcpOrgUnsupportedError";
  }
}

export interface SendToOrgVariables {
  text: string;
  /** The folder the message is about, repo-relative. Default: the root. */
  path?: string;
  /**
   * The director's directory, given when there is no org yet: the message
   * then starts one there.
   */
  startIn?: string;
}

/**
 * Send a message to the org. The director hands it to the nearest team at or
 * above `path`.
 *
 * With `startIn` the message is also able to start the org: its root IC then
 * runs as a conversation of the active agent profile, in its own worktree of
 * the director's repository like any other new conversation, and the
 * director derives every other agent from it.
 */
export function useSendToOrg() {
  const queryClient = useQueryClient();
  const { backend, orgId } = useActiveBackend();

  const rootConversation = async (repoPath: string) => {
    const launch = await resolveConversationLaunch({
      queryClient,
      backendId: backend.id,
      orgId,
      isCloud: false,
    });
    if (!launch.agentProfileId) {
      throw new Error("A local conversation needs an agent profile.");
    }
    if (launch.agentProfileKind === "acp") throw new AcpOrgUnsupportedError();
    if (launch.llmProfile) await assertLaunchLlmReady(launch.llmProfile);

    const conversation =
      await buildStartConversationRequestWithEncryptedSettings({
        settings: await SettingsService.getSettings(),
        conversationId: uuidv4(),
        workingDir: repoPath,
        hooksProjectDir: repoPath,
        worktree: true,
        agentProfileId: launch.agentProfileId,
        agentProfileKind: launch.agentProfileKind,
        llmProfileOverride: launch.llmProfileOverride,
        profileHasRouter: launch.profileHasRouter,
        titleLlmProfile: launch.llmProfile,
      });
    conversation.tags = {
      ...(conversation.tags as Record<string, string> | undefined),
      ...buildWorkspaceTags(repoPath),
    };
    return conversation;
  };

  return useMutation({
    meta: { disableToast: true },
    mutationFn: async ({
      text,
      path,
      startIn,
    }: SendToOrgVariables): Promise<RoutedMessage> =>
      DirectorClient.routeMessage({
        text,
        ...(path ? { path } : {}),
        ...(startIn ? { conversation: await rootConversation(startIn) } : {}),
      }),
    onSuccess: (routed) =>
      routed.started_org
        ? queryClient.invalidateQueries({
            queryKey: DIRECTOR_QUERY_KEYS.org(backend.id),
          })
        : undefined,
  });
}
