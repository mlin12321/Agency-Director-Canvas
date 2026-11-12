# Director

Node sidecar that owns the multi-agent org tree, the git blackboard and the
org-chart event stream. Started by `scripts/dev-with-automation.mjs` and
reached through the ingress under `/api/director`.

- This fork deliberately keeps orchestration here instead of forking
  `OpenHands/software-agent-sdk`. Drive the stock Agent Server through its
  existing extension points (child conversations, worktree options, hooks,
  custom tool modules). If the SDK must change, prefer an extension module,
  then an upstream PR, and only then a fork.
- Plain `.mjs` with JSDoc types and no build step, like `scripts/`. No new npm
  dependencies: `node:http` and the `git` CLI only.
- `src/api/director/types.ts` is the single definition of every shape that
  crosses the wire. Import it with `@import`; do not redeclare shapes here.
- The director is the only writer of `refs/agents/*`. Never write agent state
  into the working tree or the user's index: build trees in a throwaway
  `GIT_INDEX_FILE` and land them with a compare-and-swap `git update-ref`.
- `OrgStore` owns `childIds` and `descendantCounts` and is the only emitter of
  `OrgEvent`s. Mutate the tree through it so every subscriber stays consistent.
- A director failure must not stop the rest of the dev stack.
- Tests live in `__tests__/director/` and run against a real temporary git
  repository and a real loopback server.
