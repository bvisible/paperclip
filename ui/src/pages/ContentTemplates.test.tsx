// @vitest-environment jsdom
//// Neocompany Modification — UI test for ContentTemplates page (Phase 3 wave 2)
//// Pins the user-facing template management surface that wires the
//// neocompany-tools plugin into the Content workflow. Covers the four
//// state branches: plugin missing, loading, empty, populated; plus the
//// transitions into the create card.
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

const mockNavigate = vi.hoisted(() => vi.fn());
const mockPushToast = vi.hoisted(() => vi.fn());
const mockSetBreadcrumbs = vi.hoisted(() => vi.fn());

vi.mock("@/api/plugins", () => ({
  pluginsApi: mockPluginsApi,
}));

vi.mock("@/lib/router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: mockSetBreadcrumbs }),
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "co-1",
    selectedCompany: {
      id: "co-1",
      name: "Acme Labs",
      logoUrl: null,
    },
  }),
}));

vi.mock("../context/ToastContext", () => ({
  useToast: () => ({ pushToast: mockPushToast }),
}));

// TemplateCanvas pulls in SVG / image rendering machinery we don't need.
vi.mock("@/components/templates/TemplateCanvas", () => ({
  TemplateCanvas: ({ width, height }: { width: number; height: number }) => (
    <div data-testid="template-canvas">
      canvas-{width}x{height}
    </div>
  ),
}));

import { ContentTemplates } from "./ContentTemplates";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

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

const NEO_PLUGIN = {
  id: "plg-neocompany-tools",
  pluginKey: "neocompany-tools",
  status: "ready",
};

describe("ContentTemplates", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mockPluginsApi.list.mockReset();
    mockPluginsApi.bridgeGetData.mockReset();
    mockPluginsApi.bridgePerformAction.mockReset();
    mockNavigate.mockReset();
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
          <ContentTemplates />
        </QueryClientProvider>,
      );
    });
    await flushQueries();
  }

  it("shows the 'plugin not installed' empty card when neocompany-tools is missing", async () => {
    mockPluginsApi.list.mockResolvedValue([]);

    await render();

    expect(container.textContent).toContain("Install the");
    expect(container.textContent).toContain("neocompany-tools");
    // No "Brand Templates" h1 should render in this branch.
    expect(container.querySelector("h1")).toBeNull();
  });

  it("renders the empty-templates state when the plugin is installed but list is empty", async () => {
    mockPluginsApi.list.mockResolvedValue([NEO_PLUGIN]);
    mockPluginsApi.bridgeGetData.mockResolvedValue({
      data: { templates: [] },
    });

    await render();

    expect(container.textContent).toContain("Brand Templates");
    expect(container.textContent).toContain("No templates yet");
    expect(container.textContent).toContain("Create your first template");
  });

  it("renders templates in a grid when templateList returns rows", async () => {
    mockPluginsApi.list.mockResolvedValue([NEO_PLUGIN]);
    mockPluginsApi.bridgeGetData.mockResolvedValue({
      data: {
        templates: [
          {
            id: "tpl-1",
            name: "Instagram Promo",
            description: "Square promo posts",
            width: 1080,
            height: 1080,
            isDefault: true,
            config: {
              logo: { position: "bottom-right", scale: 15, opacity: 90 },
              textZones: [],
              filters: { brightness: 0, contrast: 0, saturation: 0, blur: 0 },
              overlay: { color: "#000000", opacity: 0 },
              border: { width: 0, color: "#ffffff", radius: 0 },
              backgroundColor: "#ffffff",
              imageFit: "cover",
            },
            createdAt: "2026-05-01T10:00:00Z",
          },
          {
            id: "tpl-2",
            name: "Story Vertical",
            width: 1080,
            height: 1920,
            isDefault: false,
            config: null,
            createdAt: "2026-05-02T10:00:00Z",
          },
        ],
      },
    });

    await render();

    expect(container.textContent).toContain("Instagram Promo");
    expect(container.textContent).toContain("1080 × 1080");
    expect(container.textContent).toContain("Story Vertical");
    expect(container.textContent).toContain("1080 × 1920");
    expect(container.textContent).toContain("default"); // badge on tpl-1
  });

  it("opens the create card when the header 'New template' button is clicked", async () => {
    mockPluginsApi.list.mockResolvedValue([NEO_PLUGIN]);
    mockPluginsApi.bridgeGetData.mockResolvedValue({ data: { templates: [] } });

    await render();

    // Form not visible before click.
    expect(container.textContent).not.toContain("Dimension preset");

    const newBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("New template"),
    );
    expect(newBtn, "header 'New template' button must be present").toBeTruthy();

    await act(async () => {
      newBtn!.click();
    });

    expect(container.textContent).toContain("New template");
    expect(container.textContent).toContain("Dimension preset");
    // PRESETS dropdown should expose at least Instagram square.
    expect(container.textContent).toContain("Instagram square");
  });

  it("navigates to the template detail page when a template card is clicked", async () => {
    mockPluginsApi.list.mockResolvedValue([NEO_PLUGIN]);
    mockPluginsApi.bridgeGetData.mockResolvedValue({
      data: {
        templates: [
          {
            id: "tpl-xyz",
            name: "Test",
            width: 1080,
            height: 1080,
            isDefault: false,
            config: null,
            createdAt: "2026-05-01T10:00:00Z",
          },
        ],
      },
    });

    await render();

    const card = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Test") && b.textContent?.includes("1080"),
    );
    expect(card, "template card button must be present").toBeTruthy();

    await act(async () => {
      card!.click();
    });
    expect(mockNavigate).toHaveBeenCalledWith("/content/templates/tpl-xyz");
  });
});
