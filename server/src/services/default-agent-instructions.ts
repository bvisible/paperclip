import fs from "node:fs/promises";

const DEFAULT_AGENT_BUNDLE_FILES = {
  default: ["AGENTS.md"],
  ceo: ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"],
} as const;

type DefaultAgentBundleRole = keyof typeof DEFAULT_AGENT_BUNDLE_FILES;

//// Neocompany Modification — seed agents bundle loaders (Nora/Lyra/…)
// Mirrors d7575da3 which originally wired this in. Was lost during an
// upstream sync; restored 2026-05-11 as part of the seed-agents fix
// (Phase 2.C PENDING_BUG).
const SEED_AGENT_BUNDLE_FILES = [
  "AGENTS.md",
  "SOUL.md",
  "IDENTITY.md",
  "TOOLS.md",
] as const;

const SEED_AGENT_KEYS = new Set([
  "nora",
  "lyra",
  "nova",
  "maya",
  "ella",
  "atlas",
  "scout",
  "iris",
  "pixel",
]);

function resolveSeedAgentBundleUrl(seedKey: string, fileName: string) {
  return new URL(`../onboarding-assets/seed-agents/${seedKey}/${fileName}`, import.meta.url);
}

export async function loadSeedAgentInstructionsBundle(seedKey: string): Promise<Record<string, string>> {
  if (!SEED_AGENT_KEYS.has(seedKey)) {
    throw new Error(`Unknown seed agent key: ${seedKey}`);
  }
  const entries = await Promise.all(
    SEED_AGENT_BUNDLE_FILES.map(async (fileName) => {
      const content = await fs.readFile(resolveSeedAgentBundleUrl(seedKey, fileName), "utf8");
      return [fileName, content] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export function isSeedAgentKey(value: string): boolean {
  return SEED_AGENT_KEYS.has(value);
}
//// End Neocompany Modification

function resolveDefaultAgentBundleUrl(role: DefaultAgentBundleRole, fileName: string) {
  return new URL(`../onboarding-assets/${role}/${fileName}`, import.meta.url);
}

export async function loadDefaultAgentInstructionsBundle(role: DefaultAgentBundleRole): Promise<Record<string, string>> {
  const fileNames = DEFAULT_AGENT_BUNDLE_FILES[role];
  const entries = await Promise.all(
    fileNames.map(async (fileName) => {
      const content = await fs.readFile(resolveDefaultAgentBundleUrl(role, fileName), "utf8");
      return [fileName, content] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export function resolveDefaultAgentInstructionsBundleRole(role: string): DefaultAgentBundleRole {
  return role === "ceo" ? "ceo" : "default";
}

//// Neocompany Modification — instruction bundle resolver for new agents
// When agentService.create() materializes an agent's onboarding-assets
// bundle, the seed wiring needs to pick the seed-specific files
// (Nora/Lyra/Pixel/…) instead of the generic default/ceo template.
// `adapterConfig.instructionsTemplate` is set to the seedKey by the seed
// loop; this dispatcher reads that hint and dispatches accordingly.
export async function loadInstructionsBundleForNewAgent(params: {
  role: string;
  instructionsTemplate?: string | null;
}): Promise<Record<string, string>> {
  const tmpl = (params.instructionsTemplate ?? "").trim();
  if (tmpl && SEED_AGENT_KEYS.has(tmpl)) {
    return loadSeedAgentInstructionsBundle(tmpl);
  }
  return loadDefaultAgentInstructionsBundle(resolveDefaultAgentInstructionsBundleRole(params.role));
}
//// End Neocompany Modification
