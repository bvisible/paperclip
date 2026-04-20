/**
 * Signed public asset route — serves plugin-owned images via a short-lived
 * signed URL so external providers (Instagram Graph API, Facebook's image
 * URL fetch, etc.) can download them without any Paperclip auth.
 *
 * The URL shape is:
 *   /api/assets/public/<b64url(payload)>.<hex(sig)>
 *
 * payload = JSON { c: companyId, e: entityExternalId, x: expiresAtMs, k: kind }
 * sig     = HMAC-SHA256(payload, PAPERCLIP_ASSET_SIGNING_SECRET)
 *
 * The route verifies the HMAC, checks the TTL, then reads the plugin
 * entity and streams its `finalImageUrl` data URL as a binary response.
 */

import { Router } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { pluginEntities } from "@paperclipai/db";

const MAX_TTL_MS = 24 * 60 * 60 * 1000; // 24h max

function signingSecret(): Buffer {
  const secret =
    process.env.PAPERCLIP_ASSET_SIGNING_SECRET
    ?? process.env.BETTER_AUTH_SECRET
    ?? "paperclip-asset-dev-secret";
  return Buffer.from(secret);
}

interface SignedPayload {
  c: string; // companyId
  e: string; // externalId of the plugin_entities row
  k: string; // entity kind (e.g. "generated_image")
  x: number; // expiresAtMs
}

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(s: string): Buffer {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/")
    + "=".repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

export function signAssetUrl(
  publicOrigin: string,
  companyId: string,
  kind: string,
  externalId: string,
  ttlMs: number,
): string {
  const capped = Math.min(Math.max(ttlMs, 60_000), MAX_TTL_MS);
  const payload: SignedPayload = {
    c: companyId,
    e: externalId,
    k: kind,
    x: Date.now() + capped,
  };
  const payloadBytes = Buffer.from(JSON.stringify(payload), "utf8");
  const payloadB64 = base64UrlEncode(payloadBytes);
  const sig = createHmac("sha256", signingSecret()).update(payloadB64).digest("hex");
  return `${publicOrigin.replace(/\/+$/, "")}/api/assets/public/${payloadB64}.${sig}`;
}

function decodeDataUrl(dataUrl: string): { buffer: Buffer; mimeType: string } | null {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  return { mimeType: m[1]!, buffer: Buffer.from(m[2]!, "base64") };
}

export function signedAssetsRoute(db: Db): Router {
  const router = Router();

  router.get("/assets/public/:token", async (req, res) => {
    try {
      const raw = String(req.params.token ?? "");
      const dot = raw.indexOf(".");
      if (dot < 0) {
        res.status(400).send("bad token");
        return;
      }
      const payloadB64 = raw.slice(0, dot);
      const providedSig = raw.slice(dot + 1);
      const expected = createHmac("sha256", signingSecret()).update(payloadB64).digest("hex");

      const a = Buffer.from(providedSig, "hex");
      const b = Buffer.from(expected, "hex");
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        res.status(403).send("bad signature");
        return;
      }

      let payload: SignedPayload;
      try {
        payload = JSON.parse(base64UrlDecode(payloadB64).toString("utf8")) as SignedPayload;
      } catch {
        res.status(400).send("bad payload");
        return;
      }
      if (!payload.c || !payload.e || !payload.k || !payload.x) {
        res.status(400).send("bad payload");
        return;
      }
      if (payload.x < Date.now()) {
        res.status(410).send("expired");
        return;
      }

      const rows = await db
        .select()
        .from(pluginEntities)
        .where(
          and(
            eq(pluginEntities.scopeKind, "company"),
            eq(pluginEntities.scopeId, payload.c),
            eq(pluginEntities.entityType, payload.k),
            eq(pluginEntities.externalId, payload.e),
          ),
        );
      const row = rows[0];
      if (!row) {
        res.status(404).send("not found");
        return;
      }

      const data = (row.data ?? {}) as Record<string, unknown>;
      const url = (data.finalImageUrl as string | undefined) ?? (data.rawImageUrl as string | undefined);
      if (!url || typeof url !== "string") {
        res.status(404).send("no image");
        return;
      }
      if (!url.startsWith("data:")) {
        // Already a public URL — just redirect.
        res.redirect(302, url);
        return;
      }
      const decoded = decodeDataUrl(url);
      if (!decoded) {
        res.status(500).send("bad image data");
        return;
      }

      res.setHeader("Content-Type", decoded.mimeType || "image/png");
      res.setHeader("Content-Length", String(decoded.buffer.length));
      // Meta's media-fetch crawler follows short-lived cache hints, so
      // a conservative cache for 5 min is enough and prevents aggressive
      // leakage after the token expires.
      res.setHeader("Cache-Control", "public, max-age=300, immutable");
      res.end(decoded.buffer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error("[assets-public] failed", msg);
      res.status(500).send("internal error");
    }
  });

  return router;
}
