import React from "react";
import {
  subscribeOrgTree,
  type OrgStreamStatus,
} from "#/api/director/director-client";
import type { NodeId, OrgEvent, OrgNode } from "#/api/director/types";

interface OrgTreeState {
  status: OrgStreamStatus;
  focusId: NodeId | null;
  nodes: ReadonlyMap<NodeId, OrgNode>;
}

type OrgTreeAction =
  | { kind: "reset" }
  | { kind: "status"; status: OrgStreamStatus }
  | { kind: "event"; event: OrgEvent };

const INITIAL_STATE: OrgTreeState = {
  status: "connecting",
  focusId: null,
  nodes: new Map(),
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
    default:
      return state;
  }
}

export interface OrgTreeView {
  status: OrgStreamStatus;
  focus: OrgNode | null;
  /** Root first, excluding the focused node. */
  ancestors: OrgNode[];
  reports: OrgNode[];
}

/**
 * Live view of one org node: the node, its ancestors and its direct reports.
 * `nodeId: null` follows the root of the tree.
 */
export function useOrgTree(nodeId: NodeId | null): OrgTreeView {
  const [state, dispatch] = React.useReducer(reduce, INITIAL_STATE);

  React.useEffect(() => {
    dispatch({ kind: "reset" });
    return subscribeOrgTree(nodeId, {
      onEvent: (event) => dispatch({ kind: "event", event }),
      onStatus: (status) => dispatch({ kind: "status", status }),
    });
  }, [nodeId]);

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

    const reports = (focus?.child_ids ?? []).flatMap((childId) => {
      const child = state.nodes.get(childId);
      return child ? [child] : [];
    });

    return { status: state.status, focus, ancestors, reports };
  }, [state]);
}
