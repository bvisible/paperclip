// @vitest-environment jsdom
//// Neocompany Modification — test fixture for ActivityRow plugin actorType resolution
//// This test file does not exist upstream. It covers the patch that adds pluginMap
//// support to ActivityRow so plugin-emitted activity events render the plugin
//// display name instead of the raw UUID. Drop together with the patch if upstream
//// adds equivalent support.
//// End Neocompany Modification

import { act } from "react";
import type { ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityEvent, Agent } from "@paperclipai/shared";

// Stub @/lib/router Link so we don't pull in CompanyProvider machinery in this
// unit test. The component just wraps an <a>, which is all we render here.
vi.mock("@/lib/router", () => ({
  Link: ({ children, className, to, ...props }: ComponentProps<"a"> & { to?: string }) => (
    <a className={className} href={typeof to === "string" ? to : "#"} {...props}>
      {children}
    </a>
  ),
}));

import { ActivityRow } from "./ActivityRow";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

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
    createdAt: new Date("2026-05-11T08:00:00Z").toISOString(),
    ...overrides,
  } as ActivityEvent;
}

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    name: "Nora",
    role: "main",
    status: "active",
    companyId: "co-1",
    adapterType: "openclaw_gateway",
    adapterConfig: {},
    capabilities: [],
    description: null,
    createdAt: new Date("2026-05-01T00:00:00Z").toISOString(),
    updatedAt: new Date("2026-05-01T00:00:00Z").toISOString(),
    ...overrides,
  } as Agent;
}

describe("ActivityRow actor name resolution", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  function renderRow(props: Partial<React.ComponentProps<typeof ActivityRow>>) {
    const merged: React.ComponentProps<typeof ActivityRow> = {
      event: makeEvent(),
      agentMap: new Map([["agent-1", makeAgent()]]),
      entityNameMap: new Map(),
      ...props,
    };
    const root = createRoot(container);
    act(() => {
      root.render(<ActivityRow {...merged} />);
    });
    return root;
  }

  it("resolves actorType=agent via agentMap", () => {
    renderRow({
      event: makeEvent({ actorType: "agent", actorId: "agent-1" }),
    });
    expect(container.textContent).toContain("Nora");
    expect(container.textContent).not.toContain("agent-1");
  });

  it("resolves actorType=system as 'System'", () => {
    renderRow({
      event: makeEvent({ actorType: "system", actorId: "" }),
    });
    expect(container.textContent).toContain("System");
  });

  it("resolves actorType=user via userProfileMap", () => {
    renderRow({
      event: makeEvent({ actorType: "user", actorId: "user-1" }),
      userProfileMap: new Map([
        [
          "user-1",
          {
            userId: "user-1",
            label: "Jérémy",
            image: null,
            email: "jeremy@neoservice.ai",
          },
        ],
      ]),
    });
    expect(container.textContent).toContain("Jérémy");
    expect(container.textContent).not.toContain("user-1");
  });

  it("falls back to 'Board' when user not in profile map", () => {
    renderRow({
      event: makeEvent({ actorType: "user", actorId: "user-unknown" }),
    });
    expect(container.textContent).toContain("Board");
  });

  //// Neocompany Modification — actorType=plugin resolution tests
  // The bug that motivated this test: Recent Activity on /REE/dashboard showed
  // raw UUIDs like "af5f5888-b578-4b7c-8726-60cfe8ff2ddd" instead of the plugin
  // display name. These tests pin the fix.
  it("resolves actorType=plugin via pluginMap to display name", () => {
    renderRow({
      event: makeEvent({
        actorType: "plugin",
        actorId: "af5f5888-b578-4b7c-8726-60cfe8ff2ddd",
      }),
      pluginMap: new Map([
        ["af5f5888-b578-4b7c-8726-60cfe8ff2ddd", "neocompany-tools"],
      ]),
    });
    expect(container.textContent).toContain("neocompany-tools");
    expect(container.textContent).not.toContain("af5f5888-b578-4b7c-8726-60cfe8ff2ddd");
  });

  it("falls back to actorId UUID when actorType=plugin and pluginMap is missing", () => {
    // Defensive: an event for a plugin that was disabled mid-session still
    // renders something readable rather than crashing.
    renderRow({
      event: makeEvent({
        actorType: "plugin",
        actorId: "deadbeef-dead-beef-dead-beefdeadbeef",
      }),
      pluginMap: new Map(),
    });
    expect(container.textContent).toContain("deadbeef");
  });

  it("falls back to actorId UUID when pluginMap is undefined (back-compat)", () => {
    // No pluginMap prop at all (upstream behaviour). Should not throw and
    // should render the UUID rather than blow up.
    renderRow({
      event: makeEvent({
        actorType: "plugin",
        actorId: "feedface-feed-face-feed-facefeedface",
      }),
    });
    expect(container.textContent).toContain("feedface");
  });
  //// End Neocompany Modification
});
