/**
 * Git-native blackboard: a virtual directory tree stored under a hidden ref
 * (`refs/agents/blackboard` by default). Nothing here ever touches the working
 * tree or the user's index; every mutation builds a tree in a throwaway index
 * file and lands with a compare-and-swap `git update-ref`.
 *
 * @import { Autopsy, BoundaryMemory, InheritedSpec } from "../../src/api/director/types.ts"
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { git, GitError, gitVersion } from "./git.mjs";

export const BLACKBOARD_REF = "refs/agents/blackboard";
export const SPEC_FILE = "spec.md";
export const MEMORY_FILE = "memory.json";
export const AUTOPSIES_FILE = "autopsies.json";

const ZERO_OID = "0".repeat(40);
const MAX_COMMIT_ATTEMPTS = 8;
const IDENTITY = {
  GIT_AUTHOR_NAME: "Agentcy Director",
  GIT_AUTHOR_EMAIL: "director@agentcy.invalid",
  GIT_COMMITTER_NAME: "Agentcy Director",
  GIT_COMMITTER_EMAIL: "director@agentcy.invalid",
};

export class BlackboardScopeError extends Error {
  constructor(message) {
    super(message);
    this.name = "BlackboardScopeError";
  }
}

export class BlackboardMergeConflictError extends Error {
  /** @param {string} detail */
  constructor(detail) {
    super(`Blackboard merge has conflicts:\n${detail}`);
    this.name = "BlackboardMergeConflictError";
  }
}

/**
 * Normalize a repo-relative path. `""`, `"."` and `"/"` all mean the root.
 * Rejects anything that could escape the virtual tree.
 *
 * @param {string} path
 * @returns {string}
 */
export function normalizeBoardPath(path) {
  const segments = path
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".");
  if (segments.some((segment) => segment === ".." || segment === ".git")) {
    throw new BlackboardScopeError(`Path escapes the blackboard: ${path}`);
  }
  return segments.join("/");
}

/** @param {string} dir @param {string} file */
function joinBoardPath(dir, file) {
  return dir ? `${dir}/${file}` : file;
}

/**
 * @typedef {{ path: string, content: string | null }} BoardChange
 *   `content: null` deletes the file.
 * @typedef {(path: string) => Promise<string | null>} BoardReader
 */

export class GitBlackboard {
  /**
   * @param {{ repoDir: string, ref?: string }} options
   */
  constructor({ repoDir, ref = BLACKBOARD_REF }) {
    this.repoDir = repoDir;
    this.ref = ref;
  }

  /** @returns {Promise<string | null>} Commit the ref points at. */
  async head() {
    try {
      const out = await git(this.repoDir, [
        "rev-parse",
        "--verify",
        "--quiet",
        `${this.ref}^{commit}`,
      ]);
      return out.trim();
    } catch (error) {
      if (error instanceof GitError) return null;
      throw error;
    }
  }

  /**
   * @param {string} path
   * @param {string | null} [at] Commit to read from; defaults to the ref head.
   * @returns {Promise<string | null>}
   */
  async read(path, at) {
    const commit = at === undefined ? await this.head() : at;
    if (!commit) return null;
    try {
      return await git(this.repoDir, [
        "cat-file",
        "blob",
        `${commit}:${normalizeBoardPath(path)}`,
      ]);
    } catch (error) {
      if (error instanceof GitError) return null;
      throw error;
    }
  }

  /**
   * Specs from the repository root down to `boundaryPath`. Ancestors come
   * back read-only; only the boundary's own spec is writable by its agents.
   *
   * @param {string} boundaryPath
   * @returns {Promise<InheritedSpec[]>}
   */
  async inherited(boundaryPath) {
    const target = normalizeBoardPath(boundaryPath);
    const segments = target ? target.split("/") : [];
    const dirs = [""];
    segments.forEach((_, index) => {
      dirs.push(segments.slice(0, index + 1).join("/"));
    });

    const commit = await this.head();
    const specs = await Promise.all(
      dirs.map(async (dir) => ({
        path: dir,
        spec: await this.read(joinBoardPath(dir, SPEC_FILE), commit),
        readonly: dir !== target,
      })),
    );
    return /** @type {InheritedSpec[]} */ (
      specs.filter((entry) => entry.spec !== null)
    );
  }

  /**
   * Write one file inside `scopePath`. A file that resolves outside the scope
   * is rejected, which is what confines an agent to its own subtree.
   *
   * @param {string} scopePath
   * @param {string} file Path relative to `scopePath`.
   * @param {string} content
   * @returns {Promise<string | null>} The new commit.
   */
  async write(scopePath, file, content) {
    const path = this.#scoped(scopePath, file);
    return this.commit(
      async () => [{ path, content }],
      `blackboard: write ${path}`,
    );
  }

  /**
   * @param {string} scopePath
   * @returns {Promise<BoundaryMemory>}
   */
  async memory(scopePath) {
    return parseMemory(await this.read(this.#scoped(scopePath, MEMORY_FILE)));
  }

  /**
   * @param {string} scopePath
   * @returns {Promise<Autopsy[]>}
   */
  async autopsies(scopePath) {
    return parseAutopsies(
      await this.read(this.#scoped(scopePath, AUTOPSIES_FILE)),
    );
  }

  /**
   * Append a plain-English rule to the boundary's permanent memory.
   *
   * @param {string} scopePath
   * @param {string} rule
   */
  async teach(scopePath, rule) {
    const path = this.#scoped(scopePath, MEMORY_FILE);
    const trimmed = rule.trim();
    if (!trimmed) throw new Error("A rule cannot be empty");
    return this.commit(async (read) => {
      const memory = parseMemory(await read(path));
      if (memory.rules.includes(trimmed)) return [];
      memory.rules.push(trimmed);
      return [{ path, content: serialize(memory) }];
    }, `blackboard: teach ${path}`);
  }

  /**
   * @param {string} scopePath
   * @param {Autopsy} autopsy
   */
  async appendAutopsy(scopePath, autopsy) {
    const path = this.#scoped(scopePath, AUTOPSIES_FILE);
    return this.commit(async (read) => {
      const autopsies = parseAutopsies(await read(path));
      autopsies.push(autopsy);
      return [{ path, content: serialize(autopsies) }];
    }, `blackboard: autopsy ${path}`);
  }

  /**
   * Read-modify-write against the ref. `mutate` sees the tree it is building
   * on, and is re-run from scratch if another writer moved the ref first.
   *
   * @param {(read: BoardReader) => Promise<BoardChange[]>} mutate
   * @param {string} message
   * @returns {Promise<string | null>} The new commit, or the unchanged head
   *   when `mutate` produced no changes.
   */
  async commit(mutate, message) {
    for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt += 1) {
      const parent = await this.head();
      const changes = await mutate((path) => this.read(path, parent));
      if (changes.length === 0) return parent;

      const tree = await this.#buildTree(parent, changes);
      const next = await this.#commitTree(
        tree,
        parent ? [parent] : [],
        message,
      );
      if (await this.#swap(next, parent)) return next;
    }
    throw new Error(
      `Gave up updating ${this.ref} after ${MAX_COMMIT_ATTEMPTS} contended attempts`,
    );
  }

  /**
   * Three-way merge another blackboard ref into this one, entirely in the
   * object store. Needs git 2.38+ for `merge-tree --write-tree`.
   *
   * @param {string} theirsRef
   * @returns {Promise<string>} The resulting head commit.
   */
  async merge(theirsRef) {
    const [major, minor] = await gitVersion(this.repoDir);
    if (major < 2 || (major === 2 && minor < 38)) {
      throw new Error(
        `Blackboard merge needs git 2.38 or newer (found ${major}.${minor})`,
      );
    }
    const theirs = (
      await git(this.repoDir, [
        "rev-parse",
        "--verify",
        `${theirsRef}^{commit}`,
      ])
    ).trim();

    for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt += 1) {
      const ours = await this.head();
      if (!ours) {
        if (await this.#swap(theirs, null)) return theirs;
        continue;
      }
      if (ours === theirs) return ours;

      let tree;
      try {
        tree = (
          await git(this.repoDir, ["merge-tree", "--write-tree", ours, theirs])
        ).trim();
      } catch (error) {
        if (error instanceof GitError && error.code === 1) {
          throw new BlackboardMergeConflictError(error.stdout);
        }
        throw error;
      }
      const next = await this.#commitTree(
        tree,
        [ours, theirs],
        `blackboard: merge ${theirsRef}`,
      );
      if (await this.#swap(next, ours)) return next;
    }
    throw new Error(
      `Gave up merging into ${this.ref} after ${MAX_COMMIT_ATTEMPTS} contended attempts`,
    );
  }

  /** @param {string} scopePath @param {string} file */
  #scoped(scopePath, file) {
    const scope = normalizeBoardPath(scopePath);
    const relative = normalizeBoardPath(file);
    if (!relative) {
      throw new BlackboardScopeError("A blackboard write needs a file name");
    }
    return joinBoardPath(scope, relative);
  }

  /**
   * @param {string | null} parent
   * @param {BoardChange[]} changes
   * @returns {Promise<string>} Tree object id.
   */
  async #buildTree(parent, changes) {
    const scratch = await mkdtemp(join(tmpdir(), "agentcy-blackboard-"));
    const env = { GIT_INDEX_FILE: join(scratch, "index") };
    try {
      if (parent) await git(this.repoDir, ["read-tree", parent], { env });
      for (const change of changes) {
        const path = normalizeBoardPath(change.path);
        if (change.content === null) {
          await git(this.repoDir, ["update-index", "--force-remove", path], {
            env,
          });
        } else {
          const blob = (
            await git(this.repoDir, ["hash-object", "-w", "--stdin"], {
              input: change.content,
            })
          ).trim();
          await git(
            this.repoDir,
            ["update-index", "--add", "--cacheinfo", `100644,${blob},${path}`],
            { env },
          );
        }
      }
      return (await git(this.repoDir, ["write-tree"], { env })).trim();
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }

  /**
   * @param {string} tree
   * @param {string[]} parents
   * @param {string} message
   */
  async #commitTree(tree, parents, message) {
    const parentArgs = parents.flatMap((parent) => ["-p", parent]);
    const out = await git(
      this.repoDir,
      ["commit-tree", tree, ...parentArgs, "-m", message],
      { env: IDENTITY },
    );
    return out.trim();
  }

  /**
   * Move the ref from `expected` to `next`, failing if someone else moved it.
   *
   * @param {string} next
   * @param {string | null} expected
   * @returns {Promise<boolean>}
   */
  async #swap(next, expected) {
    try {
      await git(this.repoDir, [
        "update-ref",
        this.ref,
        next,
        expected ?? ZERO_OID,
      ]);
      return true;
    } catch (error) {
      if (error instanceof GitError) return false;
      throw error;
    }
  }
}

/** @param {unknown} value */
function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * @param {string | null} raw
 * @returns {BoundaryMemory}
 */
function parseMemory(raw) {
  if (!raw) return { rules: [] };
  const parsed = JSON.parse(raw);
  return { rules: Array.isArray(parsed?.rules) ? parsed.rules : [] };
}

/**
 * @param {string | null} raw
 * @returns {Autopsy[]}
 */
function parseAutopsies(raw) {
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}
