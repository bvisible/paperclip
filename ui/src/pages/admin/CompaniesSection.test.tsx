// @vitest-environment jsdom
//// Neocompany Modification — UI test for CompaniesSection (Phase 3)
//// Pins the rendering contract of the /admin/companies SuperAdmin page:
//// empty state, populated table, 🧪 Test badge for is_test rows, and
//// transition into the create dialog on button click. Catches regressions
//// in the admin surface that integration E2Es (admin.spec.ts) only check
//// at a coarser, prod-side granularity.
//// End Neocompany Modification

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCompaniesApi = vi.hoisted(() => ({
  list: vi.fn(),
  stats: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@/api/companies", () => ({
  companiesApi: mockCompaniesApi,
}));

// CompanyDrawer and CreateCompanyDialog are independent UI surfaces — stub
// them so we exercise just CompaniesSection's own rendering logic.
vi.mock("./CompanyDrawer", () => ({
  CompanyDrawer: ({ company }: { company: { name: string } }) => (
    <div data-testid="company-drawer">drawer-{company.name}</div>
  ),
}));

vi.mock("./CreateCompanyDialog", () => ({
  CreateCompanyDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="create-dialog">
      <button onClick={onClose}>close-stub</button>
    </div>
  ),
}));

import { CompaniesSection } from "./CompaniesSection";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function makeCompany(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "co-1",
    name: "Acme Labs",
    issuePrefix: "ACM",
    status: "active",
    budgetMonthlyCents: 0,
    createdAt: "2026-05-01T10:00:00Z",
    updatedAt: "2026-05-01T10:00:00Z",
    isTest: false,
    ...overrides,
  };
}

function newQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

// Wait for any number of microtask + macrotask flushes so useQuery state
// settles and React commits the rerender. 10 ticks is empirical — enough
// for the QueryObserver subscription chain + Suspense-free render path.
async function flushQueries() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

describe("CompaniesSection", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mockCompaniesApi.list.mockReset();
    mockCompaniesApi.stats.mockReset();
    mockCompaniesApi.create.mockReset();
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
          <CompaniesSection />
        </QueryClientProvider>,
      );
    });
    await flushQueries();
  }

  it("shows the empty state when no companies are returned", async () => {
    mockCompaniesApi.list.mockResolvedValue([]);
    mockCompaniesApi.stats.mockResolvedValue({});

    await render();

    expect(container.textContent).toContain("No companies yet");
    expect(container.textContent).toContain("Create your first company");
  });

  it("renders companies in a table with prefix and status", async () => {
    mockCompaniesApi.list.mockResolvedValue([
      makeCompany({ id: "co-1", name: "Acme Labs", issuePrefix: "ACM" }),
      makeCompany({ id: "co-2", name: "Strata", issuePrefix: "STR" }),
    ]);
    mockCompaniesApi.stats.mockResolvedValue({
      "co-1": { agentCount: 9, issueCount: 12 },
      "co-2": { agentCount: 0, issueCount: 0 },
    });

    await render();

    expect(container.textContent).toContain("Acme Labs");
    expect(container.textContent).toContain("ACM");
    expect(container.textContent).toContain("Strata");
    expect(container.textContent).toContain("STR");
    // Plural label tracks the count.
    expect(container.textContent).toContain("2 companies on this instance");
  });

  it("renders the 🧪 Test badge on is_test rows only", async () => {
    mockCompaniesApi.list.mockResolvedValue([
      makeCompany({ id: "co-1", name: "Real Company", isTest: false }),
      makeCompany({ id: "co-2", name: "__E2E_TEST__", isTest: true }),
    ]);
    mockCompaniesApi.stats.mockResolvedValue({});

    await render();

    // Exactly one badge should render in the table, scoped to the test row.
    const badges = container.querySelectorAll("[title*='Test company']");
    expect(badges.length).toBe(1);
    expect(badges[0]!.textContent).toContain("🧪 Test");
  });

  it("opens the CreateCompanyDialog when the header button is clicked", async () => {
    mockCompaniesApi.list.mockResolvedValue([
      makeCompany({ id: "co-1", name: "Acme Labs" }),
    ]);
    mockCompaniesApi.stats.mockResolvedValue({});

    await render();

    // Dialog stub should NOT be present before click.
    expect(container.querySelector("[data-testid='create-dialog']")).toBeNull();

    const createBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Create company"),
    );
    expect(createBtn, "Create company button must be present").toBeTruthy();

    await act(async () => {
      createBtn!.click();
    });

    expect(
      container.querySelector("[data-testid='create-dialog']"),
      "CreateCompanyDialog stub must render after click",
    ).not.toBeNull();
  });

  it("opens the CompanyDrawer when a row is clicked", async () => {
    mockCompaniesApi.list.mockResolvedValue([
      makeCompany({ id: "co-1", name: "Acme Labs" }),
    ]);
    mockCompaniesApi.stats.mockResolvedValue({});

    await render();

    expect(container.querySelector("[data-testid='company-drawer']")).toBeNull();

    const row = container.querySelector("tbody tr");
    expect(row, "row must be present in tbody").toBeTruthy();

    await act(async () => {
      (row as HTMLElement).click();
    });

    expect(
      container.querySelector("[data-testid='company-drawer']")?.textContent,
    ).toContain("Acme Labs");
  });
});
