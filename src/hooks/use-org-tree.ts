import React from "react";
import {
  subscribeOrgTree,
  type OrgStreamStatus,
} from "#/api/director/director-client";
import type {
  NodeId,
  OpenEscalation,
  OrgEvent,
  OrgNode,
} from "#/api/director/types";

interface OrgTreeState {
  status: OrgStreamStatus;
  focusId: NodeId | null;
  nodes: ReadonlyMap<NodeId, OrgNode>;
  escalations: OpenEscalation[];
}

type OrgTreeAction =
  | { kind: "reset" }
  | { kind: "status"; status: OrgStreamStatus }
  | { kind: "event"; event: OrgEvent };

const INITIAL_STATE: OrgTreeState = {
  status: "connecting",
  focusId: null,
  nodes: new Map(),
  escalations: [],
};

function reduce(state: OrgTreeState, action: OrgTreeAction): OrgTreeState {
  if (action.kind === "reset") return INITIAL_STATE;
  // Terminal for this subscription: later frames about the node's former
  // ancestors must not bring a removed node back.
  if (state.status === "not_found") return state;
  if (action.kind === "status") {
    return state.status === action.status
      ? state
      : { ...state, status: action.status };
  }

  const { event } = action;
  switch (event.type) {
    case "snapshot":
      return {
        status: "live",
        focusId: event.focus_id,
        nodes: new Map(event.nodes.map((node) => [node.id, node])),
        escalations: event.escalations,
      };
    case "node_upsert": {
      const nodes = new Map(state.nodes);
      nodes.set(event.node.id, event.node);
      return { ...state, nodes };
    }
    case "node_removed": {
      // Losing the focused node means there is nothing left to show here.
      if (event.id === state.focusId) {
        return { ...state, status: "not_found" };
      }
      const nodes = new Map(state.nodes);
      nodes.delete(event.id);
      return { ...state, nodes };
    }
    case "escalations":
      return { ...state, escalations: event.escalations };
    default:
      return state;
  }
}

export interface OrgTreeView {
  status: OrgStreamStatus;
  /** The node at the top of the chart. */
  focus: OrgNode | null;
  /** Root first, excluding the focused node. */
  ancestors: OrgNode[];
  /** Every node the server has sent for the open part of the chart. */
  nodes: ReadonlyMap<NodeId, OrgNode>;
  /** Every open escalation at or below the focused node. */
  escalations: OpenEscalation[];
}

/**
 * Live view of the open part of an org chart: the node at its top
 * (`nodeId: null` is the root of the tree), that node's ancestors, and the
 * direct reports of it and of every node in `expanded`.
 *
 * Changing `expanded` keeps what is on screen until the server answers with
 * the new set; changing `nodeId` starts over.
 */
export function useOrgTree(
  nodeId: NodeId | null,
  expanded: readonly NodeId[] = [],
): OrgTreeView {
  const [state, dispatch] = React.useReducer(reduce, INITIAL_STATE);
  // Order does not matter to the server, so it must not cause a resubscribe.
  const expandedKey = JSON.stringify([...expanded].sort());
  const followed = React.useRef<NodeId | null | undefined>(undefined);

  React.useEffect(() => {
    if (followed.current !== nodeId) {
      followed.current = nodeId;
      dispatch({ kind: "reset" });
    }
    return subscribeOrgTree(
      nodeId,
      {
        onEvent: (event) => dispatch({ kind: "event", event }),
        onStatus: (status) => dispatch({ kind: "status", status }),
      },
      JSON.parse(expandedKey) as NodeId[],
    );
  }, [nodeId, expandedKey]);

  return React.useMemo(() => {
    const focus =
      state.focusId === null ? null : (state.nodes.get(state.focusId) ?? null);

    const ancestors: OrgNode[] = [];
    let parentId = focus?.parent_id ?? null;
    while (parentId !== null) {
      const parent = state.nodes.get(parentId);
      if (!parent) break;
      ancestors.unshift(parent);
      parentId = parent.parent_id;
    }

    return {
      status: state.status,
      focus,
      ancestors,
      nodes: state.nodes,
      escalations: state.escalations,
    };
  }, [state]);
}
