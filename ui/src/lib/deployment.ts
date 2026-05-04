//// Neoffice Modification: neoffice-embed-mode
//// Why: Paperclip can run in two distinct modes:
////        1. Standalone — its own subdomain (e.g. app.neocompany.ch). Default.
////        2. Embedded inside Neoffice — served under /paperclip/ on a Frappe
////           tenant (e.g. osiris.neoffice.me/paperclip/). The user expects an
////           ERP-app feel: no Paperclip account menu, no company picker, theme
////           mirrored from Frappe Desk, irrelevant routes redirected away.
////      We surface that distinction once, here, as a compile-time-inlined
////      constant. Every Neoffice-specific render branch / redirect lives behind
////      `IS_NEOFFICE` so the standalone path stays byte-for-byte upstream when
////      the flag is unset (and tree-shakers can drop the dead branch).
////
////      The flag is fed by VITE_PAPERCLIP_DEPLOYMENT (build-time env var). The
////      value is forced into the bundle via `vite.config.ts → define`, see
////      the corresponding `//// Neoffice Modification: neoffice-embed-mode`
////      block there. .env.production also lists it as documentation.
////
////      ⚠️ Never read VITE_PAPERCLIP_DEPLOYMENT directly outside this module.
////      Always import `IS_NEOFFICE` so we have a single grep target when
////      auditing what differs in Neoffice mode.
//// Date: 2026-05-04
//// Refs: NORA #27 Phase A — see [[NORA/27-paperclip-neoffice-embed/README]]
////       Upstream master commit f0f7f6c7 (Vite define inlining, lost on Nora fork)
////       Convention: cf NORA #25 perf-optimization premier bloc officiel

/**
 * Deployment label baked into the bundle at build time. Empty string in the
 * default upstream / standalone build, "neoffice" when built with
 * `VITE_PAPERCLIP_DEPLOYMENT=neoffice` (set on Neoffice tenant deploys).
 *
 * Future-proofing: extra labels (e.g. "neocompany", "embedded-demo") can be
 * added to the union as Paperclip ships in more contexts. Today only the
 * Neoffice embed has bespoke UI behaviour, hence the boolean shortcut below.
 */
export const PAPERCLIP_DEPLOYMENT: "" | "neoffice" =
  (import.meta.env.VITE_PAPERCLIP_DEPLOYMENT as "" | "neoffice" | undefined) ?? "";

/**
 * True when the running bundle was built for an embedded Neoffice deployment.
 *
 * Use this to:
 *   - Hide chrome elements that double up with the Frappe Desk shell
 *     (account menu, company picker when only one company exists, etc.).
 *   - Redirect away from Paperclip-only routes (instance settings, onboarding,
 *     auth pages) that would confuse the Neoffice user.
 *   - Mirror the Frappe Desk theme via localStorage.theme_active (see
 *     ThemeContext, Phase C) instead of letting the user toggle independently.
 *
 * Convention: every read site of this constant should be wrapped with a
 * `//// Neoffice Modification: <slug>` block so the deviation is immediately
 * visible to anyone porting upstream paperclipai changes back into our fork.
 */
export const IS_NEOFFICE = PAPERCLIP_DEPLOYMENT === "neoffice";
//// End Neoffice Modification: neoffice-embed-mode
