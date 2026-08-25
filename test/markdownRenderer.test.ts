import { describe, expect, it } from "vitest";
import { markdownToHtml } from "../src/mvp/markdownRenderer.js";

describe("Journey Markdown HTML renderer", () => {
  it("renders report structure while removing front matter", () => {
    const html = markdownToHtml("---\nstatus: APPROVED\n---\n# Requirements\n\n- API is additive\n- QA review pending");
    expect(html).toContain("<h1>Requirements</h1>");
    expect(html).toContain("<ul>");
    expect(html).not.toContain("status: APPROVED");
  });

  it("escapes active HTML and rejects unsafe links", () => {
    const html = markdownToHtml("<script>alert(1)</script> [bad](javascript:alert(1)) [good](https://example.test)");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('href=\"#\"');
    expect(html).toContain('href=\"https://example.test\"');
  });
});
