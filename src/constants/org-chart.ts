import type { NodeId } from "#/api/director/types";

export const ORG_CHART_PATH = "/org";

/** Route to one node's workspace; `null` is the root of the tree. */
export function orgNodePath(nodeId: NodeId | null) {
  return nodeId === null
    ? ORG_CHART_PATH
    : `${ORG_CHART_PATH}/${encodeURIComponent(nodeId)}`;
}
