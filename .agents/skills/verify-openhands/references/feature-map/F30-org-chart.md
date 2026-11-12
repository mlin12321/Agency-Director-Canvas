# F30 — Org chart

The org chart draws the agents of a backend as an organization, top down. Each
card is a team: a pod of agents (Lead IC, Manager, Reviewer, and a Worker on
leaf teams) that owns one boundary of the repository. A team's sub-teams hang
below it once it is expanded, and each team expands on its own. Sub-teams sit
side by side, or in a column when there are three or more and none has
sub-teams of its own.

The chart shows the org and nothing else. A team's status, boundary and
agents appear in a card only while the team is hovered or focused. The one
thing put in front of the user is the **Escalations** list above the chart:
what teams could not settle themselves (critical issues and design
decisions), each with the chain of teams it came up through. Every card on
that chain carries a count.

A team's details open in a drawer: the boundary's permanent memory (with a
form to teach it a rule), the team's agents, and the picked agent's
conversation.

The tree, the escalations and the memory come from the Agent Server's
director API (`/api/director/*`). The page follows only the open part of the
tree over a server-sent event stream.

Source: `src/routes/org-chart.tsx`, `src/components/features/org-chart/`, `src/hooks/use-org-tree.ts`, `src/api/director/`, `src/constants/org-chart.ts`, `src/components/features/sidebar/sidebar-rail-body.tsx`.

Server: F02, F25.

## Sub-features

- `F30.open-root`: `/org` draws the root team's card with one card per direct report below it, and no team's status or boundary.
- `F30.expand`: clicking a team that has sub-teams shows them below it; clicking it again hides them. Other expanded teams are unaffected.
- `F30.hover`: hovering a card (or focusing it with the keyboard) shows that team's summary, status, boundary directory and worktree mode, writable and read-only globs, and agents.
- `F30.escalations`: **Escalations** lists every open escalation in the chart, critical issues first, each with its kind, title, detail and the path of teams from the top; every card on a path shows how many are at or below it.
- `F30.reveal`: clicking an escalation expands the chart down to the team that raised it, scrolls to that card and outlines it.
- `F30.subtree`: `/org/<id>` draws the chart from that team, with a breadcrumb of its ancestors and only the escalations at or below it. **Show as top of chart** in a team's details goes there.
- `F30.details`: the button at the right of a card, or a click on a team without sub-teams, opens a drawer titled with the team; it lists the team's agents, the first one picked. An agent with no conversation shows **This agent has no live conversation yet.**
- `F30.memory-unavailable`: when the director's directory is not a git repository, the drawer says boundary memory is unavailable and offers no form.
- `F30.teach`: saving a rule in the drawer adds it to the list, and the rule is stored for that team's boundary only.
- `F30.unknown-team`: `/org/<id>` for a team that does not exist says **This team no longer exists** with a link back to the root.
- `F30.unavailable`: on a backend with no org tree (or no director API), `/org` says **The director is offline** and keeps retrying.

## How to get to it (user POV)

- Sidebar → **Org chart** (`sidebar-org-chart-link`), shown for local backends only.
- Direct URL: `/org` for the whole tree, `/org/<id>` for the chart below one team.
- A breadcrumb link, or **Show as top of chart** in a team's details.

## Driving it with control-openhands

Preconditions:

- An Agent Server that has the director API. Until a release includes it, launch with `--sdk-path <checkout>` of an SDK that does.
- `control-openhands launch --new --director-fixture --sdk-path <checkout>`: the server then serves its built-in fixture tree (487 teams: a root, 6 domains, 5 services in each, 15 modules in each service; 4 open escalations) and keeps boundary memory in the run's `qa-repo`. Then `control-openhands onboard --skip`.
- No LLM is needed. No fixture team has a conversation.
- Each card is `testid=org-node-<id>`; ids are `root`, `<domain>`, `<domain>.<service>`, `<domain>.<service>.module-NN`. The first button in a card expands the team (or opens the details of a team without sub-teams).

- **Root (`F30.open-root`).** `control-openhands browser click 'testid=sidebar-org-chart-link' --expect-url '/org$'`, `control-openhands browser wait 'testid=org-chart'`. `control-openhands browser count '[data-testid^="org-node-"]'` is `7`, and `control-openhands browser text 'role=region[name="Org chart"]'` reads `Root organization`, `Sub-teams: 6`, then the six `<domain> domain` cards each with `Sub-teams: 5` (the lone digits are escalation counts, see below); it has no `Converging`, `Needs attention` or `services/`.
- **Expand and collapse (`F30.expand`).** `control-openhands browser click 'testid=org-node-payments >> role=button >> nth=0'`, `control-openhands browser wait 'testid=org-node-payments.gateway'`; the count is now `12`. Expand `identity` the same way (count `17`), then click `payments` again: `control-openhands browser wait 'testid=org-node-payments.gateway' --state detached`, `control-openhands browser visible 'testid=org-node-identity.api'` is `true`, and the count is `12`. `control-openhands browser attr 'testid=org-node-identity >> role=button >> nth=0' aria-expanded` is `true`.
- **Hover (`F30.hover`).** `control-openhands browser tooltip 'testid=org-node-identity.api >> role=button >> nth=0'` returns `Implements the api service for identity.`, a `Status:`, `Boundary: services/identity/api · Own worktree`, `Writable: services/identity/api/*.ts`, `Read-only: services/identity/contracts/**` and `Agents Lead IC (running), Manager (idle), Reviewer (idle)`.
- **Escalations (`F30.escalations`).** `control-openhands browser text 'role=region[name="Escalations"]'` starts `Escalations 4`, then two `Critical issue` entries (`Export job writes customer emails to debug logs`, `Idempotency keys collide across retries`) before two `Design decision` entries; the first ends `Root organization › data domain › data/worker › module-03`. `control-openhands browser text 'testid=org-node-root >> role=img'` is `4`; `payments`, `identity`, `search` and `data` each show `1`, and `control-openhands browser count 'testid=org-node-platform >> role=img'` is `0`. `control-openhands api GET /api/director/org/nodes/root --pick node.escalation_count` is `4`.
- **Reveal (`F30.reveal`).** `control-openhands browser click 'role=region[name="Escalations"] >> role=button[name=/Export job/]'`, `control-openhands browser wait 'testid=org-node-data.worker.module-03'`. `control-openhands browser attr 'testid=org-node-data.worker.module-03' data-highlighted` is `true`, and `data` and `data.worker` report `aria-expanded` `true`.
- **Details without a repository (`F30.details`, `F30.memory-unavailable`).** Before `fixture git-repo`: `control-openhands browser click 'testid=org-node-payments >> role=button[name=/Open details/]'`; `control-openhands browser text 'role=dialog'` reads `payments domain`, `Show as top of chart`, `Boundary memory is unavailable. The director may not be attached to a git repository.`, `Lead IC`, `Manager`, `Reviewer` and `This agent has no live conversation yet.` A team without sub-teams opens the same drawer from its only button: `control-openhands browser click 'testid=org-node-data.worker.module-03 >> role=button'` retitles the drawer `module-03`, with a fourth agent, `Worker`, and no `Show as top of chart`.
- **Teach (`F30.teach`).** `control-openhands fixture git-repo`, `control-openhands browser reload`, `control-openhands browser click 'testid=org-node-payments >> role=button[name=/Open details/]'`, `control-openhands browser fill 'role=dialog >> role=textbox' 'QA_rule: idempotency keys on every write.'`, `control-openhands browser click 'role=dialog >> role=button[name="Save rule"]'`. `control-openhands browser text 'role=dialog'` now lists the rule above the form. `control-openhands api GET /api/director/org/nodes/payments/blackboard --pick memory.rules` returns it, `git -C "$OH_VERIFY_RUN/workspace/qa-repo" show refs/agents/blackboard:services/payments/memory.json` holds it, and `git -C "$OH_VERIFY_RUN/workspace/qa-repo" status --porcelain` prints nothing.
- **Subtree (`F30.subtree`).** With the `payments domain` drawer open: `control-openhands browser click 'role=link[name="Show as top of chart"]' --expect-url '/org/payments$'`. `control-openhands browser text 'role=navigation[name="Org chart path"]'` reads `Root organization`, `payments domain`; the chart holds `payments domain` and its five services (count `6`); `control-openhands browser text 'role=region[name="Escalations"]'` starts `Escalations 1`. `control-openhands browser click 'role=navigation[name="Org chart path"] >> role=link[name="Root organization"]' --expect-url '/org/root$'` goes back up.
- **Unknown team (`F30.unknown-team`).** `control-openhands browser goto /org/nope`; `control-openhands browser text 'text=This team no longer exists'` matches.
- **No org tree (`F30.unavailable`).** In a run launched without `--director-fixture`: `control-openhands browser goto /org`; `control-openhands browser testids --filter org` lists only `sidebar-org-chart-link` (no `org-chart`), and `control-openhands api GET /api/director/org/nodes/root` is `404`.
- After the family, `control-openhands browser errors --app-only` shows no page errors. It does list the `503` from each blackboard request made before `fixture git-repo` and the `404` for `/org/nope`; those are expected.

## Gotchas

- `--director-fixture` is a launch flag, not something to export: runs are isolated from the operator's shell, so `OH_DIRECTOR_FIXTURE` set there never reaches the server.
- The fixture tree is read-only and identical on every start; nothing a recipe does changes it. Taught rules live in `qa-repo`'s hidden ref `refs/agents/blackboard` and disappear with the run.
- The drawer loads boundary memory when it opens. After `fixture git-repo`, reload (or reopen the drawer) to leave the unavailable state.
- A stock Agent Server answers `404` for every `/api/director/*` route, which the page shows as `F30.unavailable`, not as an error.
- Expanding or collapsing a team replaces the page's event stream with one for the new set of open teams, so each click shows as a new `tree-stream` request. That is by design, not a reconnect.
- What is expanded is page state: a reload, or moving to `/org/<id>`, starts from the top team and its direct reports again.
- Live changes (a team added or pruned, an escalation raised or settled) cannot be driven yet: no user action or API changes the tree until agents can. The page's handling of those events is covered by its unit tests only.
