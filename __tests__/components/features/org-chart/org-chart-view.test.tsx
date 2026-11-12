import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentRef,
  Escalation,
  NodeBlackboard,
  NodeHealth,
  OrgEvent,
} from "#/api/director/types";
import { subscribeOrgTree } from "#/api/director/director-client";
import * as activeStore from "#/api/backend-registry/active-store";
import { OrgChartView } from "#/components/features/org-chart/org-chart-view";
import { useNavigation } from "#/context/navigation-context";
import { server } from "#/mocks/node";
import { renderWithProviders } from "test-utils";
import { OrgStore, type OrgNodeInput } from "./fake-org-store.mjs";

// The real conversation view needs a live agent server. What matters here is
// that the inspector mounts it re-targeted at the inspected agent.
vi.mock("#/routes/conversation", () => ({
  ConversationView: () => {
    const { conversationId } = useNavigation();
    return <div data-testid="conversation-view">{conversationId}</div>;
  },
}));

const POD: AgentRef[] = [
  { role: "lead_ic", conversation_id: null, status: "running" },
  { role: "manager", conversation_id: "conv-manager", status: "idle" },
];

function input(
  id: string,
  parentId: string | null,
  health: NodeHealth,
  path: string,
  escalations: Escalation[] = [],
): OrgNodeInput {
  return {
    id,
    parent_id: parentId,
    title: `${id} team`,
    boundary: { path, writable: [`${path}/**`], readonly: ["src/types/**"] },
    isolation: parentId === "auth" ? "shared" : "worktree",
    worktree_path: ".",
    branch: `agents/${id}`,
    agents: POD,
    health,
    spec_summary: `Spec for ${id}`,
    escalations,
  };
}

const TOKEN_DECISION: Escalation = {
  id: "token-format",
  kind: "design_decision",
  title: "Pick a token format",
  detail: "JWT or opaque?",
  raised_at: "2026-11-10T00:00:00Z",
};
const DOUBLE_CHARGE: Escalation = {
  id: "double-charge",
  kind: "critical_issue",
  title: "Retries charge twice",
  detail: "",
  raised_at: "2026-11-11T00:00:00Z",
};

/** A fake of the server's org store drives the stream with realistic events. */
let store: OrgStore;
let streams: Array<{ close: () => void }>;
let streamRequests: Request[];

function frame(event: OrgEvent) {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

function streamHandler() {
  return http.get("*/api/director/org/tree-stream", ({ request }) => {
    streamRequests.push(request);
    const params = new URL(request.url).searchParams;
    const focusId = params.get("node") ?? store.rootId;
    const expanded = params.getAll("expanded");
    const snapshot =
      focusId === null ? null : store.snapshot(focusId, expanded);
    if (!snapshot) {
      return HttpResponse.json({ detail: "Unknown node" }, { status: 404 });
    }
    let unsubscribe = () => {};
    const handle = { close: () => {} };
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(frame(snapshot));
        // A heartbeat comment, as the real server sends.
        controller.enqueue(new TextEncoder().encode(": keep-alive\n\n"));
        unsubscribe = store.subscribe(
          String(focusId),
          (event) => controller.enqueue(frame(event)),
          expanded,
        );
        handle.close = () => {
          unsubscribe();
          controller.close();
        };
        streams.push(handle);
      },
      cancel: () => unsubscribe(),
    });
    return new HttpResponse(stream, {
      headers: { "Content-Type": "text/event-stream" },
    });
  });
}

function blackboardHandlers(initialRules: string[] = []) {
  let rules = initialRules;
  const taught: Array<{ nodeId: string; rule: string }> = [];
  server.use(
    http.get("*/api/director/org/nodes/:nodeId/blackboard", () => {
      const body: NodeBlackboard = {
        specs: [],
        memory: { rules },
        autopsies: [],
      };
      return HttpResponse.json(body);
    }),
    http.post(
      "*/api/director/org/nodes/:nodeId/teach",
      async ({ params, request }) => {
        const { rule } = (await request.json()) as { rule: string };
        taught.push({ nodeId: String(params.nodeId), rule });
        rules = [...rules, rule];
        return HttpResponse.json({ rules });
      },
    ),
  );
  return taught;
}

beforeEach(() => {
  streams = [];
  streamRequests = [];
  store = new OrgStore();
  store.upsert(input("root", null, "converging", ""));
  store.upsert(input("auth", "root", "converging", "services/auth"));
  store.upsert(
    input("billing", "root", "needs_attention", "services/billing", [
      DOUBLE_CHARGE,
    ]),
  );
  store.upsert(input("search", "root", "converging", "services/search"));
  store.upsert(
    input("oauth", "auth", "done", "services/auth/oauth", [TOKEN_DECISION]),
  );
  server.use(streamHandler());
});

afterEach(() => {
  vi.restoreAllMocks();
  streams.forEach((stream) => {
    try {
      stream.close();
    } catch {
      // Already closed by the test.
    }
  });
});

describe("subscribeOrgTree", () => {
  it("delivers nothing more once unsubscribed", async () => {
    const events: OrgEvent[] = [];
    const stop = subscribeOrgTree("root", {
      onEvent: (event) => events.push(event),
      onStatus: () => {},
    });
    await waitFor(() => expect(events).toHaveLength(1));

    stop();
    store.upsert(input("late", "root", "done", "services/late"));
    await new Promise((resolve) => {
      setTimeout(resolve, 1200);
    });

    expect(events.map((event) => event.type)).toEqual(["snapshot"]);
    expect(streamRequests).toHaveLength(1);
  });

  it("authenticates with the active local backend's session key", async () => {
    const backend = activeStore.getEffectiveLocalBackend();
    vi.spyOn(activeStore, "getEffectiveLocalBackend").mockReturnValue({
      ...backend!,
      host: "http://director-host.test/",
      apiKey: " secret-key ",
    });
    const statuses: string[] = [];

    const stop = subscribeOrgTree(null, {
      onEvent: () => {},
      onStatus: (status) => statuses.push(status),
    });
    await waitFor(() => expect(statuses).toContain("live"));
    stop();

    expect(streamRequests[0].url).toBe(
      "http://director-host.test/api/director/org/tree-stream",
    );
    expect(streamRequests[0].headers.get("X-Session-API-Key")).toBe(
      "secret-key",
    );
  });

  it("reports the director as unavailable when no local backend is active", async () => {
    vi.spyOn(activeStore, "getEffectiveLocalBackend").mockReturnValue(null);
    const statuses: string[] = [];

    const stop = subscribeOrgTree(null, {
      onEvent: () => {},
      onStatus: (status) => statuses.push(status),
    });
    await waitFor(() => expect(statuses).toContain("unavailable"));
    stop();

    expect(streamRequests).toHaveLength(0);
  });

  it("asks for the reports of every expanded node", async () => {
    const events: OrgEvent[] = [];

    const stop = subscribeOrgTree(
      null,
      { onEvent: (event) => events.push(event), onStatus: () => {} },
      ["auth", "a b"],
    );
    await waitFor(() => expect(events).toHaveLength(1));
    stop();

    expect(
      new URL(streamRequests[0].url).searchParams.getAll("expanded"),
    ).toEqual(["auth", "a b"]);
    expect(events[0]).toMatchObject({
      nodes: [
        { id: "root" },
        { id: "auth" },
        { id: "billing" },
        { id: "search" },
        { id: "oauth" },
      ],
    });
  });
});

function card(id: string) {
  return screen.getByTestId(`org-node-${id}`);
}

function findCard(id: string, timeout?: number) {
  return screen.findByTestId(`org-node-${id}`, undefined, { timeout });
}

/** The part of a card that expands a team, or opens a leaf team's details. */
function title(id: string) {
  return within(card(id)).getByRole("button", {
    name: new RegExp(`^${id} team`),
  });
}

function detailsButton(id: string) {
  return within(card(id)).getByRole("button", {
    name: "ORG_CHART$OPEN_DETAILS",
  });
}

function cardIds() {
  return screen
    .getAllByTestId(/^org-node-/)
    .map((element) => element.getAttribute("data-testid")?.slice(9));
}

function escalations() {
  return screen.getByRole("region", { name: "ORG_CHART$ESCALATIONS" });
}

describe("OrgChartView", () => {
  describe("chart", () => {
    it("draws the top team with its direct reports below it and nothing deeper", async () => {
      renderWithProviders(<OrgChartView nodeId={null} />);

      const root = await findCard("root");

      expect(cardIds()).toEqual(["root", "auth", "billing", "search"]);
      // Reports hang in a list inside their manager's own list item.
      const branch = root.closest("li");
      expect(branch).toContainElement(card("auth"));
      expect(card("auth").closest("li")).not.toContainElement(card("billing"));
      expect(title("root")).toHaveAttribute("aria-expanded", "true");
      expect(title("auth")).toHaveAttribute("aria-expanded", "false");
      // A team without sub-teams has nothing to expand.
      expect(title("search")).not.toHaveAttribute("aria-expanded");
    });

    it("keeps status and boundaries out of the chart", async () => {
      renderWithProviders(<OrgChartView nodeId={null} />);
      await findCard("root");

      expect(screen.queryByText(/ORG_CHART\$HEALTH_/)).toBeNull();
      expect(screen.queryByText(/services\/auth/)).toBeNull();
      expect(screen.queryByText(/ORG_CHART\$ISOLATION_/)).toBeNull();
      expect(screen.queryByText("Spec for auth")).toBeNull();
    });

    // Hovering opens the same card; jsdom only drives it reliably by focus.
    it("shows a team's status, boundary and agents while its card has keyboard focus", async () => {
      const user = userEvent.setup();
      renderWithProviders(<OrgChartView nodeId={null} />);
      await findCard("root");

      for (let presses = 0; presses < 10; presses += 1) {
        if (document.activeElement === title("auth")) break;
        await user.tab();
      }
      expect(title("auth")).toHaveFocus();

      const tip = await screen.findByRole("tooltip");
      expect(within(tip).getByText("Spec for auth")).toBeInTheDocument();
      expect(
        within(tip).getByText("ORG_CHART$HEALTH_CONVERGING"),
      ).toBeInTheDocument();
      expect(within(tip).getByText("services/auth")).toBeInTheDocument();
      expect(
        within(tip).getByText(/ORG_CHART\$ISOLATION_WORKTREE/),
      ).toBeInTheDocument();
      expect(within(tip).getByText("services/auth/**")).toBeInTheDocument();
      expect(within(tip).getByText("src/types/**")).toBeInTheDocument();
      expect(
        within(tip).getByText(
          "ORG_CHART$ROLE_LEAD_IC (running), ORG_CHART$ROLE_MANAGER (idle)",
        ),
      ).toBeInTheDocument();

      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
    });

    it("expands a team when it is clicked and collapses it when clicked again", async () => {
      const user = userEvent.setup();
      renderWithProviders(<OrgChartView nodeId={null} />);
      await findCard("root");

      await user.click(title("auth"));

      expect(await findCard("oauth")).toBeInTheDocument();
      expect(card("auth").closest("li")).toContainElement(card("oauth"));
      expect(title("auth")).toHaveAttribute("aria-expanded", "true");
      expect(
        new URL(streamRequests.at(-1)!.url).searchParams.getAll("expanded"),
      ).toEqual(["auth"]);

      await user.click(title("auth"));

      expect(screen.queryByTestId("org-node-oauth")).toBeNull();
      expect(title("auth")).toHaveAttribute("aria-expanded", "false");
      // The rest of the chart stays as it was.
      expect(cardIds()).toEqual(["root", "auth", "billing", "search"]);
    });

    it("expands each team on its own", async () => {
      store.upsert(
        input("invoices", "billing", "done", "services/billing/inv"),
      );
      const user = userEvent.setup();
      renderWithProviders(<OrgChartView nodeId={null} />);
      await findCard("root");

      await user.click(title("auth"));
      await findCard("oauth");
      await user.click(title("billing"));
      await findCard("invoices");
      expect(card("oauth")).toBeInTheDocument();

      await user.click(title("auth"));

      expect(screen.queryByTestId("org-node-oauth")).toBeNull();
      expect(card("invoices")).toBeInTheDocument();
      expect(title("billing")).toHaveAttribute("aria-expanded", "true");
    });

    it("collapses the top team down to a single card", async () => {
      const user = userEvent.setup();
      renderWithProviders(<OrgChartView nodeId={null} />);
      await findCard("root");

      await user.click(title("root"));

      expect(cardIds()).toEqual(["root"]);
      expect(title("root")).toHaveAttribute("aria-expanded", "false");
    });

    it("starts the chart at the requested team and links back up through its ancestors", async () => {
      renderWithProviders(<OrgChartView nodeId="auth" />);

      const trail = await screen.findByRole("navigation", {
        name: "ORG_CHART$BREADCRUMB_LABEL",
      });

      expect(new URL(streamRequests[0].url).searchParams.get("node")).toBe(
        "auth",
      );
      expect(
        within(trail).getByRole("link", { name: "root team" }),
      ).toHaveAttribute("href", "/org/root");
      expect(within(trail).getByText("auth team")).toHaveAttribute(
        "aria-current",
        "page",
      );
      expect(cardIds()).toEqual(["auth", "oauth"]);
    });

    it("shows no trail at the root of the tree", async () => {
      renderWithProviders(<OrgChartView nodeId={null} />);
      await findCard("root");

      expect(screen.queryByRole("navigation")).toBeNull();
    });
  });

  describe("live updates", () => {
    it("adds and removes cards as teams are spawned and pruned", async () => {
      renderWithProviders(<OrgChartView nodeId={null} />);
      await findCard("root");

      store.upsert(
        input("growth", "root", "negotiating_split", "services/growth"),
      );
      expect(await findCard("growth")).toBeInTheDocument();

      store.remove("billing");
      await waitFor(() =>
        expect(screen.queryByTestId("org-node-billing")).toBeNull(),
      );
    });

    it("follows changes below an expanded team, and not below a collapsed one", async () => {
      const user = userEvent.setup();
      renderWithProviders(<OrgChartView nodeId={null} />);
      await findCard("root");
      await user.click(title("auth"));
      await findCard("oauth");

      store.upsert(input("saml", "auth", "converging", "services/auth/saml"));
      store.upsert(
        input("ledger", "billing", "done", "services/billing/ledger"),
      );

      expect(await findCard("saml")).toBeInTheDocument();
      // billing gained its first sub-team, so it can now be expanded.
      await waitFor(() =>
        expect(title("billing")).toHaveAttribute("aria-expanded", "false"),
      );
      expect(screen.queryByTestId("org-node-ledger")).toBeNull();
    });

    it("explains that the team is gone when the top node is removed", async () => {
      renderWithProviders(<OrgChartView nodeId="auth" />);
      await findCard("auth");

      store.remove("auth");

      expect(
        await screen.findByText("ORG_CHART$NOT_FOUND_TITLE"),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "ORG_CHART$BACK_TO_ROOT" }),
      ).toHaveAttribute("href", "/org");
    });

    it("stays gone when the top node is removed along with an ancestor", async () => {
      renderWithProviders(<OrgChartView nodeId="oauth" />);
      await findCard("oauth");

      // Removing the parent reports the top node first and the parent after
      // it; that second frame must not bring the chart back.
      store.remove("auth");

      expect(
        await screen.findByText("ORG_CHART$NOT_FOUND_TITLE"),
      ).toBeInTheDocument();
      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });
      expect(screen.getByText("ORG_CHART$NOT_FOUND_TITLE")).toBeInTheDocument();
      expect(screen.queryByTestId("org-node-oauth")).toBeNull();
    });

    it("reports an unknown node without retrying", async () => {
      renderWithProviders(<OrgChartView nodeId="missing" />);

      expect(
        await screen.findByText("ORG_CHART$NOT_FOUND_TITLE"),
      ).toBeInTheDocument();
      await new Promise((resolve) => {
        setTimeout(resolve, 1200);
      });
      expect(streamRequests).toHaveLength(1);
    });

    it("treats a backend without an org tree as unavailable and keeps retrying", async () => {
      // A stock Agent Server has no director API, and a new one has no tree
      // yet: both answer 404 for the root.
      let attempts = 0;
      server.use(
        http.get(
          "*/api/director/org/tree-stream",
          () => {
            attempts += 1;
            return HttpResponse.json({ detail: "Not Found" }, { status: 404 });
          },
          { once: true },
        ),
      );

      renderWithProviders(<OrgChartView nodeId={null} />);

      expect(
        await screen.findByText("ORG_CHART$UNAVAILABLE_TITLE"),
      ).toBeInTheDocument();
      expect(await findCard("root", 4000)).toBeInTheDocument();
      expect(attempts).toBe(1);
    });

    it("says the director is offline, then recovers by itself once it is back", async () => {
      let failures = 0;
      server.use(
        http.get(
          "*/api/director/org/tree-stream",
          () => {
            failures += 1;
            return HttpResponse.json({ detail: "down" }, { status: 503 });
          },
          { once: true },
        ),
      );

      renderWithProviders(<OrgChartView nodeId={null} />);

      expect(
        await screen.findByText("ORG_CHART$UNAVAILABLE_TITLE"),
      ).toBeInTheDocument();
      expect(await findCard("root", 4000)).toBeInTheDocument();
      expect(failures).toBe(1);
    });

    it("keeps the last chart while reconnecting, then replaces it with the fresh snapshot", async () => {
      renderWithProviders(<OrgChartView nodeId={null} />);
      await findCard("root");

      streams[0].close();

      expect(await screen.findByRole("status")).toHaveTextContent(
        "ORG_CHART$RECONNECTING",
      );
      expect(card("billing")).toBeVisible();

      // Changed while disconnected: only the new snapshot can deliver this.
      store.remove("billing");

      await waitFor(
        () => expect(screen.queryByTestId("org-node-billing")).toBeNull(),
        { timeout: 4000 },
      );
      expect(screen.queryByRole("status")).toBeNull();
      expect(streamRequests).toHaveLength(2);
    });

    it("keeps the chart on screen while an expansion is being fetched", async () => {
      const user = userEvent.setup();
      renderWithProviders(<OrgChartView nodeId={null} />);
      await findCard("root");
      server.use(
        http.get(
          "*/api/director/org/tree-stream",
          () => HttpResponse.json({ detail: "down" }, { status: 503 }),
          { once: true },
        ),
      );

      await user.click(title("auth"));

      // The failed attempt neither blanks the chart nor loses the request.
      expect(await screen.findByRole("status")).toHaveTextContent(
        "ORG_CHART$RECONNECTING",
      );
      expect(cardIds()).toEqual(["root", "auth", "billing", "search"]);
      expect(await findCard("oauth", 4000)).toBeInTheDocument();
      expect(screen.queryByRole("status")).toBeNull();
    });

    it("starts over when the route moves to another team", async () => {
      const user = userEvent.setup();
      const { rerender } = renderWithProviders(<OrgChartView nodeId={null} />);
      await findCard("root");
      await user.click(title("auth"));
      await findCard("oauth");

      rerender(<OrgChartView nodeId="billing" />);

      await waitFor(() => expect(cardIds()).toEqual(["billing"]));
      expect(
        new URL(streamRequests.at(-1)!.url).searchParams.getAll("expanded"),
      ).toEqual([]);
    });
  });

  describe("escalations", () => {
    it("lists what is waiting on the human, critical issues first, with the path each came up", async () => {
      renderWithProviders(<OrgChartView nodeId={null} />);
      await findCard("root");

      const items = within(escalations()).getAllByRole("button");

      expect(items).toHaveLength(2);
      expect(items[0]).toHaveTextContent("ORG_CHART$ESCALATION_CRITICAL");
      expect(items[0]).toHaveTextContent("Retries charge twice");
      expect(items[0]).toHaveTextContent("root team › billing team");
      expect(items[1]).toHaveTextContent("ORG_CHART$ESCALATION_DECISION");
      expect(items[1]).toHaveTextContent("Pick a token format");
      expect(items[1]).toHaveTextContent("JWT or opaque?");
      expect(items[1]).toHaveTextContent("root team › auth team › oauth team");
    });

    it("lists an escalation raised below a collapsed team", async () => {
      renderWithProviders(<OrgChartView nodeId={null} />);
      await findCard("root");

      expect(screen.queryByTestId("org-node-oauth")).toBeNull();
      expect(
        within(escalations()).getByText("Pick a token format"),
      ).toBeInTheDocument();
    });

    it("marks every team on the way down to an escalation, and no other", async () => {
      renderWithProviders(<OrgChartView nodeId={null} />);
      await findCard("root");

      const marked = Object.fromEntries(
        ["root", "auth", "billing", "search"].map((id) => [
          id,
          within(card(id)).queryByRole("img", {
            name: "ORG_CHART$ESCALATION_COUNT",
          })?.textContent ?? null,
        ]),
      );

      expect(marked).toEqual({
        root: "2",
        auth: "1",
        billing: "1",
        search: null,
      });
    });

    it("opens the chart down to the team that raised the one clicked", async () => {
      store.upsert(input("device", "oauth", "done", "services/auth/oauth/d"));
      const user = userEvent.setup();
      renderWithProviders(<OrgChartView nodeId={null} />);
      await findCard("root");
      await user.click(title("root"));

      await user.click(
        within(escalations()).getByRole("button", {
          name: /Pick a token format/,
        }),
      );

      expect(await findCard("oauth")).toHaveAttribute("data-highlighted");
      expect(title("root")).toHaveAttribute("aria-expanded", "true");
      expect(title("auth")).toHaveAttribute("aria-expanded", "true");
      // The team itself is shown, not opened.
      expect(title("oauth")).toHaveAttribute("aria-expanded", "false");
      expect(card("billing")).not.toHaveAttribute("data-highlighted");
    });

    it("lists only what is at or below the top of the chart", async () => {
      renderWithProviders(<OrgChartView nodeId="auth" />);
      await findCard("auth");

      const items = within(escalations()).getAllByRole("button");

      expect(items).toHaveLength(1);
      expect(items[0]).toHaveTextContent("Pick a token format");
    });

    it("reveals from a chart that starts below the root", async () => {
      store.upsert(
        input("device", "oauth", "done", "services/auth/oauth/d", [
          { ...DOUBLE_CHARGE, id: "deep", title: "Deep issue" },
        ]),
      );
      const user = userEvent.setup();
      renderWithProviders(<OrgChartView nodeId="auth" />);
      await findCard("auth");

      await user.click(
        within(escalations()).getByRole("button", { name: /Deep issue/ }),
      );

      expect(await findCard("device")).toHaveAttribute("data-highlighted");
      expect(
        new URL(streamRequests.at(-1)!.url).searchParams.getAll("expanded"),
      ).toEqual(["oauth"]);
    });

    it("adds and drops escalations as they are raised and settled", async () => {
      renderWithProviders(<OrgChartView nodeId={null} />);
      await findCard("root");

      store.upsert(input("billing", "root", "converging", "services/billing"));
      store.upsert(
        input("search", "root", "converging", "services/search", [
          { ...TOKEN_DECISION, id: "ranking", title: "Rank by recency?" },
        ]),
      );

      expect(
        await within(escalations()).findByText("Rank by recency?"),
      ).toBeInTheDocument();
      expect(
        within(escalations()).queryByText("Retries charge twice"),
      ).toBeNull();
      expect(
        within(card("billing")).queryByRole("img", {
          name: "ORG_CHART$ESCALATION_COUNT",
        }),
      ).toBeNull();
    });

    it("says so when nothing is waiting", async () => {
      store.upsert(input("billing", "root", "converging", "services/billing"));
      store.upsert(input("oauth", "auth", "done", "services/auth/oauth"));

      renderWithProviders(<OrgChartView nodeId={null} />);
      await findCard("root");

      expect(
        within(escalations()).getByText("ORG_CHART$ESCALATIONS_EMPTY"),
      ).toBeInTheDocument();
      expect(within(escalations()).queryByRole("button")).toBeNull();
    });
  });

  describe("team details", () => {
    it("opens from a team's details button, on its first agent, and closes again", async () => {
      blackboardHandlers();
      const user = userEvent.setup();
      renderWithProviders(<OrgChartView nodeId={null} />);
      await findCard("root");

      await user.click(detailsButton("auth"));

      const drawer = screen.getByRole("dialog", { name: "auth team" });
      expect(
        within(drawer).getByRole("button", {
          name: /ORG_CHART\$ROLE_LEAD_IC/,
        }),
      ).toHaveAttribute("aria-pressed", "true");
      expect(
        within(drawer).getByText("ORG_CHART$NO_CONVERSATION"),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("conversation-view")).toBeNull();
      // Opening details does not expand the team.
      expect(title("auth")).toHaveAttribute("aria-expanded", "false");

      await user.click(
        within(drawer).getByRole("button", {
          name: "ORG_CHART$INSPECTOR_CLOSE",
        }),
      );
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("opens when a team without sub-teams is clicked", async () => {
      blackboardHandlers();
      const user = userEvent.setup();
      renderWithProviders(<OrgChartView nodeId={null} />);
      await findCard("root");

      await user.click(title("search"));

      expect(
        screen.getByRole("dialog", { name: "search team" }),
      ).toBeInTheDocument();
    });

    it("mounts the conversation view targeted at the agent picked", async () => {
      blackboardHandlers();
      const user = userEvent.setup();
      renderWithProviders(<OrgChartView nodeId={null} />, {
        navigation: { conversationId: "route-conversation" },
      });
      await findCard("root");
      await user.click(detailsButton("auth"));

      await user.click(
        within(screen.getByRole("dialog")).getByRole("button", {
          name: /ORG_CHART\$ROLE_MANAGER/,
        }),
      );

      expect(await screen.findByTestId("conversation-view")).toHaveTextContent(
        "conv-manager",
      );
    });

    it("closes on Escape, and when the team is collapsed out of the chart", async () => {
      blackboardHandlers();
      const user = userEvent.setup();
      renderWithProviders(<OrgChartView nodeId={null} />);
      await findCard("root");

      await user.click(detailsButton("auth"));
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).toBeNull();

      await user.click(title("auth"));
      await user.click(within(await findCard("oauth")).getByRole("button"));
      expect(
        screen.getByRole("dialog", { name: "oauth team" }),
      ).toBeInTheDocument();
      await user.click(title("auth"));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });

    it("offers to restart the chart from a team that has sub-teams and is not already on top", async () => {
      store.upsert(input("a/b c", "root", "done", "services/odd"));
      store.upsert(input("leaf", "a/b c", "done", "services/odd/leaf"));
      blackboardHandlers();
      const user = userEvent.setup();
      renderWithProviders(<OrgChartView nodeId={null} />);
      await findCard("root");
      const link = () =>
        screen.queryByRole("link", { name: "ORG_CHART$VIEW_AS_ROOT" });

      await user.click(detailsButton("a/b c"));
      expect(link()).toHaveAttribute("href", "/org/a%2Fb%20c");

      await user.click(detailsButton("root"));
      expect(
        screen.getByRole("dialog", { name: "root team" }),
      ).toBeInTheDocument();
      expect(link()).toBeNull();

      await user.click(title("search"));
      expect(
        screen.getByRole("dialog", { name: "search team" }),
      ).toBeInTheDocument();
      expect(link()).toBeNull();
    });

    it("shows the boundary's rules and saves a newly taught one", async () => {
      const taught = blackboardHandlers(["Never log tokens."]);
      const user = userEvent.setup();
      renderWithProviders(<OrgChartView nodeId={null} />);
      await findCard("root");
      await user.click(detailsButton("auth"));

      const memory = await screen.findByRole("region", {
        name: "ORG_CHART$MEMORY_TITLE",
      });
      expect(
        await within(memory).findByText("Never log tokens."),
      ).toBeInTheDocument();
      const save = within(memory).getByRole("button", {
        name: "ORG_CHART$TEACH_SUBMIT",
      });
      expect(save).toBeDisabled();

      await user.type(
        within(memory).getByLabelText("ORG_CHART$TEACH_LABEL"),
        "  Rotate keys weekly.  ",
      );
      await user.click(save);

      expect(
        await within(memory).findByText("Rotate keys weekly."),
      ).toBeInTheDocument();
      expect(taught).toEqual([{ nodeId: "auth", rule: "Rotate keys weekly." }]);
      expect(
        within(memory).getByLabelText("ORG_CHART$TEACH_LABEL"),
      ).toHaveValue("");
    });

    it("says so when there are no rules yet", async () => {
      blackboardHandlers();
      const user = userEvent.setup();
      renderWithProviders(<OrgChartView nodeId={null} />);
      await findCard("root");

      await user.click(detailsButton("auth"));

      expect(
        await screen.findByText("ORG_CHART$MEMORY_EMPTY"),
      ).toBeInTheDocument();
    });

    it("keeps the draft and reports the failure when saving a rule fails", async () => {
      blackboardHandlers();
      server.use(
        http.post("*/api/director/org/nodes/:nodeId/teach", () =>
          HttpResponse.json({ detail: "boom" }, { status: 500 }),
        ),
      );
      const user = userEvent.setup();
      renderWithProviders(<OrgChartView nodeId={null} />);
      await findCard("root");
      await user.click(detailsButton("auth"));
      const field = await screen.findByLabelText("ORG_CHART$TEACH_LABEL");

      await user.type(field, "A rule");
      await user.click(
        screen.getByRole("button", { name: "ORG_CHART$TEACH_SUBMIT" }),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "ORG_CHART$TEACH_ERROR",
      );
      expect(field).toHaveValue("A rule");
    });

    it("explains when the boundary memory cannot be read", async () => {
      server.use(
        http.get("*/api/director/org/nodes/:nodeId/blackboard", () =>
          HttpResponse.json({ detail: "No blackboard" }, { status: 503 }),
        ),
      );
      const user = userEvent.setup();
      renderWithProviders(<OrgChartView nodeId={null} />);
      await findCard("root");

      await user.click(detailsButton("auth"));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "ORG_CHART$MEMORY_UNAVAILABLE",
      );
      expect(screen.queryByLabelText("ORG_CHART$TEACH_LABEL")).toBeNull();
    });
  });
});

describe("mock mode", () => {
  it("renders the org chart from the built-in mock handlers, expands a team and remembers a taught rule", async () => {
    // No per-test stream handler: this exercises the default mock handlers.
    server.resetHandlers();
    const user = userEvent.setup();

    renderWithProviders(<OrgChartView nodeId={null} />);

    const payments = await screen.findByTestId("org-node-payments");
    expect(
      within(
        screen.getByRole("region", { name: "ORG_CHART$ESCALATIONS" }),
      ).getAllByRole("button"),
    ).toHaveLength(2);

    await user.click(
      within(payments).getByRole("button", { name: /^payments domain/ }),
    );
    const worker = await screen.findByTestId("org-node-payments.worker");
    await user.click(within(worker).getByRole("button"));
    await user.type(
      await screen.findByLabelText("ORG_CHART$TEACH_LABEL"),
      "Idempotency keys on every write.",
    );
    await user.click(
      screen.getByRole("button", { name: "ORG_CHART$TEACH_SUBMIT" }),
    );

    expect(
      await screen.findByText("Idempotency keys on every write."),
    ).toBeInTheDocument();
  });
});
