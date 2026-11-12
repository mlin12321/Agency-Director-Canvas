import { getEffectiveLocalBackend } from "../backend-registry/active-store";
import {
  DIRECTOR_BASE_PATH,
  type BoundaryMemory,
  type NodeBlackboard,
  type NodeId,
  type OrgEvent,
} from "./types";

const SESSION_KEY_HEADER = "X-Session-API-Key";
const TREE_STREAM_PATH = "/org/tree-stream";
const NODE_QUERY_PARAM = "node";
const EXPANDED_QUERY_PARAM = "expanded";
const RETRY_DELAYS_MS = [1000, 2000, 5000];

export class DirectorError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "DirectorError";
  }
}

/** The director API is served by a local Agent Server; Cloud has none. */
function resolveDirector() {
  const backend = getEffectiveLocalBackend();
  if (!backend) {
    throw new DirectorError("No local backend is active", null);
  }
  const apiKey = backend.apiKey?.trim();
  const headers: Record<string, string> = apiKey
    ? { [SESSION_KEY_HEADER]: apiKey }
    : {};
  return {
    baseUrl: `${backend.host.replace(/\/+$/, "")}${DIRECTOR_BASE_PATH}`,
    headers,
  };
}

function nodePath(nodeId: NodeId, action: string) {
  return `/org/nodes/${encodeURIComponent(nodeId)}/${action}`;
}

async function requestJson<T>(path: string, init: RequestInit = {}) {
  const { baseUrl, headers } = resolveDirector();
  const url = `${baseUrl}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: { ...headers, ...init.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new DirectorError(
      typeof body?.detail === "string" ? body.detail : response.statusText,
      response.status,
    );
  }
  return (await response.json()) as T;
}

export const DirectorClient = {
  getNodeBlackboard(nodeId: NodeId) {
    return requestJson<NodeBlackboard>(nodePath(nodeId, "blackboard"));
  },

  teach(nodeId: NodeId, rule: string) {
    return requestJson<BoundaryMemory>(nodePath(nodeId, "teach"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rule }),
    });
  },
};

export type OrgStreamStatus =
  /** First connection attempt is in flight. */
  | "connecting"
  | "live"
  /** Was live, lost the connection, retrying. */
  | "reconnecting"
  /** The backend cannot be reached or has no org tree; still retrying. */
  | "unavailable"
  /** The requested node does not exist. Not retried. */
  | "not_found";

export interface OrgStreamHandlers {
  onEvent: (event: OrgEvent) => void;
  onStatus: (status: OrgStreamStatus) => void;
}

/**
 * Feed decoded text in; get each complete server-sent event's `data` out.
 * Comment frames (heartbeats) and frames without data are dropped.
 */
function createSseDecoder(onData: (data: string) => void) {
  let buffer = "";
  return (chunk: string) => {
    buffer += chunk.replaceAll("\r\n", "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).replace(/^ /, ""))
        .join("\n");
      if (data) onData(data);
      boundary = buffer.indexOf("\n\n");
    }
  };
}

/**
 * Follow the part of the org tree a chart has open: the node at its top
 * (`nodeId: null` is the root of the tree) and the reports of every node in
 * `expanded`. Expanding or collapsing a node means subscribing again.
 *
 * The connection is re-established with backoff whenever it drops; every
 * (re)connect starts with a fresh snapshot, so callers never have to
 * reconcile missed events. `fetch` is used rather than `EventSource` because
 * the session key travels in a header.
 *
 * @returns A function that stops following.
 */
export function subscribeOrgTree(
  nodeId: NodeId | null,
  { onEvent, onStatus }: OrgStreamHandlers,
  expanded: readonly NodeId[] = [],
): () => void {
  const controller = new AbortController();
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let everLive = false;

  const connect = async () => {
    const { baseUrl, headers } = resolveDirector();
    const params = new URLSearchParams();
    if (nodeId !== null) params.set(NODE_QUERY_PARAM, nodeId);
    expanded.forEach((id) => params.append(EXPANDED_QUERY_PARAM, id));
    const query = params.size > 0 ? `?${params}` : "";
    const url = `${baseUrl}${TREE_STREAM_PATH}${query}`;
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok || !response.body) {
      throw new DirectorError(response.statusText, response.status);
    }

    const decode = createSseDecoder((data) => {
      attempt = 0;
      everLive = true;
      onStatus("live");
      onEvent(JSON.parse(data) as OrgEvent);
    });
    const reader = response.body.getReader();
    const text = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      decode(text.decode(value, { stream: true }));
    }
    throw new DirectorError("The org tree stream ended", null);
  };

  const run = () => {
    connect().catch((error: unknown) => {
      if (controller.signal.aborted) return;
      // A 404 for a named node means the node is gone. A 404 for the root
      // means this backend has no org tree (yet), or no director API at all,
      // which is worth retrying.
      if (
        nodeId !== null &&
        error instanceof DirectorError &&
        error.status === 404
      ) {
        onStatus("not_found");
        return;
      }
      onStatus(everLive ? "reconnecting" : "unavailable");
      const delay =
        RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
      attempt += 1;
      retryTimer = setTimeout(run, delay);
    });
  };

  onStatus("connecting");
  run();

  return () => {
    controller.abort();
    if (retryTimer !== null) clearTimeout(retryTimer);
  };
}
