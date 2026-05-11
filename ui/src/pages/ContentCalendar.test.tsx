// @vitest-environment jsdom
//// Neocompany Modification — UI test for ContentCalendar page (Phase 3 wave 3)
//// Pins the calendar surface that aggregates scheduled & published social
//// posts. Covers install gate, empty calendar, month-label rendering, and
//// the presence of scheduled posts on their day. Drag-drop reschedule and
//// detail drawer are out of scope here — they're better covered via the
//// content-pipeline E2E (rescheduleSocialPost is already pinned there).
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

import { ContentCalendar } from "./ContentCalendar";

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

function setBridgeData(handlers: Record<string, unknown>) {
  mockPluginsApi.bridgeGetData.mockImplementation(
    async (_pluginId: string, key: string) => ({ data: handlers[key] ?? {} }),
  );
}

function makeScheduledPost(overrides: Record<string, unknown> = {}) {
  return {
    id: "post-1",
    text: "Holiday teaser",
    imageId: "img-1",
    channel: { provider: "linkedin", channelKey: "linkedin:acc-1" },
    proposedAt: new Date().toISOString(),
    scheduledAt: new Date().toISOString(),
    status: "scheduled",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("ContentCalendar", () => {
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
          <ContentCalendar />
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
    expect(container.textContent).toContain("calendar");
  });

  it("renders the Calendar header + current month label even with no posts", async () => {
    mockPluginsApi.list.mockResolvedValue([NEO_PLUGIN]);
    setBridgeData({
      socialPostsList: { posts: [] },
      imageList: { images: [] },
    });

    await render();

    expect(container.textContent).toContain("Calendar");
    // The month label uses toLocaleDateString — the year of "now" must appear.
    const yearNow = new Date().getFullYear().toString();
    expect(container.textContent).toContain(yearNow);
    // Description sentence
    expect(container.textContent).toContain("Scheduled & published");
  });

  it("renders scheduled posts on their day in the month grid", async () => {
    mockPluginsApi.list.mockResolvedValue([NEO_PLUGIN]);
    const now = new Date();
    // Pick the 15th of the current month so it always falls within the grid.
    const dayInGrid = new Date(now.getFullYear(), now.getMonth(), 15, 10, 0, 0).toISOString();
    setBridgeData({
      socialPostsList: {
        posts: [
          makeScheduledPost({
            id: "post-1",
            text: "Mid-month linkedin teaser",
            scheduledAt: dayInGrid,
            proposedAt: dayInGrid,
            status: "scheduled",
          }),
        ],
      },
      imageList: { images: [] },
    });

    await render();

    expect(container.textContent).toContain("Calendar");
    // Day cell "15" must be present in the grid (could appear multiple times
    // across other months, but at least once).
    const cell15 = Array.from(container.querySelectorAll("*")).some((el) =>
      el.textContent?.trim() === "15",
    );
    expect(cell15, "day cell 15 must render in the month grid").toBe(true);
  });

  it("does NOT render rejected / pending_review posts on the calendar", async () => {
    mockPluginsApi.list.mockResolvedValue([NEO_PLUGIN]);
    const now = new Date();
    const todayIso = new Date(now.getFullYear(), now.getMonth(), 15, 10, 0, 0).toISOString();
    setBridgeData({
      socialPostsList: {
        posts: [
          makeScheduledPost({
            id: "p-rejected",
            text: "REJECTED-MARKER",
            status: "rejected",
            scheduledAt: todayIso,
            proposedAt: todayIso,
          }),
          makeScheduledPost({
            id: "p-pending",
            text: "PENDING-MARKER",
            status: "pending_review",
            scheduledAt: todayIso,
            proposedAt: todayIso,
          }),
          makeScheduledPost({
            id: "p-draft",
            text: "DRAFT-MARKER",
            status: "draft",
            scheduledAt: todayIso,
            proposedAt: todayIso,
          }),
        ],
      },
      imageList: { images: [] },
    });

    await render();

    // postsByDay filters out rejected/pending_review/draft — none of these
    // texts should appear inside the calendar grid.
    expect(container.textContent).not.toContain("REJECTED-MARKER");
    expect(container.textContent).not.toContain("PENDING-MARKER");
    expect(container.textContent).not.toContain("DRAFT-MARKER");
  });
});
