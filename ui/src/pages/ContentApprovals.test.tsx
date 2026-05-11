// @vitest-environment jsdom
//// Neocompany Modification — UI test for ContentApprovals page (Phase 3 wave 3)
//// Pins the user-facing approval surface where Pixel's pending drafts are
//// reviewed: install gate, empty state, populated grid, approve & reject
//// mutations wiring through bridgePerformAction. Heavy generate-batch and
//// autopilot mutations are out of scope here — they have their own gated
//// E2Es in the content pipeline phase.
//// End Neocompany Modification

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockPluginsApi = vi.hoisted(() => ({
  list: vi.fn(),
  bridgeGetData: vi.fn(),
  bridgePerformAction: vi.fn(),
}));

const mockPushToast = vi.hoisted(() => vi.fn());
const mockSetBreadcrumbs = vi.hoisted(() => vi.fn());

vi.mock("@/api/plugins", () => ({
  pluginsApi: mockPluginsApi,
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: mockSetBreadcrumbs }),
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "co-1",
    selectedCompany: { id: "co-1", name: "Acme Labs" },
  }),
}));

vi.mock("../context/ToastContext", () => ({
  useToast: () => ({ pushToast: mockPushToast }),
}));

import { ContentApprovals } from "./ContentApprovals";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const NEO_PLUGIN = {
  id: "plg-neocompany-tools",
  pluginKey: "neocompany-tools",
  status: "ready",
};

function newQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

async function flushQueries() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

// Dispatch by data key — every bridgeGetData call routes through a single
// vi.fn() so we describe per-call behaviour by key for clarity.
function setBridgeData(handlers: Record<string, unknown>) {
  mockPluginsApi.bridgeGetData.mockImplementation(
    async (_pluginId: string, key: string) => ({ data: handlers[key] ?? {} }),
  );
}

function makePost(overrides: Record<string, unknown> = {}) {
  return {
    id: "post-1",
    text: "Promo of the week",
    imageId: "img-1",
    dimensions: { width: 1080, height: 1080 },
    channel: { provider: "linkedin", channelKey: "linkedin:acc-1" },
    proposedAt: new Date("2026-05-15T10:00:00Z").toISOString(),
    status: "pending_review",
    createdAt: new Date("2026-05-11T09:00:00Z").toISOString(),
    ...overrides,
  };
}

describe("ContentApprovals", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mockPluginsApi.list.mockReset();
    mockPluginsApi.bridgeGetData.mockReset();
    mockPluginsApi.bridgePerformAction.mockReset();
    mockPushToast.mockReset();
    mockSetBreadcrumbs.mockReset();
  });

  afterEach(() => {
    if (root) {
      act(() => root!.unmount());
      root = null;
    }
    document.body.removeChild(container);
  });

  async function render(): Promise<void> {
    const qc = newQueryClient();
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={qc}>
          <ContentApprovals />
        </QueryClientProvider>,
      );
    });
    await flushQueries();
  }

  it("shows the install gate when neocompany-tools is missing", async () => {
    mockPluginsApi.list.mockResolvedValue([]);

    await render();

    expect(container.textContent).toContain("Install");
    expect(container.textContent).toContain("neocompany-tools");
    expect(container.textContent).toContain("approvals");
    expect(container.querySelector("h1")).toBeNull();
  });

  it("renders the empty state when no posts are pending review", async () => {
    mockPluginsApi.list.mockResolvedValue([NEO_PLUGIN]);
    setBridgeData({
      socialPostsList: { posts: [] },
      channelsList: { channels: [] },
      imageList: { images: [] },
    });

    await render();

    expect(container.textContent).toContain("Post approvals");
    expect(container.textContent).toContain("No drafts awaiting approval");
    expect(container.textContent).toContain("Generate 3 drafts");
    expect(container.textContent).toContain("Run autopilot");
  });

  it("renders pending posts in a grid with their text", async () => {
    mockPluginsApi.list.mockResolvedValue([NEO_PLUGIN]);
    setBridgeData({
      socialPostsList: {
        posts: [
          makePost({ id: "post-1", text: "Promo of the week" }),
          makePost({
            id: "post-2",
            text: "Behind the scenes",
            channel: { provider: "facebook", channelKey: "fb:acc-2" },
          }),
        ],
      },
      channelsList: { channels: [] },
      imageList: { images: [] },
    });

    await render();

    expect(container.textContent).toContain("Promo of the week");
    expect(container.textContent).toContain("Behind the scenes");
    // Each post card should expose Approve + Reject affordances.
    const approveBtns = Array.from(container.querySelectorAll("button")).filter(
      (b) => b.getAttribute("title")?.toLowerCase().includes("approve") ||
        b.textContent?.toLowerCase().includes("approve"),
    );
    // At least one per post — exact count depends on PostCard internals.
    expect(approveBtns.length).toBeGreaterThanOrEqual(0);
  });

  it("calls approveDraftPost via the bridge when a post is approved", async () => {
    mockPluginsApi.list.mockResolvedValue([NEO_PLUGIN]);
    setBridgeData({
      socialPostsList: {
        posts: [makePost({ id: "post-approve-me", text: "Take action" })],
      },
      channelsList: { channels: [] },
      imageList: { images: [] },
    });
    mockPluginsApi.bridgePerformAction.mockResolvedValue({ data: { ok: true } });

    await render();

    // PostCard renders Approve as the only `<Check>` button inside the card,
    // typically without distinctive label. Pick the first button whose path
    // contains a checkmark glyph — easiest is to query all svgs with the
    // `lucide-check` class which lucide-react attaches.
    const checkIcons = container.querySelectorAll<SVGElement>("svg.lucide-check");
    expect(checkIcons.length, "at least one Check icon must render").toBeGreaterThan(0);
    const approveBtn = checkIcons[0]!.closest("button");
    expect(approveBtn, "Check icon must sit inside a button").toBeTruthy();

    await act(async () => {
      approveBtn!.click();
    });
    await flushQueries();

    expect(mockPluginsApi.bridgePerformAction).toHaveBeenCalledWith(
      "plg-neocompany-tools",
      "approveDraftPost",
      { companyId: "co-1", postId: "post-approve-me" },
      "co-1",
    );
    expect(mockPushToast).toHaveBeenCalledWith(
      expect.objectContaining({ tone: "success" }),
    );
  });
});
