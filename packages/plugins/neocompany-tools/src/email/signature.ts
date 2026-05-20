//// Neocompany Modification — Email signature interpolation + HTML→text strip.
////
//// Tokens follow `{{name}}` (Gmail / Hermes prompt style), deliberately
//// distinct from the `{token}` style used by `scenes/picker.ts:interpolateBody`
//// so an agent can't accidentally mix the two. Unknown tokens are left
//// verbatim — keeps audit easy when the operator stares at the rendered
//// signature and asks "why isn't X filled in".
////
//// `stripHtmlToText` powers the multipart `text` fallback fed to Resend so
//// clients that can't render HTML still see the signature.
//// End Neocompany Modification

export interface SignatureTokens {
  agentName: string;
  agentTitle?: string;
  agentEmail?: string;
  agentRole?: string;
  companyName?: string;
  /** Any extra token the caller wants to inject (e.g. `{{phone}}`). */
  [key: string]: string | undefined;
}

/**
 * Replace `{{token}}` placeholders in `html` with values from `tokens`.
 * Tokens whose value is `undefined` or that aren't in the map are left
 * unchanged so the operator can spot missing data in the rendered preview.
 */
export function interpolateSignature(html: string, tokens: SignatureTokens): string {
  return html.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (match, key: string) => {
    const value = tokens[key];
    if (value === undefined || value === null) return match;
    return String(value);
  });
}

/**
 * Strip HTML tags and collapse whitespace — used for the plain-text
 * multipart alternative of an outbound email. Not a sanitiser; for
 * rendering security we sandbox the HTML in an iframe at the UI layer.
 *
 * Handles common entities (&amp; &lt; &gt; &quot; &#39; &nbsp;) explicitly.
 * Block-level closing tags become line breaks so the resulting text keeps
 * a readable layout.
 */
export function stripHtmlToText(html: string): string {
  if (!html) return "";
  let out = html;
  // Block-end tags → newline so paragraphs/divs/lis stay readable.
  out = out.replace(/<\/(p|div|li|tr|h[1-6]|br|hr|blockquote)>/gi, "\n");
  out = out.replace(/<br\s*\/?>/gi, "\n");
  // Drop every remaining tag.
  out = out.replace(/<[^>]+>/g, "");
  // Common entities.
  out = out
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  // Collapse runs of whitespace per-line, then trim blank-line runs.
  out = out
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return out;
}

/**
 * Marker class wrapped around the signature when appended to a body, so we
 * can detect "already has a signature" on subsequent replies in a thread
 * and skip the append (anti-duplication). Used by both the worker
 * (matching) and the email send tool (writing).
 */
export const SIGNATURE_SENTINEL_ATTR = "data-pcs-signature";

export function wrapSignatureHtml(signatureHtml: string): string {
  return `<div ${SIGNATURE_SENTINEL_ATTR}>${signatureHtml}</div>`;
}

export function bodyAlreadyHasSignature(bodyHtml: string): boolean {
  return bodyHtml.includes(SIGNATURE_SENTINEL_ATTR);
}
