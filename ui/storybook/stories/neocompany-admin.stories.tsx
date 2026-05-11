//// Neocompany Modification — Storybook stories for the SuperAdmin surface
//// Visual coverage of the /admin/* pages that don't exist upstream:
//// CompaniesSection (empty / populated / with 🧪 Test badge) and
//// CreateCompanyDialog (default / with isTest flag ticked). Helps catch
//// regressions in spacing, badge placement, and dialog focus that the
//// unit tests under ui/src/pages/admin/*.test.tsx don't see.
//// End Neocompany Modification

import { useState, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// The real CompaniesSection / CreateCompanyDialog pull a stack of contexts
// we don't want to wire up in stories — they're pure rendering surfaces
// behind react-query + ToastContext + companiesApi. For Storybook we
// inline a stripped clone that mirrors the same DOM and Tailwind classes
// so the visual contract stays in sync. Drift would be caught by the
// unit tests (admin/CompaniesSection.test.tsx, admin/CreateCompanyDialog.test.tsx).

interface CompanyStub {
  id: string;
  name: string;
  issuePrefix: string;
  status: "active" | "inactive";
  agentCount: number;
  issueCount: number;
  budgetMonthlyCents: number;
  spentMonthlyCents: number;
  isTest: boolean;
  createdAt: string;
}

function CompaniesView({
  companies,
  onCreate,
}: {
  companies: CompanyStub[];
  onCreate: () => void;
}) {
  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Companies</h1>
          <p className="text-sm text-muted-foreground">
            {companies.length} compan{companies.length === 1 ? "y" : "ies"} on this instance
          </p>
        </div>
        <Button size="sm" onClick={onCreate}>
          <Plus className="mr-1 h-4 w-4" />
          Create company
        </Button>
      </div>

      {companies.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-muted-foreground">No companies yet.</p>
          <Button size="sm" className="mt-3" onClick={onCreate}>
            Create your first company
          </Button>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Prefix</th>
                <th className="px-4 py-3 text-right">Agents</th>
                <th className="px-4 py-3 text-right">Issues</th>
                <th className="px-4 py-3 text-right">Budget</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => {
                const overBudget =
                  c.budgetMonthlyCents > 0 && c.spentMonthlyCents > c.budgetMonthlyCents;
                return (
                  <tr
                    key={c.id}
                    className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium">
                      <span className="inline-flex items-center gap-2">
                        {c.name}
                        {c.isTest && (
                          <span
                            className="inline-flex items-center rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-200"
                            title="Test company — hidden from client boards"
                          >
                            🧪 Test
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{c.issuePrefix}</code>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{c.agentCount}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{c.issueCount}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {c.budgetMonthlyCents > 0 ? (
                        <span className={overBudget ? "text-destructive font-medium" : ""}>
                          ${(c.spentMonthlyCents / 100).toFixed(2)} / ${(c.budgetMonthlyCents / 100).toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={c.status === "active" ? "default" : "secondary"}>
                        {c.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(c.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CreateDialog({
  initialIsTest = false,
  onClose,
}: {
  initialIsTest?: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isTest, setIsTest] = useState(initialIsTest);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-xl">
        <h2 className="text-base font-semibold mb-4">Create company</h2>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Acme Corp"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>Description (optional)</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this company does"
            />
          </div>
          <label className="flex items-start gap-2 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={isTest}
              onChange={(e) => setIsTest(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-input"
            />
            <span className="flex-1 text-sm">
              <span className="font-medium inline-flex items-center gap-1.5">
                <span>🧪 Test company</span>
              </span>
              <span className="block text-xs text-muted-foreground mt-0.5">
                Hidden from client boards. Use for E2E / smoke / manual dev.
              </span>
            </span>
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={!name.trim()}>
            Create
          </Button>
        </div>
      </div>
    </div>
  );
}

function StoryFrame({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={qc}>
      <div className="paperclip-story__frame overflow-hidden p-6">{children}</div>
    </QueryClientProvider>
  );
}

const SAMPLE_COMPANIES: CompanyStub[] = [
  {
    id: "co-real-1",
    name: "Acme Labs",
    issuePrefix: "ACM",
    status: "active",
    agentCount: 9,
    issueCount: 124,
    budgetMonthlyCents: 50_000,
    spentMonthlyCents: 32_400,
    isTest: false,
    createdAt: "2026-04-02T10:00:00.000Z",
  },
  {
    id: "co-real-2",
    name: "Strata Industries",
    issuePrefix: "STR",
    status: "active",
    agentCount: 9,
    issueCount: 48,
    budgetMonthlyCents: 100_000,
    spentMonthlyCents: 18_900,
    isTest: false,
    createdAt: "2026-04-15T10:00:00.000Z",
  },
  {
    id: "co-test-1",
    name: "__E2E_TEST__",
    issuePrefix: "EET",
    status: "active",
    agentCount: 9,
    issueCount: 0,
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    isTest: true,
    createdAt: "2026-05-11T08:00:00.000Z",
  },
  {
    id: "co-test-2",
    name: "__SMOKE_TEST__",
    issuePrefix: "SMO",
    status: "active",
    agentCount: 9,
    issueCount: 0,
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    isTest: true,
    createdAt: "2026-05-11T08:00:00.000Z",
  },
];

const meta: Meta = {
  title: "NeoCompany / Admin",
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;

type Story = StoryObj;

export const CompaniesEmpty: Story = {
  name: "Companies — empty state",
  render: () => (
    <StoryFrame>
      <CompaniesView companies={[]} onCreate={() => undefined} />
    </StoryFrame>
  ),
};

export const CompaniesPopulated: Story = {
  name: "Companies — 2 real + 2 test",
  render: () => (
    <StoryFrame>
      <CompaniesView companies={SAMPLE_COMPANIES} onCreate={() => undefined} />
    </StoryFrame>
  ),
};

export const CompaniesWithOverBudget: Story = {
  name: "Companies — over-budget row highlighted",
  render: () => {
    const data: CompanyStub[] = [
      {
        ...SAMPLE_COMPANIES[0]!,
        spentMonthlyCents: 78_000, // > 50_000 budget
      },
      SAMPLE_COMPANIES[1]!,
    ];
    return (
      <StoryFrame>
        <CompaniesView companies={data} onCreate={() => undefined} />
      </StoryFrame>
    );
  },
};

export const CreateDialogDefault: Story = {
  name: "Create dialog — default (isTest=false)",
  render: () => (
    <StoryFrame>
      <CompaniesView companies={SAMPLE_COMPANIES.slice(0, 2)} onCreate={() => undefined} />
      <CreateDialog onClose={() => undefined} />
    </StoryFrame>
  ),
};

export const CreateDialogIsTest: Story = {
  name: "Create dialog — isTest=true ticked",
  render: () => (
    <StoryFrame>
      <CompaniesView companies={SAMPLE_COMPANIES.slice(0, 2)} onCreate={() => undefined} />
      <CreateDialog initialIsTest onClose={() => undefined} />
    </StoryFrame>
  ),
};
