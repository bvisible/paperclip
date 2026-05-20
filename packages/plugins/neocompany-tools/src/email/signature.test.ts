//// Neocompany Modification — tests for signature interpolation + HTML strip.
//// End Neocompany Modification

import { describe, expect, it } from "vitest";
import {
  bodyAlreadyHasSignature,
  interpolateSignature,
  SIGNATURE_SENTINEL_ATTR,
  stripHtmlToText,
  wrapSignatureHtml,
} from "./signature.js";

describe("interpolateSignature", () => {
  it("replaces known tokens with values", () => {
    const html = `<p>{{agentName}} — {{agentTitle}}<br>{{agentEmail}}</p>`;
    const out = interpolateSignature(html, {
      agentName: "Melvin",
      agentTitle: "Support",
      agentEmail: "melvin@reed-blake.ch",
    });
    expect(out).toBe(`<p>Melvin — Support<br>melvin@reed-blake.ch</p>`);
  });

  it("leaves unknown tokens verbatim so the operator notices missing data", () => {
    const out = interpolateSignature(`<p>{{agentName}} — {{phone}}</p>`, {
      agentName: "Jean",
    });
    expect(out).toBe(`<p>Jean — {{phone}}</p>`);
  });

  it("leaves tokens whose value is undefined verbatim", () => {
    const out = interpolateSignature(`<p>{{agentName}} — {{agentTitle}}</p>`, {
      agentName: "Jean",
      agentTitle: undefined,
    });
    expect(out).toBe(`<p>Jean — {{agentTitle}}</p>`);
  });

  it("tolerates whitespace inside the braces", () => {
    expect(interpolateSignature(`{{ agentName }}`, { agentName: "X" })).toBe("X");
    expect(interpolateSignature(`{{agentName }}`, { agentName: "X" })).toBe("X");
  });

  it("accepts arbitrary extra tokens via index signature", () => {
    const out = interpolateSignature(`{{phone}} | {{location}}`, {
      agentName: "Jean",
      phone: "+41 22 555 1234",
      location: "Genève",
    });
    expect(out).toBe("+41 22 555 1234 | Genève");
  });
});

describe("stripHtmlToText", () => {
  it("returns empty string for empty input", () => {
    expect(stripHtmlToText("")).toBe("");
  });

  it("strips tags and decodes common entities", () => {
    expect(
      stripHtmlToText(`<p>Hello&nbsp;<b>world</b> &amp; co.</p>`),
    ).toBe("Hello world & co.");
  });

  it("turns block-end tags + <br> into line breaks", () => {
    const out = stripHtmlToText(
      `<p>Line one</p><p>Line two<br>still line two</p><div>Line three</div>`,
    );
    expect(out).toBe("Line one\nLine two\nstill line two\nLine three");
  });

  it("collapses runs of whitespace per line", () => {
    expect(stripHtmlToText(`<p>   too    many   spaces   </p>`)).toBe("too many spaces");
  });

  it("collapses runs of blank lines to one", () => {
    const out = stripHtmlToText(`<p>A</p><p></p><p></p><p>B</p>`);
    expect(out).toBe("A\n\nB");
  });

  it("strips a real-ish signature block to legible text", () => {
    const html = `
      <table><tr><td>
        <p><b>Jean Dupont</b><br>Support Reed Blake 1835<br>
           <a href="mailto:jean@reed-blake.ch">jean@reed-blake.ch</a></p>
      </td></tr></table>`;
    const out = stripHtmlToText(html);
    expect(out).toContain("Jean Dupont");
    expect(out).toContain("Support Reed Blake 1835");
    expect(out).toContain("jean@reed-blake.ch");
    // No tags should leak through.
    expect(out).not.toMatch(/<|>/);
  });
});

describe("signature sentinel (anti-duplication)", () => {
  it("wraps the html with the sentinel attribute", () => {
    const wrapped = wrapSignatureHtml(`<p>Jean</p>`);
    expect(wrapped).toBe(`<div ${SIGNATURE_SENTINEL_ATTR}><p>Jean</p></div>`);
  });

  it("detects an already-signed body", () => {
    expect(bodyAlreadyHasSignature(`Re: hello <div ${SIGNATURE_SENTINEL_ATTR}>x</div>`)).toBe(true);
    expect(bodyAlreadyHasSignature(`<p>just a body</p>`)).toBe(false);
  });
});
