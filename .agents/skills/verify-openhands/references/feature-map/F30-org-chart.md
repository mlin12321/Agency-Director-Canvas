# F30 — Org chart

The org chart shows the agents of a backend as an organization. Each node is a
team: a pod of agents (Lead IC, Manager, Reviewer, and a Worker on leaf teams)
that owns one boundary of the repository. The page shows one team at a time:
its header (title, health, pod, and a count of every team below it by health),
its direct reports as cards grouped by health, and the boundary each report
owns. A card drills into that team; the breadcrumb leads back up. Clicking an
agent opens the inspector drawer, which holds the boundary's permanent memory
(with a form to teach it a rule) above that agent's conversation.

The tree and the memory come from the Agent Server's director API
(`/api/director/*`). The page follows the focused team over a server-sent
event stream and never loads the rest of the tree.

Source: `src/routes/org-chart.tsx`, `src/components/features/org-chart/`, `src/hooks/use-org-tree.ts`, `src/api/director/`, `src/constants/org-chart.ts`, `src/components/features/sidebar/sidebar-rail-body.tsx`.

Server: F02, F25.

## Sub-features

- `F30.open-root`: `/org` shows the root team: its title as the page heading, its health, its pod, and under **Teams below** one count per health for the whole tree.
- `F30.reports`: the direct reports are cards grouped under a health heading with the group's size; each card has the team's title, summary and number of sub-teams, and the **Boundaries** list names each report's directory, worktree mode and writable and read-only globs.
- `F30.drill-down`: clicking a report card opens that team at `/org/<id>`; the breadcrumb lists every ancestor from the root, and each is a link back up.
- `F30.deep-link`: `/org/<id>` opens that team directly, with its full breadcrumb.
- `F30.inspector`: clicking an agent in the header opens a drawer titled with the agent's role and the team; closing it, or moving to another team, removes it. An agent with no conversation shows **This agent has no live conversation yet.**
- `F30.memory-unavailable`: when the director's directory is not a git repository, the drawer says boundary memory is unavailable and offers no form.
- `F30.teach`: saving a rule in the drawer adds it to the list, and the rule is stored for that team's boundary only.
- `F30.unknown-team`: `/org/<id>` for a team that does not exist says **This team no longer exists** with a link back to the root.
- `F30.unavailable`: on a backend with no org tree (or no director API), `/org` says **The director is offline** and keeps retrying.

## How to get to it (user POV)

- Sidebar → **Org chart** (`sidebar-org-chart-link`), shown for local backends only.
- Direct URL: `/org` for the root, `/org/<id>` for a team.
- A report card, or a breadcrumb link, from any team.

## Driving it with control-openhands

Preconditions:

- An Agent Server that has the director API. Until a release includes it, launch with `--sdk-path <checkout>` of an SDK that does.
- `control-openhands launch --new --director-fixture --sdk-path <checkout>`: the server then serves its built-in fixture tree (487 teams: a root, 6 domains, 5 services in each, 15 modules in each service) and keeps boundary memory in the run's `qa-repo`. Then `control-openhands onboard --skip`.
- No LLM is needed. No fixture team has a conversation.

- **Root (`F30.open-root`, `F30.reports`).** `control-openhands browser click 'testid=sidebar-org-chart-link' --expect-url '/org$'`, `control-openhands browser wait 'testid=org-node-workspace'`. `control-openhands browser text 'testid=org-node-workspace'` starts with `Root organization`, lists `Lead IC`, `Manager`, `Reviewer`, has six counts after `Teams below` that add up to 486, six report cards each ending `Sub-teams: 5`, and under `Boundaries` the six `services/<domain>` directories. `control-openhands api GET /api/director/org/nodes/root --pick node.descendant_counts` returns the same six counts.
- **Drill down and back (`F30.drill-down`).** `control-openhands browser click 'role=link[name=/payments domain/]' --expect-url '/org/payments$'`; `control-openhands browser text 'role=heading[level=1]'` is `payments domain`. Back up through the breadcrumb from a deeper team: `control-openhands browser goto /org/payments.api`, then `control-openhands browser click 'role=navigation >> role=link[name="payments domain"]' --expect-url '/org/payments$'`.
- **Deep link (`F30.deep-link`).** `control-openhands browser goto /org/payments.api`; `control-openhands browser text 'role=navigation'` has a second entry reading `Root organization`, `payments domain`, `payments/api`.
- **Inspector without a repository (`F30.inspector`, `F30.memory-unavailable`).** Before `fixture git-repo`, on `/org/payments`: `control-openhands browser click 'role=button[name=/Manager/]'`; `control-openhands browser text 'role=dialog'` reads `Manager · payments domain`, `Boundary memory is unavailable. The director may not be attached to a git repository.` and `This agent has no live conversation yet.`
- **Teach (`F30.teach`).** `control-openhands fixture git-repo`, `control-openhands browser reload`, `control-openhands browser click 'role=button[name=/Manager/]'`, `control-openhands browser fill 'role=dialog >> role=textbox' 'QA_rule: idempotency keys on every write.'`, `control-openhands browser click 'role=dialog >> role=button[name="Save rule"]'`. `control-openhands browser text 'role=dialog'` now lists the rule above the form. `control-openhands api GET /api/director/org/nodes/payments/blackboard --pick memory.rules` returns it, `git -C "$OH_VERIFY_RUN/workspace/qa-repo" show refs/agents/blackboard:services/payments/memory.json` holds it, and `git -C "$OH_VERIFY_RUN/workspace/qa-repo" status --porcelain` prints nothing.
- **Unknown team (`F30.unknown-team`).** `control-openhands browser goto /org/nope`; `control-openhands browser text 'text=This team no longer exists'` matches.
- **No org tree (`F30.unavailable`).** In a run launched without `--director-fixture`: `control-openhands browser goto /org`; `control-openhands browser testids --filter org` lists only `sidebar-org-chart-link` (no `org-node-workspace`), and `control-openhands api GET /api/director/org/nodes/root` is `404`.
- After the family, `control-openhands browser errors --app-only` shows no page errors. It does list the `503` from the blackboard request made before `fixture git-repo` and the `404` for `/org/nope`; both are expected.

## Gotchas

- `--director-fixture` is a launch flag, not something to export: runs are isolated from the operator's shell, so `OH_DIRECTOR_FIXTURE` set there never reaches the server.
- The fixture tree is read-only and identical on every start; nothing a recipe does changes it. Taught rules live in `qa-repo`'s hidden ref `refs/agents/blackboard` and disappear with the run.
- The drawer loads boundary memory when it opens. After `fixture git-repo`, reload (or reopen the drawer) to leave the unavailable state.
- A stock Agent Server answers `404` for every `/api/director/*` route, which the page shows as `F30.unavailable`, not as an error.
- Live changes to the tree (a team's health changing, a team being added or pruned) cannot be driven yet: no user action or API changes the tree until agents can. The page's handling of those events is covered by its unit tests only.
