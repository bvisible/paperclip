//// Neocompany Modification — Storybook stories for the content pipeline cards
//// Visual coverage of the three card surfaces that the /content/* pages
//// render dozens of: TemplateCard (templates list), PostCard (approvals
//// queue) and PostPill (calendar grid). Required by Phase 5 wave 4 (see
//// Neocompany/fork/plan-tests-robustesse.md). Drift is also caught by
//// the unit tests (ContentTemplates.test.tsx / ContentApprovals.test.tsx
//// / ContentCalendar.test.tsx) — these stories are for visual review.
////
//// Convention: clone the actual JSX from the real components (with the
//// same Tailwind classes) rather than importing them, to avoid pulling
//// in TemplateCanvas + image fetching + react-query infra. If the real
//// components drift, the unit tests will catch it.
//// End Neocompany Modification

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Check, X, Image as ImageIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// ──────────────────────────────────────────────────────────────────────
// TemplateCard (clone of ui/src/pages/ContentTemplates.tsx:193-245)
// ──────────────────────────────────────────────────────────────────────

interface TemplateStub {
  name: string;
  description?: string;
  width: number;
  height: number;
  createdAt: string;
  isDefault?: boolean;
}

function TemplateCardStub({ t }: { t: TemplateStub }) {
  return (
    <button className="text-left rounded-xl border border-border bg-card overflow-hidden hover:shadow-md hover:border-primary/50 transition-all w-[340px]">
      <div className="flex items-center justify-center bg-muted/20 p-4">
        <div
          className="flex items-center justify-center text-muted-foreground bg-muted"
          style={{ width: 340 - 32, height: ((340 - 32) * t.height) / t.width }}
        >
          <ImageIcon className="h-6 w-6 opacity-40" />
        </div>
      </div>
      <div className="p-3 border-t border-border">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium truncate">{t.name}</span>
          {t.isDefault && <Badge variant="secondary">default</Badge>}
        </div>
        {t.description && (
          <p className="text-xs text-muted-foreground mt-1 truncate">{t.description}</p>
        )}
        <p className="text-xs text-muted-foreground mt-1 tabular-nums">
          {t.width} × {t.height} · {new Date(t.createdAt).toLocaleDateString()}
        </p>
      </div>
    </button>
  );
}

// ──────────────────────────────────────────────────────────────────────
// PostCard (clone of ui/src/pages/ContentApprovals.tsx:309-358)
// ──────────────────────────────────────────────────────────────────────

interface ApprovalStub {
  caption: string;
  proposedAt: string;
  imageUrl?: string;
  providerLabel: string;
  providerAccent: string;
}

function ApprovalCardStub({ p }: { p: ApprovalStub }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden w-[260px]">
      <div className="relative aspect-square bg-muted">
        {p.imageUrl ? (
          <img src={p.imageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground text-xs">
            No image
          </div>
        )}
        <div className="absolute top-2 left-2 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-medium">
          <span className={p.providerAccent}>{p.providerLabel}</span>
        </div>
      </div>
      <div className="p-3 space-y-2 border-t border-border">
        <p className="text-xs text-foreground line-clamp-3">{p.caption || "(empty caption)"}</p>
        <p className="text-[10px] text-muted-foreground tabular-nums">
          {new Date(p.proposedAt).toLocaleString()}
        </p>
        <div className="flex gap-1.5 pt-1">
          <Button size="sm" variant="outline" className="flex-1 h-7 text-xs">
            <Check className="mr-1 h-3 w-3" />
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 h-7 text-xs text-destructive"
          >
            <X className="mr-1 h-3 w-3" />
            Reject
          </Button>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Calendar PostPill (compact representation in the day cell)
// ──────────────────────────────────────────────────────────────────────

interface CalendarPillStub {
  caption: string;
  status: "draft" | "scheduled" | "approved" | "posted" | "rejected";
}

const STATUS_RING: Record<CalendarPillStub["status"], string> = {
  draft: "ring-yellow-500/40 bg-yellow-500/10",
  scheduled: "ring-blue-500/40 bg-blue-500/10",
  approved: "ring-green-500/40 bg-green-500/10",
  posted: "ring-emerald-500/40 bg-emerald-500/10",
  rejected: "ring-destructive/40 bg-destructive/10",
};

function CalendarPillStub({ p }: { p: CalendarPillStub }) {
  return (
    <div
      className={`rounded ring-1 ${STATUS_RING[p.status]} px-1.5 py-0.5 text-[10px] truncate cursor-grab`}
      title={p.caption}
    >
      {p.caption}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Stories
// ──────────────────────────────────────────────────────────────────────

const meta = {
  title: "NeoCompany / Content cards",
  parameters: { layout: "padded" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// — Template card variations —

export const TemplateDefault: Story = {
  name: "Template — default Instagram square",
  render: () => (
    <TemplateCardStub
      t={{
        name: "Instagram square",
        description: "1080×1080 grid post",
        width: 1080,
        height: 1080,
        createdAt: "2026-04-28T10:00:00Z",
        isDefault: true,
      }}
    />
  ),
};

export const TemplateStory: Story = {
  name: "Template — Instagram story (9:16)",
  render: () => (
    <TemplateCardStub
      t={{
        name: "Instagram story",
        description: "Portrait vertical, 1080×1920",
        width: 1080,
        height: 1920,
        createdAt: "2026-05-12T09:30:00Z",
      }}
    />
  ),
};

export const TemplateNoDescription: Story = {
  name: "Template — no description (edge case)",
  render: () => (
    <TemplateCardStub
      t={{
        name: "LinkedIn 1.91:1",
        width: 1200,
        height: 627,
        createdAt: "2026-05-18T12:00:00Z",
      }}
    />
  ),
};

// — Approval card variations —

export const ApprovalPending: Story = {
  name: "Approval — pending with image",
  render: () => (
    <ApprovalCardStub
      p={{
        caption: "Discover our new Spring collection — fresh colors, summer vibes.",
        proposedAt: "2026-05-18T11:30:00Z",
        imageUrl: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400",
        providerLabel: "IG",
        providerAccent: "text-pink-600",
      }}
    />
  ),
};

export const ApprovalNoImage: Story = {
  name: "Approval — no image (text only)",
  render: () => (
    <ApprovalCardStub
      p={{
        caption: "Quick reminder: webinar tomorrow at 6 PM CET. Sign up here.",
        proposedAt: "2026-05-18T12:00:00Z",
        providerLabel: "LI",
        providerAccent: "text-sky-700",
      }}
    />
  ),
};

export const ApprovalLongCaption: Story = {
  name: "Approval — long caption (line-clamp)",
  render: () => (
    <ApprovalCardStub
      p={{
        caption:
          "We are thrilled to announce the long-awaited launch of our most ambitious project yet — a complete reinvention of how creative agencies collaborate at scale, with native real-time editing, embedded video review, and unified analytics. Built from the ground up for hybrid teams, our platform delivers a refined experience that respects both the rigor of brand standards and the spontaneity of inspiration. Read more on our blog and let us know what you think.",
        proposedAt: "2026-05-17T08:00:00Z",
        imageUrl: "https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=400",
        providerLabel: "FB",
        providerAccent: "text-blue-700",
      }}
    />
  ),
};

// — Calendar pill variations (all 5 statuses) —

export const CalendarPillsAllStatuses: Story = {
  name: "Calendar pills — all 5 statuses",
  render: () => (
    <div className="grid grid-cols-3 gap-4 max-w-md">
      <div className="rounded-md border border-border bg-card p-2 space-y-1">
        <div className="text-[10px] text-muted-foreground mb-1">Mon 12</div>
        <CalendarPillStub p={{ caption: "Spring collection teaser", status: "draft" }} />
        <CalendarPillStub p={{ caption: "Webinar reminder", status: "scheduled" }} />
      </div>
      <div className="rounded-md border border-border bg-card p-2 space-y-1">
        <div className="text-[10px] text-muted-foreground mb-1">Tue 13</div>
        <CalendarPillStub p={{ caption: "Product launch hero", status: "approved" }} />
        <CalendarPillStub p={{ caption: "Customer story #4", status: "posted" }} />
      </div>
      <div className="rounded-md border border-border bg-card p-2 space-y-1">
        <div className="text-[10px] text-muted-foreground mb-1">Wed 14</div>
        <CalendarPillStub p={{ caption: "Off-brand draft", status: "rejected" }} />
        <CalendarPillStub p={{ caption: "Anniversary post", status: "scheduled" }} />
      </div>
    </div>
  ),
};
