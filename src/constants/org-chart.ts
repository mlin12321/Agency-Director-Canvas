import type { NodeId } from "#/api/director/types";

export const ORG_CHART_PATH = "/org";

/** Route to the chart with one node at its top; `null` is the root of the tree. */
export function orgNodePath(nodeId: NodeId | null) {
  return nodeId === null
    ? ORG_CHART_PATH
    : `${ORG_CHART_PATH}/${encodeURIComponent(nodeId)}`;
}
