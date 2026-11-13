import { useQuery } from "@tanstack/react-query";
import { DirectorClient } from "#/api/director/director-client";
import type { NodeId } from "#/api/director/types";
import { useActiveBackend } from "#/contexts/active-backend-context";
import { DIRECTOR_QUERY_KEYS } from "#/hooks/query/query-keys";

/** What a team works to: its spec, its contracts, its rules, its autopsies. */
export function useNodeBlackboard(nodeId: NodeId) {
  const { backend } = useActiveBackend();
  return useQuery({
    queryKey: DIRECTOR_QUERY_KEYS.blackboard(backend.id, nodeId),
    queryFn: () => DirectorClient.getNodeBlackboard(nodeId),
    retry: false,
  });
}
