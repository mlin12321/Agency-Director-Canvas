/**
 * Persists the org tree as one JSON file under its own hidden ref, so the
 * director needs no database and rebuilds its state from git on start.
 *
 * @import { OrgStore, OrgNodeInput } from "./org-store.mjs"
 */
import { GitBlackboard } from "../blackboard/git-blackboard.mjs";

export const ORG_REF = "refs/agents/org";
const ORG_FILE = "org.json";

/** @param {string} repoDir */
export function createOrgBoard(repoDir) {
  return new GitBlackboard({ repoDir, ref: ORG_REF });
}

/**
 * @param {GitBlackboard} board
 * @param {OrgStore} store
 */
export async function saveOrg(board, store) {
  const nodes = store
    .all()
    .map(({ childIds: _c, descendantCounts: _d, ...input }) => input);
  const content = `${JSON.stringify({ version: 1, nodes }, null, 2)}\n`;
  await board.commit(
    async (read) =>
      (await read(ORG_FILE)) === content ? [] : [{ path: ORG_FILE, content }],
    "org: save tree",
  );
}

/**
 * @param {GitBlackboard} board
 * @param {OrgStore} store
 * @returns {Promise<boolean>} Whether a saved tree was found and loaded.
 */
export async function loadOrg(board, store) {
  const raw = await board.read(ORG_FILE);
  if (raw === null) return false;
  const parsed = JSON.parse(raw);
  if (parsed?.version !== 1 || !Array.isArray(parsed.nodes)) {
    throw new Error(`Unrecognized org tree format in ${ORG_REF}`);
  }
  store.replaceAll(/** @type {OrgNodeInput[]} */ (parsed.nodes));
  return true;
}
