import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BlackboardMergeConflictError,
  BlackboardScopeError,
  BLACKBOARD_REF,
  GitBlackboard,
} from "../../director/blackboard/git-blackboard.mjs";
import { git, gitVersion } from "../../director/blackboard/git.mjs";

const IDENTITY = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
};

let repoDir: string;
let board: GitBlackboard;

beforeEach(async () => {
  repoDir = await mkdtemp(join(tmpdir(), "blackboard-test-"));
  await git(repoDir, ["init", "--quiet", "--initial-branch=main"]);
  await writeFile(join(repoDir, "README.md"), "hello\n");
  await git(repoDir, ["add", "README.md"]);
  await git(repoDir, ["commit", "--quiet", "-m", "init"], { env: IDENTITY });
  board = new GitBlackboard({ repoDir });
});

afterEach(async () => {
  await rm(repoDir, { recursive: true, force: true });
});

describe("git", () => {
  it("rejects instead of crashing when the directory does not exist", async () => {
    const missing = join(repoDir, "does-not-exist");

    await expect(git(missing, ["status"])).rejects.toThrow();
    await expect(
      git(missing, ["hash-object", "--stdin"], { input: "x".repeat(200_000) }),
    ).rejects.toThrow();
  });

  it("rejects with the exit code when git fails before reading its input", async () => {
    await expect(
      git(repoDir, ["not-a-command"], { input: "x".repeat(2_000_000) }),
    ).rejects.toMatchObject({ name: "GitError", code: 1 });
  });

  it("reports that a plain directory is not a repository", async () => {
    const plain = await mkdtemp(join(tmpdir(), "not-a-repo-"));
    try {
      await expect(
        git(plain, ["rev-parse", "--git-dir"], {
          env: { GIT_CEILING_DIRECTORIES: tmpdir() },
        }),
      ).rejects.toMatchObject({ name: "GitError" });
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });
});

describe("GitBlackboard", () => {
  it("reads nothing before the first write", async () => {
    expect(await board.head()).toBeNull();
    expect(await board.read("spec.md")).toBeNull();
    expect(await board.inherited("services/auth")).toEqual([]);
    expect(await board.memory("services/auth")).toEqual({ rules: [] });
    expect(await board.autopsies("services/auth")).toEqual([]);
  });

  it("stores files under the hidden ref without touching the working tree, index or branch", async () => {
    const branchBefore = await git(repoDir, ["rev-parse", "HEAD"]);

    await board.write("services/auth", "spec.md", "# Auth\n");

    expect(await board.read("services/auth/spec.md")).toBe("# Auth\n");
    expect(await git(repoDir, ["status", "--porcelain"])).toBe("");
    expect(await git(repoDir, ["rev-parse", "HEAD"])).toBe(branchBefore);
    expect((await readdir(repoDir)).sort()).toEqual([".git", "README.md"]);
    expect(await git(repoDir, ["ls-files"])).toBe("README.md\n");
  });

  it("keeps earlier files and history when writing again", async () => {
    await board.write("", "spec.md", "root v1\n");
    await board.write("services/auth", "spec.md", "auth\n");
    await board.write("", "spec.md", "root v2\n");

    expect(await board.read("spec.md")).toBe("root v2\n");
    expect(await board.read("services/auth/spec.md")).toBe("auth\n");
    const log = await git(repoDir, ["rev-list", "--count", BLACKBOARD_REF]);
    expect(log.trim()).toBe("3");
  });

  it("preserves content byte for byte, including unicode and a missing trailing newline", async () => {
    const content = "naïve — 規則 🚦\n\ttabbed\nno newline at end";

    await board.write("docs", "spec.md", content);

    expect(await board.read("docs/spec.md")).toBe(content);
  });

  it("returns specs from the root down, marking only the boundary's own spec writable", async () => {
    await board.write("", "spec.md", "root\n");
    await board.write("services/auth", "spec.md", "auth\n");
    await board.write("services/auth/oauth", "spec.md", "oauth\n");
    await board.write("services/billing", "spec.md", "billing\n");

    const specs = await board.inherited("/services/auth/oauth/");

    expect(specs).toEqual([
      { path: "", spec: "root\n", readonly: true },
      { path: "services/auth", spec: "auth\n", readonly: true },
      { path: "services/auth/oauth", spec: "oauth\n", readonly: false },
    ]);
  });

  it("skips ancestors that have no spec", async () => {
    await board.write("", "spec.md", "root\n");
    await board.write("services/auth/oauth", "spec.md", "oauth\n");

    const specs = await board.inherited("services/auth/oauth");

    expect(specs.map((entry) => entry.path)).toEqual([
      "",
      "services/auth/oauth",
    ]);
  });

  it.each([
    ["a parent traversal", "../billing/spec.md"],
    ["a nested traversal", "notes/../../billing/spec.md"],
    ["a backslash traversal", "..\\billing\\spec.md"],
    ["the git directory", ".git/config"],
    ["an empty file name", ""],
  ])("rejects a write that targets %s", async (_label, file) => {
    await expect(
      board.write("services/auth", file, "nope"),
    ).rejects.toBeInstanceOf(BlackboardScopeError);
    expect(await board.head()).toBeNull();
  });

  it("confines an absolute-looking file name to the scope instead of the root", async () => {
    await board.write("services/auth", "/spec.md", "auth\n");

    expect(await board.read("services/auth/spec.md")).toBe("auth\n");
    expect(await board.read("spec.md")).toBeNull();
  });

  it("accumulates taught rules, ignoring duplicates and rejecting blanks", async () => {
    await board.teach("services/auth", "Never log tokens.");
    await board.teach("services/auth", "  Never log tokens.  ");
    await board.teach("services/auth", "Rotate keys via the vault client.");

    expect(await board.memory("services/auth")).toEqual({
      rules: ["Never log tokens.", "Rotate keys via the vault client."],
    });
    await expect(board.teach("services/auth", "   ")).rejects.toThrow(/empty/);
    expect(await board.memory("services/billing")).toEqual({ rules: [] });
  });

  it("appends failure autopsies in order", async () => {
    const first = {
      nodeId: "n1",
      at: "2026-11-11T00:00:00Z",
      approach: "regex parser",
      whyFailed: "nested quotes",
    };
    const second = { ...first, approach: "hand lexer", whyFailed: "timeouts" };

    await board.appendAutopsy("services/auth", first);
    await board.appendAutopsy("services/auth", second);

    expect(await board.autopsies("services/auth")).toEqual([first, second]);
  });

  it("loses no update when many writers race on the same file", async () => {
    const rules = Array.from({ length: 6 }, (_, index) => `rule ${index}`);
    const writers = rules.map((rule) =>
      new GitBlackboard({ repoDir }).teach("services/auth", rule),
    );

    await Promise.all(writers);

    const memory = await board.memory("services/auth");
    expect([...memory.rules].sort()).toEqual(rules);
    const commits = await git(repoDir, ["rev-list", "--count", BLACKBOARD_REF]);
    expect(commits.trim()).toBe(String(rules.length));
  });

  it("deletes a file when a change carries null content", async () => {
    await board.write("services/auth", "spec.md", "auth\n");
    await board.write("services/auth", "notes.md", "notes\n");

    await board.commit(
      async () => [{ path: "services/auth/notes.md", content: null }],
      "drop notes",
    );

    expect(await board.read("services/auth/notes.md")).toBeNull();
    expect(await board.read("services/auth/spec.md")).toBe("auth\n");
  });

  it("makes no commit when a mutation produces no changes", async () => {
    await board.write("", "spec.md", "root\n");
    const before = await board.head();

    const result = await board.commit(async () => [], "noop");

    expect(result).toBe(before);
    expect(await board.head()).toBe(before);
  });

  it("is shared with a linked worktree", async () => {
    const worktreeDir = await mkdtemp(join(tmpdir(), "blackboard-wt-"));
    try {
      await git(repoDir, [
        "worktree",
        "add",
        "--quiet",
        "-b",
        "feature",
        join(worktreeDir, "wt"),
      ]);
      const fromWorktree = new GitBlackboard({
        repoDir: join(worktreeDir, "wt"),
      });

      await fromWorktree.write("services/auth", "spec.md", "from worktree\n");

      expect(await board.read("services/auth/spec.md")).toBe("from worktree\n");
      expect(
        await git(join(worktreeDir, "wt"), ["status", "--porcelain"]),
      ).toBe("");
    } finally {
      await rm(worktreeDir, { recursive: true, force: true });
    }
  });

  describe("merge", () => {
    const THEIRS_REF = "refs/agents/incoming";
    let theirs: GitBlackboard;
    let mergeSupported: boolean;

    beforeEach(async () => {
      const [major, minor] = await gitVersion(repoDir);
      mergeSupported = major > 2 || (major === 2 && minor >= 38);
      await board.write("", "spec.md", "root\n");
      await git(repoDir, ["update-ref", THEIRS_REF, BLACKBOARD_REF]);
      theirs = new GitBlackboard({ repoDir, ref: THEIRS_REF });
    });

    it("explains the git requirement when git is too old to merge", async (context) => {
      if (mergeSupported) context.skip();

      await expect(board.merge(THEIRS_REF)).rejects.toThrow(/git 2\.38/);
    });

    it("combines memories from different directories", async (context) => {
      if (!mergeSupported) context.skip();
      await board.write("services/auth", "spec.md", "auth\n");
      await theirs.write("services/billing", "spec.md", "billing\n");

      await board.merge(THEIRS_REF);

      expect(await board.read("services/auth/spec.md")).toBe("auth\n");
      expect(await board.read("services/billing/spec.md")).toBe("billing\n");
      expect(await git(repoDir, ["status", "--porcelain"])).toBe("");
    });

    it("reports a conflict and leaves the ref unchanged", async (context) => {
      if (!mergeSupported) context.skip();
      await board.write("", "spec.md", "ours\n");
      await theirs.write("", "spec.md", "theirs\n");
      const before = await board.head();

      await expect(board.merge(THEIRS_REF)).rejects.toBeInstanceOf(
        BlackboardMergeConflictError,
      );
      expect(await board.head()).toBe(before);
    });

    it("adopts the other ref when this blackboard is empty", async (context) => {
      if (!mergeSupported) context.skip();
      const empty = new GitBlackboard({ repoDir, ref: "refs/agents/empty" });

      await empty.merge(THEIRS_REF);

      expect(await empty.read("spec.md")).toBe("root\n");
    });
  });
});
