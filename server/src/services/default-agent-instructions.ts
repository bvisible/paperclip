import fs from "node:fs/promises";

const DEFAULT_AGENT_BUNDLE_FILES = {
  default: ["AGENTS.md"],
  ceo: ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"],
} as const;

type DefaultAgentBundleRole = keyof typeof DEFAULT_AGENT_BUNDLE_FILES;

/**
 * Files shipped in each seed agent's onboarding-assets/seed-agents/<key>/ dir.
 * All nine seed agents share the same set: AGENTS / SOUL / IDENTITY / TOOLS.
 */
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

function resolveDefaultAgentBundleUrl(role: DefaultAgentBundleRole, fileName: string) {
  return new URL(`../onboarding-assets/${role}/${fileName}`, import.meta.url);
}

function resolveSeedAgentBundleUrl(seedKey: string, fileName: string) {
  return new URL(`../onboarding-assets/seed-agents/${seedKey}/${fileName}`, import.meta.url);
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

/**
 * Load the 4-file bundle (AGENTS/SOUL/IDENTITY/TOOLS) for a seed agent
 * identified by its stable seedKey (e.g. "pixel", "nora").
 */
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

export function resolveDefaultAgentInstructionsBundleRole(role: string): DefaultAgentBundleRole {
  return role === "ceo" ? "ceo" : "default";
}

/**
 * When an agent is created with adapterConfig.instructionsTemplate set to a
 * known seed key, use the seed bundle. Otherwise fall back to the legacy
 * default/ceo template.
 */
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

export function isSeedAgentKey(value: string): boolean {
  return SEED_AGENT_KEYS.has(value);
}
