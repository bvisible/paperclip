/**
 * Social provider registry — keyed lookup used by the worker and bridge
 * routes. Phase K ships LinkedIn only; Facebook + Instagram will slot in
 * here as additional files in a future phase.
 */

import { linkedin } from "./linkedin.js";
import type { SocialProvider, SocialProviderKey } from "./types.js";

export const PROVIDERS: Record<SocialProviderKey, SocialProvider | undefined> = {
  linkedin,
  facebook: undefined,
  instagram: undefined,
};

export function getProvider(key: SocialProviderKey): SocialProvider {
  const p = PROVIDERS[key];
  if (!p) throw new Error(`Social provider not implemented: ${key}`);
  return p;
}

export function listAvailableProviders(): SocialProvider[] {
  return Object.values(PROVIDERS).filter((p): p is SocialProvider => Boolean(p));
}
