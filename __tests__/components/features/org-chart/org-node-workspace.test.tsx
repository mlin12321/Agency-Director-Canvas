import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentRef,
  NodeBlackboard,
  NodeHealth,
  OrgEvent,
} from "#/api/director/types";
import { subscribeOrgTree } from "#/api/director/director-client";
import * as activeStore from "#/api/backend-registry/active-store";
import { OrgNodeWorkspace } from "#/components/features/org-chart/org-node-workspace";
import { useNavigation } from "#/context/navigation-context";
import { server } from "#/mocks/node";
import { renderWithProviders } from "test-utils";
import {
  OrgStore,
  type OrgNodeInput,
} from "../../../../director/org/org-store.mjs";

// The real conversation view needs a live agent server. What matters here is
// that the inspector mounts it re-targeted at the inspected agent.
vi.mock("#/routes/conversation", () => ({
  ConversationView: () => {
    const { conversationId } = useNavigation();
    return <div data-testid="conversation-view">{conversationId}</div>;
  },
}));

const POD: AgentRef[] = [
  { role: "lead_ic", conversationId: null, status: "running" },
  { role: "manager", conversationId: "conv-manager", status: "idle" },
];

function input(
  id: string,
  parentId: string | null,
  health: NodeHealth,
  path: string,
): OrgNodeInput {
  return {
    id,
    parentId,
    title: `${id} team`,
    boundary: { path, writable: [`${path}/**`], readonly: ["src/types/**"] },
    isolation: parentId === "auth" ? "shared" : "worktree",
    worktreePath: ".",
    branch: `agents/${id}`,
    agents: POD,
    health,
    specSummary: `Spec for ${id}`,
  };
}

/** The real director store drives the stream, so events are the real ones. */
let store: OrgStore;
let streams: Array<{ close: () => void }>;
let streamRequests: Request[];

function frame(event: OrgEvent) {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

function streamHandler() {
  return http.get("*/api/director/org/tree-stream", ({ request }) => {
    streamRequests.push(request);
    const focusId =
      new URL(request.url).searchParams.get("node") ?? store.rootId;
    const snapshot = focusId === null ? null : store.snapshot(focusId);
    if (!snapshot) {
      return HttpResponse.json({ error: "Unknown node" }, { status: 404 });
    }
    let unsubscribe = () => {};
    const handle = { close: () => {} };
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(frame(snapshot));
        // A heartbeat comment, as the real server sends.
        controller.enqueue(new TextEncoder().encode(": keep-alive\n\n"));
        unsubscribe = store.subscribe(String(focusId), (event) =>
          controller.enqueue(frame(event)),
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
  store.upsert(input("billing", "root", "needs_attention", "services/billing"));
  store.upsert(input("search", "root", "converging", "services/search"));
  store.upsert(input("oauth", "auth", "done", "services/auth/oauth"));
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

function reportSection(name: string) {
  const reports = screen.getByRole("region", {
    name: "ORG_CHART$DIRECT_REPORTS",
  });
  return within(reports).getByRole("region", { name });
}

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
});

describe("OrgNodeWorkspace", () => {
  it("shows the root team, its pod and its reports grouped by state, most urgent first", async () => {
    renderWithProviders(<OrgNodeWorkspace nodeId={null} />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "root team" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Spec for root")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /ORG_CHART\$ROLE_LEAD_IC/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /ORG_CHART\$ROLE_MANAGER/ }),
    ).toBeInTheDocument();

    const reports = screen.getByRole("region", {
      name: "ORG_CHART$DIRECT_REPORTS",
    });
    const sections = within(reports)
      .getAllByRole("region")
      .map((section) => section.getAttribute("aria-label"));
    expect(sections).toEqual([
      "ORG_CHART$HEALTH_NEEDS_ATTENTION",
      "ORG_CHART$HEALTH_CONVERGING",
    ]);
    expect(
      within(reportSection("ORG_CHART$HEALTH_NEEDS_ATTENTION")).getByRole(
        "link",
        {
          name: /billing team/,
        },
      ),
    ).toHaveAttribute("href", "/org/billing");
    expect(
      within(reportSection("ORG_CHART$HEALTH_CONVERGING")).getAllByRole("link"),
    ).toHaveLength(2);
    // The grandchild is counted in the rollup but is not a card here.
    expect(screen.queryByRole("link", { name: /oauth team/ })).toBeNull();
    expect(
      within(
        screen.getByRole("region", { name: "ORG_CHART$TEAMS_BELOW" }),
      ).getByText("ORG_CHART$HEALTH_DONE"),
    ).toBeInTheDocument();
  });

  it("lists each report's boundary, isolation and path rules", async () => {
    renderWithProviders(<OrgNodeWorkspace nodeId={null} />);

    const boundaries = await screen.findByRole("region", {
      name: "ORG_CHART$BOUNDARIES",
    });
    const rows = within(boundaries).getAllByRole("listitem");

    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("services/auth")).toBeInTheDocument();
    expect(
      within(rows[0]).getByText(/ORG_CHART\$ISOLATION_WORKTREE/),
    ).toBeInTheDocument();
    expect(within(rows[0]).getByText("agents/auth")).toBeInTheDocument();
    expect(within(rows[0]).getByText("services/auth/**")).toBeInTheDocument();
    expect(within(rows[0]).getByText("src/types/**")).toBeInTheDocument();
  });

  it("follows the requested node and links back up through its ancestors", async () => {
    renderWithProviders(<OrgNodeWorkspace nodeId="auth" />);

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
    expect(screen.getByRole("link", { name: /oauth team/ })).toHaveAttribute(
      "href",
      "/org/oauth",
    );
    // A report sharing its parent's directory shows no branch of its own.
    const boundaries = screen.getByRole("region", {
      name: "ORG_CHART$BOUNDARIES",
    });
    expect(
      within(boundaries).getByText(/ORG_CHART\$ISOLATION_SHARED/),
    ).toBeInTheDocument();
    expect(within(boundaries).queryByText("agents/oauth")).toBeNull();
  });

  it("tells a leaf team apart from one that is still loading", async () => {
    renderWithProviders(<OrgNodeWorkspace nodeId="oauth" />);

    expect(screen.getByText("ORG_CHART$LOADING")).toBeInTheDocument();
    expect(await screen.findByText("ORG_CHART$NO_REPORTS")).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "ORG_CHART$BOUNDARIES" }),
    ).toBeNull();
  });

  it("encodes node ids that are not URL-safe in links", async () => {
    store.upsert(input("a/b c", "root", "done", "services/odd"));

    renderWithProviders(<OrgNodeWorkspace nodeId={null} />);

    expect(
      await screen.findByRole("link", { name: /a\/b c team/ }),
    ).toHaveAttribute("href", "/org/a%2Fb%20c");
  });

  it("moves a card between sections and updates rollups as the tree changes", async () => {
    renderWithProviders(<OrgNodeWorkspace nodeId={null} />);
    await screen.findByRole("heading", { level: 1, name: "root team" });

    store.upsert(input("auth", "root", "collision", "services/auth"));

    const reports = screen.getByRole("region", {
      name: "ORG_CHART$DIRECT_REPORTS",
    });
    const collisions = await within(reports).findByRole("region", {
      name: "ORG_CHART$HEALTH_COLLISION",
    });
    expect(
      within(collisions).getByRole("link", { name: /auth team/ }),
    ).toBeInTheDocument();
    expect(
      within(reportSection("ORG_CHART$HEALTH_CONVERGING")).getAllByRole("link"),
    ).toHaveLength(1);

    store.upsert(input("oauth", "auth", "pruned", "services/auth/oauth"));

    const below = screen.getByRole("region", { name: "ORG_CHART$TEAMS_BELOW" });
    expect(
      await within(below).findByText("ORG_CHART$HEALTH_PRUNED"),
    ).toBeInTheDocument();
    expect(within(below).queryByText("ORG_CHART$HEALTH_DONE")).toBeNull();
  });

  it("adds and removes cards as teams are spawned and pruned", async () => {
    renderWithProviders(<OrgNodeWorkspace nodeId={null} />);
    await screen.findByRole("heading", { level: 1, name: "root team" });

    store.upsert(
      input("growth", "root", "negotiating_split", "services/growth"),
    );
    expect(
      await screen.findByRole("link", { name: /growth team/ }),
    ).toBeInTheDocument();

    store.remove("billing");
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: /billing team/ })).toBeNull(),
    );
  });

  it("explains that the team is gone when the focused node is removed", async () => {
    renderWithProviders(<OrgNodeWorkspace nodeId="auth" />);
    await screen.findByRole("heading", { level: 1, name: "auth team" });

    store.remove("auth");

    expect(
      await screen.findByText("ORG_CHART$NOT_FOUND_TITLE"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "ORG_CHART$BACK_TO_ROOT" }),
    ).toHaveAttribute("href", "/org");
  });

  it("stays gone when the focused node is removed along with an ancestor", async () => {
    renderWithProviders(<OrgNodeWorkspace nodeId="oauth" />);
    await screen.findByRole("heading", { level: 1, name: "oauth team" });

    // Removing the parent reports the focus first and the parent after it;
    // that second frame must not bring the view back.
    store.remove("auth");

    expect(
      await screen.findByText("ORG_CHART$NOT_FOUND_TITLE"),
    ).toBeInTheDocument();
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
    expect(screen.getByText("ORG_CHART$NOT_FOUND_TITLE")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "oauth team" })).toBeNull();
  });

  it("reports an unknown node without retrying", async () => {
    renderWithProviders(<OrgNodeWorkspace nodeId="missing" />);

    expect(
      await screen.findByText("ORG_CHART$NOT_FOUND_TITLE"),
    ).toBeInTheDocument();
    await new Promise((resolve) => {
      setTimeout(resolve, 1200);
    });
    expect(streamRequests).toHaveLength(1);
  });

  it("says the director is offline, then recovers by itself once it is back", async () => {
    let failures = 0;
    server.use(
      http.get(
        "*/api/director/org/tree-stream",
        () => {
          failures += 1;
          return HttpResponse.json({ error: "down" }, { status: 503 });
        },
        { once: true },
      ),
    );

    renderWithProviders(<OrgNodeWorkspace nodeId={null} />);

    expect(
      await screen.findByText("ORG_CHART$UNAVAILABLE_TITLE"),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole(
        "heading",
        { level: 1, name: "root team" },
        { timeout: 4000 },
      ),
    ).toBeInTheDocument();
    expect(failures).toBe(1);
  });

  it("keeps the last view while reconnecting, then replaces it with the fresh snapshot", async () => {
    renderWithProviders(<OrgNodeWorkspace nodeId={null} />);
    await screen.findByRole("heading", { level: 1, name: "root team" });

    streams[0].close();

    expect(await screen.findByRole("status")).toHaveTextContent(
      "ORG_CHART$RECONNECTING",
    );
    expect(screen.getByRole("link", { name: /billing team/ })).toBeVisible();

    // Changed while disconnected: only the new snapshot can deliver this.
    store.remove("billing");

    await waitFor(
      () =>
        expect(screen.queryByRole("link", { name: /billing team/ })).toBeNull(),
      { timeout: 4000 },
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(streamRequests).toHaveLength(2);
  });

  it("stops following the old node when the route changes", async () => {
    const { rerender } = renderWithProviders(
      <OrgNodeWorkspace nodeId="auth" />,
    );
    await screen.findByRole("heading", { level: 1, name: "auth team" });

    rerender(<OrgNodeWorkspace nodeId="billing" />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "billing team" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /oauth team/ })).toBeNull();
  });

  describe("agent inspector", () => {
    it("opens on an agent without a conversation and closes again", async () => {
      blackboardHandlers();
      const user = userEvent.setup();
      renderWithProviders(<OrgNodeWorkspace nodeId="auth" />);

      await user.click(
        await screen.findByRole("button", { name: /ORG_CHART\$ROLE_LEAD_IC/ }),
      );

      const drawer = screen.getByRole("dialog", {
        name: /ORG_CHART\$ROLE_LEAD_IC.*auth team/,
      });
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

    it("mounts the conversation view targeted at the inspected agent", async () => {
      blackboardHandlers();
      const user = userEvent.setup();
      renderWithProviders(<OrgNodeWorkspace nodeId="auth" />, {
        navigation: { conversationId: "route-conversation" },
      });

      await user.click(
        await screen.findByRole("button", { name: /ORG_CHART\$ROLE_MANAGER/ }),
      );

      expect(await screen.findByTestId("conversation-view")).toHaveTextContent(
        "conv-manager",
      );
    });

    it("closes on Escape and when moving to another node", async () => {
      blackboardHandlers();
      const user = userEvent.setup();
      const { rerender } = renderWithProviders(
        <OrgNodeWorkspace nodeId="auth" />,
      );

      await user.click(
        await screen.findByRole("button", { name: /ORG_CHART\$ROLE_LEAD_IC/ }),
      );
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).toBeNull();

      await user.click(
        screen.getByRole("button", { name: /ORG_CHART\$ROLE_LEAD_IC/ }),
      );
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      rerender(<OrgNodeWorkspace nodeId="billing" />);
      await screen.findByRole("heading", { level: 1, name: "billing team" });
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("shows the boundary's rules and saves a newly taught one", async () => {
      const taught = blackboardHandlers(["Never log tokens."]);
      const user = userEvent.setup();
      renderWithProviders(<OrgNodeWorkspace nodeId="auth" />);
      await user.click(
        await screen.findByRole("button", { name: /ORG_CHART\$ROLE_LEAD_IC/ }),
      );

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
      renderWithProviders(<OrgNodeWorkspace nodeId="auth" />);

      await user.click(
        await screen.findByRole("button", { name: /ORG_CHART\$ROLE_LEAD_IC/ }),
      );

      expect(
        await screen.findByText("ORG_CHART$MEMORY_EMPTY"),
      ).toBeInTheDocument();
    });

    it("keeps the draft and reports the failure when saving a rule fails", async () => {
      blackboardHandlers();
      server.use(
        http.post("*/api/director/org/nodes/:nodeId/teach", () =>
          HttpResponse.json({ error: "boom" }, { status: 500 }),
        ),
      );
      const user = userEvent.setup();
      renderWithProviders(<OrgNodeWorkspace nodeId="auth" />);
      await user.click(
        await screen.findByRole("button", { name: /ORG_CHART\$ROLE_LEAD_IC/ }),
      );
      const input = await screen.findByLabelText("ORG_CHART$TEACH_LABEL");

      await user.type(input, "A rule");
      await user.click(
        screen.getByRole("button", { name: "ORG_CHART$TEACH_SUBMIT" }),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "ORG_CHART$TEACH_ERROR",
      );
      expect(input).toHaveValue("A rule");
    });

    it("explains when the boundary memory cannot be read", async () => {
      server.use(
        http.get("*/api/director/org/nodes/:nodeId/blackboard", () =>
          HttpResponse.json({ error: "No blackboard" }, { status: 503 }),
        ),
      );
      const user = userEvent.setup();
      renderWithProviders(<OrgNodeWorkspace nodeId="auth" />);

      await user.click(
        await screen.findByRole("button", { name: /ORG_CHART\$ROLE_LEAD_IC/ }),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "ORG_CHART$MEMORY_UNAVAILABLE",
      );
      expect(screen.queryByLabelText("ORG_CHART$TEACH_LABEL")).toBeNull();
    });
  });
});

describe("mock mode", () => {
  it("renders the org chart from the built-in mock handlers and remembers a taught rule", async () => {
    // No per-test stream handler: this exercises the default mock handlers.
    server.resetHandlers();
    const user = userEvent.setup();

    renderWithProviders(<OrgNodeWorkspace nodeId="payments" />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "payments domain" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Root organization" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: /payments\/worker/ }),
    ).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: /ORG_CHART\$ROLE_MANAGER/ }),
    );
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
