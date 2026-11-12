#!/usr/bin/env node
/**
 * Director HTTP service: the org tree as REST + a server-sent event stream,
 * and the human "teach" action on a boundary's blackboard memory.
 *
 * Every route lives under `/api/director` so the dev ingress can route it by
 * prefix next to the Agent Server's `/api`.
 *
 * Environment (when run directly):
 *   DIRECTOR_PORT             Port to listen on (default: ports.director)
 *   DIRECTOR_HOST             Bind host (default: 127.0.0.1)
 *   DIRECTOR_REPO_DIR         Repository the agents work in (default: cwd)
 *   DIRECTOR_SESSION_API_KEY  When set, required as `X-Session-API-Key`
 *   DIRECTOR_FIXTURE          `1` serves the built-in fixture tree
 *
 * @import { IncomingMessage, ServerResponse } from "node:http"
 * @import { NodeBlackboard, OrgEvent } from "../src/api/director/types.ts"
 */
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  BlackboardScopeError,
  GitBlackboard,
} from "./blackboard/git-blackboard.mjs";
import { git } from "./blackboard/git.mjs";
import { buildFixtureNodes } from "./org/fixture.mjs";
import { createOrgBoard, loadOrg } from "./org/org-persistence.mjs";
import { OrgStore } from "./org/org-store.mjs";

export const DIRECTOR_BASE_PATH = "/api/director";
const SESSION_KEY_HEADER = "x-session-api-key";
const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_HEARTBEAT_MS = 15_000;

class HttpError extends Error {
  /** @param {number} status @param {string} message */
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * @param {ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

/** @param {IncomingMessage} req @returns {Promise<unknown>} */
async function readJsonBody(req) {
  /** @type {Buffer[]} */
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, "Request body is too large");
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body is not valid JSON");
  }
}

/** @param {string | undefined} given @param {string} expected */
function keyMatches(given, expected) {
  if (typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** @param {string} segment */
function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new HttpError(400, "Malformed URL path");
  }
}

/**
 * @param {{
 *   store: OrgStore,
 *   blackboard?: GitBlackboard | null,
 *   sessionApiKey?: string | null,
 *   heartbeatMs?: number,
 * }} options
 */
export function createDirectorServer({
  store,
  blackboard = null,
  sessionApiKey = null,
  heartbeatMs = DEFAULT_HEARTBEAT_MS,
}) {
  /** @param {string} id */
  const requireNode = (id) => {
    const node = store.get(id);
    if (!node) throw new HttpError(404, `Unknown node: ${id}`);
    return node;
  };

  const requireBlackboard = () => {
    if (!blackboard) {
      throw new HttpError(
        503,
        "No blackboard: the director is not attached to a git repository",
      );
    }
    return blackboard;
  };

  /**
   * @param {IncomingMessage} req
   * @param {ServerResponse} res
   * @param {URLSearchParams} query
   */
  const streamTree = (req, res, query) => {
    const focusId = query.get("node") ?? store.rootId;
    const snapshot = focusId === null ? null : store.snapshot(focusId);
    if (focusId === null || !snapshot) {
      throw new HttpError(
        404,
        focusId === null ? "The org tree is empty" : `Unknown node: ${focusId}`,
      );
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      // Tell buffering proxies to pass events through as they are written.
      "X-Accel-Buffering": "no",
    });

    /** @param {OrgEvent} event */
    const send = (event) => {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    send(snapshot);

    const unsubscribe = store.subscribe(focusId, send);
    const heartbeat = setInterval(
      () => res.write(": keep-alive\n\n"),
      heartbeatMs,
    );
    heartbeat.unref();
    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  };

  /**
   * @param {IncomingMessage} req
   * @param {ServerResponse} res
   */
  const handle = async (req, res) => {
    const url = new URL(req.url ?? "/", "http://director.invalid");
    if (
      url.pathname !== DIRECTOR_BASE_PATH &&
      !url.pathname.startsWith(`${DIRECTOR_BASE_PATH}/`)
    ) {
      throw new HttpError(404, "Not found");
    }
    // Split before decoding so an encoded slash stays inside its segment.
    const segments = url.pathname
      .slice(DIRECTOR_BASE_PATH.length)
      .split("/")
      .filter(Boolean)
      .map(decodeSegment);
    const route = `${req.method} /${segments.join("/")}`;

    if (route === "GET /health") {
      sendJson(res, 200, { status: "ok", nodes: store.size });
      return;
    }

    if (
      sessionApiKey &&
      !keyMatches(
        /** @type {string | undefined} */ (req.headers[SESSION_KEY_HEADER]),
        sessionApiKey,
      )
    ) {
      throw new HttpError(401, "Missing or invalid session API key");
    }

    if (route === "GET /org/tree-stream") {
      streamTree(req, res, url.searchParams);
      return;
    }

    if (segments[0] === "org" && segments[1] === "nodes" && segments[2]) {
      const node = requireNode(segments[2]);
      const action = segments.length === 4 ? segments[3] : null;

      if (req.method === "GET" && segments.length === 3) {
        sendJson(res, 200, {
          node,
          ancestors: store.ancestors(node.id),
          children: store.children(node.id),
        });
        return;
      }

      if (req.method === "GET" && action === "blackboard") {
        const board = requireBlackboard();
        const [specs, memory, autopsies] = await Promise.all([
          board.inherited(node.boundary.path),
          board.memory(node.boundary.path),
          board.autopsies(node.boundary.path),
        ]);
        /** @type {NodeBlackboard} */
        const body = { specs, memory, autopsies };
        sendJson(res, 200, body);
        return;
      }

      if (req.method === "POST" && action === "teach") {
        const board = requireBlackboard();
        const body = /** @type {{ rule?: unknown } | null} */ (
          await readJsonBody(req)
        );
        const rule = typeof body?.rule === "string" ? body.rule.trim() : "";
        if (!rule) {
          throw new HttpError(400, "`rule` must be a non-empty string");
        }
        await board.teach(node.boundary.path, rule);
        sendJson(res, 200, await board.memory(node.boundary.path));
        return;
      }

      if (req.method === "POST" && (action === "steer" || action === "prune")) {
        throw new HttpError(501, `${action} is not implemented yet`);
      }
    }

    throw new HttpError(404, "Not found");
  };

  return createServer((req, res) => {
    handle(req, res).catch((error) => {
      let status = 500;
      if (error instanceof HttpError) status = error.status;
      else if (error instanceof BlackboardScopeError) status = 400;
      if (status === 500) console.error("[director]", error);
      if (res.headersSent) {
        res.end();
        return;
      }
      // Drain what the client is still sending so the reply is delivered.
      req.resume();
      sendJson(res, status, {
        error: status === 500 ? "Internal error" : error.message,
      });
    });
  });
}

/** @param {string} repoDir */
async function isGitRepository(repoDir) {
  try {
    await git(repoDir, ["rev-parse", "--git-dir"]);
    return true;
  } catch {
    return false;
  }
}

function defaultPort() {
  const defaults = JSON.parse(
    readFileSync(
      fileURLToPath(new URL("../config/defaults.json", import.meta.url)),
      "utf8",
    ),
  );
  return defaults.ports.director;
}

async function main() {
  const { env } = process;
  const port = Number.parseInt(env.DIRECTOR_PORT ?? "", 10) || defaultPort();
  const host = env.DIRECTOR_HOST || "127.0.0.1";
  const repoDir = env.DIRECTOR_REPO_DIR || process.cwd();
  const hasRepo = await isGitRepository(repoDir);

  const store = new OrgStore();
  if (env.DIRECTOR_FIXTURE === "1") {
    store.replaceAll(buildFixtureNodes());
    console.log(`Serving the fixture tree (${store.size} nodes)`);
  } else if (hasRepo && (await loadOrg(createOrgBoard(repoDir), store))) {
    console.log(`Loaded ${store.size} nodes from ${repoDir}`);
  } else {
    console.log("Starting with an empty org tree");
  }
  if (!hasRepo) {
    console.log(`${repoDir} is not a git repository; blackboard disabled`);
  }

  const server = createDirectorServer({
    store,
    blackboard: hasRepo ? new GitBlackboard({ repoDir }) : null,
    sessionApiKey: env.DIRECTOR_SESSION_API_KEY || null,
  });
  server.listen(port, host, () => {
    console.log(`Listening on http://${host}:${port}${DIRECTOR_BASE_PATH}`);
  });

  const shutdown = () => {
    server.closeAllConnections();
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
