import { spawn } from "node:child_process";

export class GitError extends Error {
  /**
   * @param {string[]} args
   * @param {number | null} code
   * @param {string} stderr
   * @param {string} stdout
   */
  constructor(args, code, stderr, stdout) {
    super(`git ${args.join(" ")} exited ${code}: ${stderr.trim()}`);
    this.name = "GitError";
    this.code = code;
    this.stderr = stderr;
    this.stdout = stdout;
  }
}

/**
 * Run one git command and resolve with its stdout.
 *
 * @param {string} repoDir Directory inside the repository (any worktree).
 * @param {string[]} args
 * @param {{ env?: Record<string, string>, input?: string }} [options]
 * @returns {Promise<string>}
 */
export function git(repoDir, args, { env, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: repoDir,
      env: { ...process.env, ...env },
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new GitError(args, code, stderr, stdout));
    });
    if (child.stdin) {
      // git can exit before reading its input (bad repo, bad arguments). The
      // resulting EPIPE is not the failure worth reporting: the exit code is.
      child.stdin.on("error", () => {});
      child.stdin.end(input);
    }
  });
}

/**
 * @param {string} repoDir
 * @returns {Promise<[number, number]>} `[major, minor]`
 */
export async function gitVersion(repoDir) {
  const match = /(\d+)\.(\d+)/.exec(await git(repoDir, ["--version"]));
  if (!match) throw new Error("Could not parse `git --version` output");
  return [Number(match[1]), Number(match[2])];
}
