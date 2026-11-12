import { act, screen, waitFor, within } from "@testing-library/react";
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
import { useOrgChartStore } from "#/stores/org-chart-store";
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

/** Still with the team above the one that raised it. */
const TOKEN_DECISION: Escalation = {
  id: "token-format",
  kind: "design_decision",
  title: "Pick a token format",
  detail: "JWT or opaque?",
  raised_at: "2026-11-10T00:00:00Z",
  held_by: "auth",
  handoffs: [],
};
/** Passed up by every team above billing, so it waits on the human. */
const DOUBLE_CHARGE: Escalation = {
  id: "double-charge",
  kind: "critical_issue",
  title: "Retries charge twice",
  detail: "",
  raised_at: "2026-11-11T00:00:00Z",
  held_by: null,
  handoffs: [
    {
      node_id: "root",
      reason: "Refunds need a person",
      at: "2026-11-11T01:00:00Z",
    },
  ],
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
    const full = params.get("full") === "true";
    const snapshot = focusId === null ? null : store.snapshot(focusId, full);
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
          full,
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
  window.localStorage.clear();
  useOrgChartStore.setState({ view: "focused", zoom: 1 });
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

  it("asks for every node below the one it follows when told to", async () => {
    const events: OrgEvent[] = [];

    const stop = subscribeOrgTree(
      "auth",
      { onEvent: (event) => events.push(event), onStatus: () => {} },
      true,
    );
    await waitFor(() => expect(events).toHaveLength(1));
    stop();

    expect(new URL(streamRequests[0].url).search).toBe("?node=auth&full=true");
  });
});

function card(id: string) {
  return screen.getByTestId(`org-node-${id}`);
}

function findCard(id: string, timeout?: number) {
  return screen.findByTestId(`org-node-${id}`, undefined, { timeout });
}

function cardIds() {
  return screen
    .getAllByTestId(/^org-node-/)
    .map((element) => element.getAttribute("data-testid")?.slice(9));
}

/** The card of the team the page is on; clicking it opens its details. */
function currentCard() {
  return screen.getByRole("button", { name: "ORG_CHART$OPEN_DETAILS" });
}

function teamLink(id: string) {
  return within(card(id)).getByRole("link");
}

function escalations() {
  return screen.getByRole("region", { name: "ORG_CHART$ESCALATIONS" });
}

function lastStream() {
  return new URL(streamRequests.at(-1)!.url).searchParams;
}

async function showWholeOrg(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "ORG_CHART$VIEW_FULL" }));
}

function badge(id: string) {
  return (
    within(card(id)).queryByRole("img", { name: "ORG_CHART$ESCALATION_COUNT" })
      ?.textContent ?? null
  );
}

describe("OrgChartView", () => {
  describe("one team at a time", () => {
    it("draws the team the page is on with its direct reports, and nothing else", async () => {
      renderWithProviders(<OrgChartView nodeId={null} />);

      const root = await findCard("root");

      expect(cardIds()).toEqual(["root", "auth", "billing", "search"]);
      expect(root).toHaveAttribute("data-current");
      expect(card("auth")).not.toHaveAttribute("data-current");
      expect(lastStream().toString()).toBe("");
    });

    it("moves to a report when it is clicked", async () => {
      store.upsert(input("a/b c", "root", "done", "services/odd"));
      renderWithProviders(<OrgChartView nodeId={null} />);
      await findCard("root");

      expect(teamLink("auth")).toHaveAttribute("href", "/org/auth");
      expect(teamLink("a/b c")).toHaveAttribute("href", "/org/a%2Fb%20c");
    });

    it("draws a line under each report that has sub-teams, and no other", async () => {
      renderWithProviders(<OrgChartView nodeId={null} />);
      await findCard("root");

      const hasLine = (id: string) =>
        card(id).closest("li")?.querySelector("[data-has-sub-teams]") !== null;

      expect(hasLine("auth")).toBe(true);
      expect(hasLine("billing")).toBe(false);
      expect(hasLine("search")).toBe(false);
    });

    it("leads up to the team above only when there is one", async () => {
      const { rerender } = renderWithProviders(<OrgChartView nodeId={null} />);
      await findCard("root");
      expect(
        screen.queryByRole("link", { name: "ORG_CHART$GO_UP" }),
      ).toBeNull();

      rerender(<OrgChartView nodeId="auth" />);

      expect(
        await screen.findByRole("link", { name: "ORG_CHART$GO_UP" }),
      ).toHaveAttribute("href", "/org/root");
      expect(cardIds()).toEqual(["auth", "oauth"]);
      expect(lastStream().toString()).toBe("node=auth");
    });

    it("draws a team without reports on its own", async () => {
      renderWithProviders(<OrgChartView nodeId="search" />);
      await findCard("search");

      expect(cardIds()).toEqual(["search"]);
    });

    it("keeps the previous team on screen until the next one arrives", async () => {
      const { rerender } = renderWithProviders(<OrgChartView nodeId={null} />);
      await findCard("root");

      rerender(<OrgChartView nodeId="auth" />);

      // Never a loading notice in between.
      expect(screen.queryByText("ORG_CHART$LOADING")).toBeNull();
      expect(card("root")).toBeInTheDocument();
      await waitFor(() => expect(cardIds()).toEqual(["auth", "oauth"]));
    });

    it("shows the way back up through the ancestors", async () => {
      renderWithProviders(<OrgChartView nodeId="oauth" />);

      const trail = await screen.findByRole("navigation", {
        name: "ORG_CHART$BREADCRUMB_LABEL",
      });

      expect(
        within(trail)
          .getAllByRole("link")
          .map((link) => link.getAttribute("href")),
      ).toEqual(["/org/root", "/org/auth"]);
      expect(within(trail).getByText("oauth team")).toHaveAttribute(
        "aria-current",
        "page",
      );
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
    it("shows a team's status, boundary, agents and escalations while its card has keyboard focus", async () => {
      const user = userEvent.setup();
      renderWithProviders(<OrgChartView nodeId="auth" />);
      await findCard("oauth");

      for (let presses = 0; presses < 12; presses += 1) {
        if (document.activeElement === teamLink("oauth")) break;
        await user.tab();
      }
      expect(teamLink("oauth")).toHaveFocus();

      const tip = await screen.findByRole("tooltip");
      expect(within(tip).getByText("oauth team")).toBeInTheDocument();
      expect(within(tip).getByText("Spec for oauth")).toBeInTheDocument();
      expect(
        within(tip).getByText("ORG_CHART$HEALTH_DONE"),
      ).toBeInTheDocument();
      expect(within(tip).getByText("services/auth/oauth")).toBeInTheDocument();
      expect(
        within(tip).getByText(/ORG_CHART\$ISOLATION_SHARED/),
      ).toBeInTheDocument();
      expect(
        within(tip).getByText("services/auth/oauth/**"),
      ).toBeInTheDocument();
      expect(within(tip).getByText("src/types/**")).toBeInTheDocument();
      expect(
        within(tip).getByText(
          "ORG_CHART$ROLE_LEAD_IC (running), ORG_CHART$ROLE_MANAGER (idle)",
        ),
      ).toBeInTheDocument();
      // What the team sent up, and that a team above still has it.
      expect(within(tip).getByText("Pick a token format")).toBeInTheDocument();
      expect(
        within(tip).getByText(/ORG_CHART\$ESCALATION_HELD_BY/),
      ).toBeInTheDocument();
    });
  });

  describe("the whole org", () => {
    it("draws every team once asked to, with reports nested under their team", async () => {
      const user = userEvent.setup();
      renderWithProviders(<OrgChartView nodeId={null} />);
      await findCard("root");

      await showWholeOrg(user);

      expect(await findCard("oauth")).toBeInTheDocument();
      expect(cardIds()).toEqual(["root", "auth", "oauth", "billing", "search"]);
      expect(card("auth").closest("li")).toContainElement(card("oauth"));
      expect(card("auth").closest("li")).not.toContainElement(card("billing"));
      expect(lastStream().toString()).toBe("full=true");
      expect(
        screen.getByRole("button", { name: "ORG_CHART$VIEW_FULL" }),
      ).toHaveAttribute("aria-pressed", "true");
    });

    it("marks the team the page is on and follows it without asking the server again", async () => {
      useOrgChartStore.setState({ view: "full" });
      const { rerender } = renderWithProviders(<OrgChartView nodeId="oauth" />);
      await findCard("oauth");

      expect(cardIds()).toEqual(["root", "auth", "oauth", "billing", "search"]);
      expect(card("oauth")).toHaveAttribute("data-current");
      expect(card("root")).not.toHaveAttribute("data-current");
      expect(teamLink("billing")).toHaveAttribute("href", "/org/billing");

      rerender(<OrgChartView nodeId="billing" />);

      expect(card("billing")).toHaveAttribute("data-current");
      expect(card("oauth")).not.toHaveAttribute("data-current");
      expect(streamRequests).toHaveLength(1);
    });

    it("keeps the team the page is on in the middle of the chart, through moves and zooming", async () => {
      const scrolled: Array<{ id: string | null; behavior?: string }> = [];
      const original = HTMLElement.prototype.scrollIntoView;
      HTMLElement.prototype.scrollIntoView = function scrollIntoView(
        options?: boolean | ScrollIntoViewOptions,
      ) {
        if (typeof options === "object") {
          expect(options).toMatchObject({ block: "center", inline: "center" });
          scrolled.push({
            id: this.getAttribute("data-testid"),
            behavior: options.behavior,
          });
        }
      };
      try {
        useOrgChartStore.setState({ view: "full" });
        const { rerender } = renderWithProviders(
          <OrgChartView nodeId="oauth" />,
        );
        await findCard("oauth");
        rerender(<OrgChartView nodeId="billing" />);

        act(() => useOrgChartStore.getState().zoomOut());

        // Jumps on arrival and on zoom, glides to a team already on screen.
        expect(scrolled).toEqual([
          { id: "org-node-oauth", behavior: "instant" },
          { id: "org-node-billing", behavior: "smooth" },
          { id: "org-node-billing", behavior: "instant" },
        ]);
      } finally {
        HTMLElement.prototype.scrollIntoView = original;
      }
    });

    it("says so when the page is on a team the org does not have", async () => {
      useOrgChartStore.setState({ view: "full" });
      renderWithProviders(<OrgChartView nodeId="missing" />);

      expect(
        await screen.findByText("ORG_CHART$NOT_FOUND_TITLE"),
      ).toBeInTheDocument();
    });

    it("goes back to one team at a time", async () => {
      useOrgChartStore.setState({ view: "full" });
      const user = userEvent.setup();
      renderWithProviders(<OrgChartView nodeId="auth" />);
      await findCard("billing");

      await user.click(
        screen.getByRole("button", { name: "ORG_CHART$VIEW_FOCUSED" }),
      );

      await waitFor(() => expect(cardIds()).toEqual(["auth", "oauth"]));
      expect(lastStream().toString()).toBe("node=auth");
    });
  });

  describe("view and zoom settings", () => {
    const stored = () =>
      JSON.parse(window.localStorage.getItem("openhands-org-chart") ?? "{}")
        .state;

    it("zooms the chart in and out and back to actual size", async () => {
      const user = userEvent.setup();
      renderWithProviders(<OrgChartView nodeId={null} />);
      await findCard("root");
      const zoomed = () =>
        screen
          .getByTestId("org-chart-zoom")
          .style.getPropertyValue("--org-chart-zoom");
      const reset = screen.getByRole("button", {
        name: "ORG_CHART$ZOOM_RESET",
      });
      expect([zoomed(), reset.textContent]).toEqual(["1", "100%"]);

      await user.click(
        screen.getByRole("button", { name: "ORG_CHART$ZOOM_OUT" }),
      );
      await user.click(
        screen.getByRole("button", { name: "ORG_CHART$ZOOM_OUT" }),
      );
      expect([zoomed(), reset.textContent]).toEqual(["0.8", "80%"]);

      await user.click(
        screen.getByRole("button", { name: "ORG_CHART$ZOOM_IN" }),
      );
      expect([zoomed(), reset.textContent]).toEqual(["0.9", "90%"]);

      await user.click(reset);
      expect([zoomed(), reset.textContent]).toEqual(["1", "100%"]);
    });

    it("stops at the smallest and largest zoom", async () => {
      useOrgChartStore.setState({ zoom: 0.3 });
      renderWithProviders(<OrgChartView nodeId={null} />);
      await findCard("root");

      expect(
        screen.getByRole("button", { name: "ORG_CHART$ZOOM_OUT" }),
      ).toBeDisabled();

      act(() => useOrgChartStore.setState({ zoom: 2 }));

      expect(
        screen.getByRole("button", { name: "ORG_CHART$ZOOM_IN" }),
      ).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "ORG_CHART$ZOOM_OUT" }),
      ).toBeEnabled();
    });

    it("remembers the zoom and the view", async () => {
      const user = userEvent.setup();
      renderWithProviders(<OrgChartView nodeId={null} />);
      await findCard("root");

      await user.click(
        screen.getByRole("button", { name: "ORG_CHART$ZOOM_IN" }),
      );
      await showWholeOrg(user);

      expect(stored()).toEqual({ view: "full", zoom: 1.1 });
    });

    it("applies the same zoom to both views", async () => {
      useOrgChartStore.setState({ zoom: 0.5 });
      const user = userEvent.setup();
      renderWithProviders(<OrgChartView nodeId={null} />);
      await findCard("root");

      await showWholeOrg(user);
      await findCard("oauth");

      expect(
        screen
          .getByTestId("org-chart-zoom")
          .style.getPropertyValue("--org-chart-zoom"),
      ).toBe("0.5");
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

    it("follows changes deep in the tree only when the whole org is drawn", async () => {
      const user = userEvent.setup();
      renderWithProviders(<OrgChartView nodeId={null} />);
      await findCard("root");

      store.upsert(input("saml", "auth", "converging", "services/auth/saml"));
      await showWholeOrg(user);
      await findCard("saml");
      store.upsert(input("device", "oauth", "done", "services/auth/oauth/d"));

      expect(await findCard("device")).toBeInTheDocument();
      store.remove("oauth");
      await waitFor(() =>
        expect(screen.queryByTestId("org-node-device")).toBeNull(),
      );
      expect(card("saml")).toBeInTheDocument();
    });

    it("explains that the team is gone when it is removed", async () => {
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

    it("stays gone when the team is removed along with an ancestor", async () => {
      renderWithProviders(<OrgChartView nodeId="oauth" />);
      await findCard("oauth");

      // Removing the parent reports the team first and the parent after it;
      // that second frame must not bring the chart back.
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

    it("says so in the whole-org view when the team the page is on is removed", async () => {
      useOrgChartStore.setState({ view: "full" });
      renderWithProviders(<OrgChartView nodeId="oauth" />);
      await findCard("oauth");

      store.remove("oauth");

      expect(
        await screen.findByText("ORG_CHART$NOT_FOUND_TITLE"),
      ).toBeInTheDocument();
    });

    it("reports an unknown team without retrying, and recovers on a team that exists", async () => {
      const { rerender } = renderWithProviders(
        <OrgChartView nodeId="missing" />,
      );

      expect(
        await screen.findByText("ORG_CHART$NOT_FOUND_TITLE"),
      ).toBeInTheDocument();
      await new Promise((resolve) => {
        setTimeout(resolve, 1200);
      });
      expect(streamRequests).toHaveLength(1);

      rerender(<OrgChartView nodeId="auth" />);

      expect(await findCard("auth")).toBeInTheDocument();
      expect(screen.queryByText("ORG_CHART$NOT_FOUND_TITLE")).toBeNull();
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
  });

  describe("escalations", () => {
    it("lists only what waits on the human, with where it came from and why each team passed it up", async () => {
      renderWithProviders(<OrgChartView nodeId={null} />);
      await findCard("root");

      const items = within(escalations()).getAllByRole("link");

      // The token decision is still with the auth team: not the human's yet.
      expect(items).toHaveLength(1);
      expect(items[0]).toHaveTextContent("ORG_CHART$ESCALATION_CRITICAL");
      expect(items[0]).toHaveTextContent("Retries charge twice");
      expect(items[0]).toHaveTextContent("root team › billing team");
      expect(items[0]).toHaveTextContent("ORG_CHART$ESCALATION_PASSED_UP");
      expect(items[0]).toHaveTextContent("root team: Refunds need a person");
      expect(items[0]).toHaveAttribute("href", "/org/billing");
      expect(
        within(escalations()).queryByText("Pick a token format"),
      ).toBeNull();
    });

    it("lists them whichever team the page is on", async () => {
      renderWithProviders(<OrgChartView nodeId="auth" />);
      await findCard("auth");

      expect(
        within(escalations()).getByText("Retries charge twice"),
      ).toBeInTheDocument();
    });

    it("marks the teams above one that waits on the human, and not one a team still holds", async () => {
      renderWithProviders(<OrgChartView nodeId={null} />);
      await findCard("root");

      expect({
        root: badge("root"),
        auth: badge("auth"),
        billing: badge("billing"),
        search: badge("search"),
      }).toEqual({ root: "1", auth: null, billing: "1", search: null });
    });

    it("adds one the moment the last team above passes it up, and drops it once settled", async () => {
      renderWithProviders(<OrgChartView nodeId={null} />);
      await findCard("root");

      // The auth team passes the decision up: now root holds it.
      const passedOnce: Escalation = {
        ...TOKEN_DECISION,
        held_by: "root",
        handoffs: [{ node_id: "auth", reason: "Affects billing too", at: "t" }],
      };
      store.upsert(
        input("oauth", "auth", "done", "services/auth/oauth", [passedOnce]),
      );
      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });
      expect(within(escalations()).getAllByRole("link")).toHaveLength(1);

      // Root passes it up too: nobody is left but the human.
      store.upsert(
        input("oauth", "auth", "done", "services/auth/oauth", [
          {
            ...passedOnce,
            held_by: null,
            handoffs: [
              ...passedOnce.handoffs,
              { node_id: "root", reason: "A product call", at: "t" },
            ],
          },
        ]),
      );

      const added = await within(escalations()).findByRole("link", {
        name: /Pick a token format/,
      });
      expect(added).toHaveTextContent("auth team: Affects billing too");
      expect(added).toHaveTextContent("root team: A product call");
      expect(added).toHaveTextContent("ORG_CHART$ESCALATION_DECISION");
      await waitFor(() => expect(badge("auth")).toBe("1"));
      expect(badge("root")).toBe("2");

      store.upsert(input("billing", "root", "converging", "services/billing"));

      await waitFor(() =>
        expect(
          within(escalations()).queryByText("Retries charge twice"),
        ).toBeNull(),
      );
      expect(badge("billing")).toBeNull();
    });

    it("says so when nothing waits on the human", async () => {
      store.upsert(input("billing", "root", "converging", "services/billing"));

      renderWithProviders(<OrgChartView nodeId={null} />);
      await findCard("root");

      expect(
        within(escalations()).getByText("ORG_CHART$ESCALATIONS_EMPTY"),
      ).toBeInTheDocument();
      expect(within(escalations()).queryByRole("link")).toBeNull();
    });
  });

  describe("team details", () => {
    it("opens when the team the page is on is clicked, on its first agent, and closes again", async () => {
      blackboardHandlers();
      const user = userEvent.setup();
      renderWithProviders(<OrgChartView nodeId="auth" />);
      await findCard("auth");

      await user.click(currentCard());

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

      await user.click(
        within(drawer).getByRole("button", {
          name: "ORG_CHART$INSPECTOR_CLOSE",
        }),
      );
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("opens from the whole-org view too", async () => {
      useOrgChartStore.setState({ view: "full" });
      blackboardHandlers();
      const user = userEvent.setup();
      renderWithProviders(<OrgChartView nodeId="oauth" />);
      await findCard("oauth");

      await user.click(currentCard());

      expect(
        screen.getByRole("dialog", { name: "oauth team" }),
      ).toBeInTheDocument();
    });

    it("mounts the conversation view targeted at the agent picked", async () => {
      blackboardHandlers();
      const user = userEvent.setup();
      renderWithProviders(<OrgChartView nodeId="auth" />, {
        navigation: { conversationId: "route-conversation" },
      });
      await findCard("auth");
      await user.click(currentCard());

      await user.click(
        within(screen.getByRole("dialog")).getByRole("button", {
          name: /ORG_CHART\$ROLE_MANAGER/,
        }),
      );

      expect(await screen.findByTestId("conversation-view")).toHaveTextContent(
        "conv-manager",
      );
    });

    it("closes on Escape, and when the page moves to another team", async () => {
      blackboardHandlers();
      const user = userEvent.setup();
      const { rerender } = renderWithProviders(<OrgChartView nodeId="auth" />);
      await findCard("auth");

      await user.click(currentCard());
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).toBeNull();

      await user.click(currentCard());
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      rerender(<OrgChartView nodeId="billing" />);
      await waitFor(() => expect(cardIds()).toEqual(["billing"]));
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("shows the boundary's rules and saves a newly taught one", async () => {
      const taught = blackboardHandlers(["Never log tokens."]);
      const user = userEvent.setup();
      renderWithProviders(<OrgChartView nodeId="auth" />);
      await findCard("auth");
      await user.click(currentCard());

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
      renderWithProviders(<OrgChartView nodeId="auth" />);
      await findCard("auth");

      await user.click(currentCard());

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
      renderWithProviders(<OrgChartView nodeId="auth" />);
      await findCard("auth");
      await user.click(currentCard());
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
      renderWithProviders(<OrgChartView nodeId="auth" />);
      await findCard("auth");

      await user.click(currentCard());

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "ORG_CHART$MEMORY_UNAVAILABLE",
      );
      expect(screen.queryByLabelText("ORG_CHART$TEACH_LABEL")).toBeNull();
    });
  });
});

describe("mock mode", () => {
  it("renders both views from the built-in mock handlers and remembers a taught rule", async () => {
    // No per-test stream handler: this exercises the default mock handlers.
    server.resetHandlers();
    const user = userEvent.setup();

    renderWithProviders(<OrgChartView nodeId="payments" />);

    expect(await findCard("payments.worker")).toBeInTheDocument();
    expect(cardIds()).toHaveLength(4);
    // One escalation has reached the human; the other is still with a team.
    expect(within(escalations()).getAllByRole("link")).toHaveLength(1);

    await showWholeOrg(user);
    await findCard("identity.api");
    expect(cardIds()).toHaveLength(17);

    await user.click(currentCard());
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
