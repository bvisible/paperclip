//// Neocompany Modification — Storybook stories for ActivityRow (4 actorTypes)
//// Companion to ui/src/components/ActivityRow.test.tsx — the unit test
//// covers the resolution logic (agent/user/system/plugin), this file
//// covers the visual rendering. Catches regressions in spacing, badge
//// placement and avatar layout that unit tests don't see.
//// Required by Phase 5 wave 4 (plan-tests-robustesse.md).
//// End Neocompany Modification

import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ActivityEvent, Agent } from "@paperclipai/shared";
import { ActivityRow } from "@/components/ActivityRow";
import type { CompanyUserProfile } from "@/lib/company-members";

// ──────────────────────────────────────────────────────────────────────
// Factories — kept inline so the story file stays self-contained
// ──────────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: "evt-1",
    companyId: "co-1",
    actorType: "agent",
    actorId: "agent-1",
    action: "issue.created",
    entityType: "issue",
    entityId: "iss-1",
    details: null,
    createdAt: new Date(Date.now() - 1000 * 60 * 7).toISOString(),
    ...overrides,
  } as ActivityEvent;
}

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  // Cast via unknown to skip the strict shape — Agent picked up extra fields
  // in upstream (urlKey, title, icon, reportsTo, …) that storybook stubs don't
  // need to satisfy for visual rendering of ActivityRow.
  return ({
    id: "agent-1",
    name: "Nora",
    role: "main",
    status: "active",
    companyId: "co-1",
    adapterType: "hermes_local",
    adapterConfig: {},
    capabilities: [],
    description: null,
    createdAt: new Date("2026-05-01T00:00:00Z").toISOString(),
    updatedAt: new Date("2026-05-01T00:00:00Z").toISOString(),
    ...overrides,
  } as unknown) as Agent;
}

function makeUserProfile(): CompanyUserProfile {
  return {
    userId: "user-jeremy",
    label: "Jérémy Christillin",
    image: null,
    email: "jeremy@neoservice.ai",
    slug: "jeremy",
  } as unknown as CompanyUserProfile;
}

// Common name/title maps so every story renders the "TRA-42 — Fix login bug"
// pattern instead of raw UUIDs. Drift here would also be caught by the unit
// tests when they assert on the rendered text.
const baseEntityNameMap = new Map<string, string>([
  ["issue:iss-1", "TRA-42"],
  ["agent:agent-1", "Nora"],
]);
const baseEntityTitleMap = new Map<string, string>([
  ["issue:iss-1", "Fix login bug"],
]);

const meta = {
  title: "NeoCompany / ActivityRow",
  component: ActivityRow,
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof ActivityRow>;

export default meta;
type Story = StoryObj<typeof meta>;

// ──────────────────────────────────────────────────────────────────────
// 4 actorTypes (matches the 4 branches in ActivityRow's actorName chain)
// ──────────────────────────────────────────────────────────────────────

export const ActorAgent: Story = {
  name: "actorType = agent (Nora)",
  args: {
    event: makeEvent({ actorType: "agent", actorId: "agent-1", action: "issue.created" }),
    agentMap: new Map([["agent-1", makeAgent()]]),
    entityNameMap: baseEntityNameMap,
    entityTitleMap: baseEntityTitleMap,
  },
};

export const ActorUser: Story = {
  name: "actorType = user (Jérémy)",
  args: {
    event: makeEvent({
      actorType: "user",
      actorId: "user-jeremy",
      action: "issue.updated",
    }),
    agentMap: new Map(),
    userProfileMap: new Map([["user-jeremy", makeUserProfile()]]),
    entityNameMap: baseEntityNameMap,
    entityTitleMap: baseEntityTitleMap,
  },
};

export const ActorSystem: Story = {
  name: "actorType = system",
  args: {
    event: makeEvent({
      actorType: "system",
      actorId: "",
      action: "agent.heartbeat.scheduled",
      entityType: "heartbeat_run",
      entityId: "run-99",
      details: { agentId: "agent-1" } as unknown as ActivityEvent["details"],
    }),
    agentMap: new Map([["agent-1", makeAgent()]]),
    entityNameMap: new Map([["agent:agent-1", "Nora"]]),
  },
};

export const ActorPlugin: Story = {
  name: "actorType = plugin (neocompany-tools)",
  args: {
    event: makeEvent({
      actorType: "plugin",
      actorId: "af5f5888-b578-4b7c-8726-60cfe8ff2ddd",
      action: "approval.created",
      entityType: "approval",
      entityId: "appr-1",
    }),
    agentMap: new Map(),
    pluginMap: new Map([["af5f5888-b578-4b7c-8726-60cfe8ff2ddd", "neocompany-tools"]]),
    entityNameMap: new Map([["approval:appr-1", "Brand template approval"]]),
  },
};

// ──────────────────────────────────────────────────────────────────────
// Regression: plugin actor without resolution falls back to UUID
// (this is the bug the pluginMap patch fixes; story keeps a frozen
// reference of the "before" rendering for visual diff awareness)
// ──────────────────────────────────────────────────────────────────────

export const ActorPluginUnresolved: Story = {
  name: "actorType = plugin (unresolved → UUID fallback)",
  args: {
    event: makeEvent({
      actorType: "plugin",
      actorId: "af5f5888-b578-4b7c-8726-60cfe8ff2ddd",
      action: "approval.created",
      entityType: "approval",
      entityId: "appr-1",
    }),
    agentMap: new Map(),
    // No pluginMap on purpose → exercises the UUID fallback branch.
    entityNameMap: new Map([["approval:appr-1", "Brand template approval"]]),
  },
};
