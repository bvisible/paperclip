/**
 * Context access layer.
 *
 * Resolves Frappe credentials per-company using Paperclip's context API:
 *   1. Company-specific override in ctx.state (scopeKind: "company")
 *   2. Instance-wide defaults from plugin config + secrets
 *   3. Process environment fallback (dev convenience)
 */

import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { FrappeConfig } from "./adapters/frappe.js";

const STATE_KEY_URL = "nora:frappe:url";
const STATE_KEY_SITE = "nora:frappe:siteName";
const STATE_KEY_API_KEY = "nora:frappe:apiKey";
const STATE_KEY_API_SECRET_REF = "nora:frappe:apiSecretRef";

const DEFAULT_TIMEOUT_MS = 60_000;

export interface ToolContextAccess {
  getFrappeConfig(companyId: string): Promise<FrappeConfig>;
}

interface PlatformConfigShape {
  frappeUrlDefault?: string;
  frappeSiteNameDefault?: string;
  frappeApiKeyDefault?: string;
  frappeApiSecretDefault?: string;
}

let cachedPlatformConfig: Promise<PlatformConfigShape | null> | null = null;

async function readPlatformConfig(
  ctx: PluginContext,
): Promise<PlatformConfigShape | null> {
  if (!cachedPlatformConfig) {
    cachedPlatformConfig = (async () => {
      try {
        const raw = await ctx.config?.get?.();
        if (raw && typeof raw === "object") {
          return raw as PlatformConfigShape;
        }
      } catch {
        // ignore — config API unavailable
      }
      return null;
    })();
  }
  return cachedPlatformConfig;
}

/** Read a string from instance config with a fallback to process env. */
async function readInstanceOrEnv(
  ctx: PluginContext,
  configKey: keyof PlatformConfigShape,
  envKey: string,
): Promise<string | undefined> {
  const platform = await readPlatformConfig(ctx);
  const configValue = platform?.[configKey];
  if (typeof configValue === "string" && configValue) return configValue;
  const envValue = process.env[envKey];
  return envValue && envValue.length > 0 ? envValue : undefined;
}

async function readStateString(
  ctx: PluginContext,
  companyId: string,
  stateKey: string,
): Promise<string | undefined> {
  try {
    const value = await ctx.state?.get?.({
      scopeKind: "company",
      scopeId: companyId,
      stateKey,
    });
    if (typeof value === "string" && value) return value;
  } catch {
    // ignore — state may not be available in all contexts
  }
  return undefined;
}

export function makeCtxAccess(ctx: PluginContext): ToolContextAccess {
  return {
    async getFrappeConfig(companyId: string): Promise<FrappeConfig> {
      // 1. URL: company override → instance default → env.
      const url =
        (await readStateString(ctx, companyId, STATE_KEY_URL)) ??
        (await readInstanceOrEnv(ctx, "frappeUrlDefault", "FRAPPE_URL")) ??
        "http://127.0.0.1:8000";

      // 2. Site name (optional, for multi-site bench).
      const siteName =
        (await readStateString(ctx, companyId, STATE_KEY_SITE)) ??
        (await readInstanceOrEnv(ctx, "frappeSiteNameDefault", "FRAPPE_SITE_NAME")) ??
        undefined;

      // 3. API key: usually plain (not secret-ref worthy) — user-scoped token.
      const apiKey =
        (await readStateString(ctx, companyId, STATE_KEY_API_KEY)) ??
        (await readInstanceOrEnv(ctx, "frappeApiKeyDefault", "FRAPPE_API_KEY"));
      if (!apiKey) {
        throw new Error(
          "NORA Frappe tools: missing API key. Set FRAPPE_API_KEY env var " +
            "or configure company state 'nora:frappe:apiKey'.",
        );
      }

      // 4. API secret: prefer secret-ref stored in company state; fallback env.
      const secretRef = await readStateString(ctx, companyId, STATE_KEY_API_SECRET_REF);
      let apiSecret: string | undefined;
      if (secretRef && ctx.secrets?.resolve) {
        try {
          apiSecret = await ctx.secrets.resolve(secretRef);
        } catch (err) {
          ctx.logger?.warn?.(
            `Failed to resolve Frappe secret ref "${secretRef}": ${(err as Error).message}`,
          );
        }
      }
      if (!apiSecret) {
        apiSecret = await readInstanceOrEnv(
          ctx,
          "frappeApiSecretDefault",
          "FRAPPE_API_SECRET",
        );
      }
      if (!apiSecret) {
        throw new Error(
          "NORA Frappe tools: missing API secret. Set FRAPPE_API_SECRET env var " +
            "or configure a secret ref via 'nora:frappe:apiSecretRef'.",
        );
      }

      return {
        url,
        apiKey,
        apiSecret,
        siteName,
        timeoutMs: DEFAULT_TIMEOUT_MS,
      };
    },
  };
}
