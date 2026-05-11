//// Neocompany Modification — extracted accumulateText so it can be unit-tested
//// Previously inlined in worker.ts. Moved here verbatim — no behaviour change.
//// End Neocompany Modification

/**
 * Defensive text accumulation for streamed chat events.
 *
 * The openclaw-gateway adapter is *supposed* to forward token-level
 * deltas (`data.delta`). On follow-up turns running on a thread that
 * already has prior history (since NORA's Wave 7.1b externalId upsert
 * started reusing threads across messages) two upstream artefacts
 * have been observed:
 *
 *   1. Cumulative snapshots — a single `data.text` event carries the
 *      full assistant message so far instead of just the new token.
 *      Naive `prev + incoming` then yields
 *      "OuiOui,, je je me me sou souviviensens..."
 *
 *   2. Duplicate events — the same token chunk is forwarded twice in
 *      a row, producing "SuperSuper,, et et toi toi ?".
 *
 * This helper tolerates BOTH:
 *   • If `incoming` is strictly longer than `prev` AND starts with it,
 *     treat as a cumulative snapshot → replace.
 *   • Else if `prev` already ends with `incoming` (the previous event's
 *     payload is being repeated), treat as a duplicate → skip.
 *   • Otherwise (genuine delta), append.
 *
 * Pure deltas always fall into the third branch because they don't
 * start with the existing content and prev doesn't end with them —
 * behavior unchanged for the well-behaved adapter case.
 */
export function accumulateText(prev: string, incoming: string): string {
  if (!incoming) return prev;
  // (1) Cumulative snapshot: incoming carries everything we have plus more.
  if (incoming.length > prev.length && incoming.startsWith(prev)) {
    return incoming;
  }
  // (2) Duplicate event: the same chunk we just appended is being sent
  //     a second time. Skip rather than append.
  if (incoming.length <= prev.length && prev.endsWith(incoming)) {
    return prev;
  }
  // (3) Genuine delta — append as before.
  return prev + incoming;
}
