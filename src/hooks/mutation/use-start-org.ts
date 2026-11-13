import { useMutation, useQueryClient } from "@tanstack/react-query";
import { v4 as uuidv4 } from "uuid";
import {
  buildStartConversationRequestWithEncryptedSettings,
  buildWorkspaceTags,
} from "#/api/agent-server-adapter";
import { DirectorClient } from "#/api/director/director-client";
import type { OrgNode } from "#/api/director/types";
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

export interface StartOrgVariables {
  title: string;
  task: string;
  /** The director's directory, which the root team works in. */
  repoPath: string;
}

/**
 * Start an org whose root IC runs as a conversation of the active agent
 * profile, in its own worktree of the director's repository like any other
 * new conversation. The director derives every other agent from it.
 */
export function useStartOrg() {
  const queryClient = useQueryClient();
  const { backend, orgId } = useActiveBackend();

  return useMutation({
    meta: { disableToast: true },
    mutationFn: async ({
      title,
      task,
      repoPath,
    }: StartOrgVariables): Promise<OrgNode> => {
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
      return DirectorClient.createOrg({ title, task, conversation });
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: DIRECTOR_QUERY_KEYS.org(backend.id),
      }),
  });
}
