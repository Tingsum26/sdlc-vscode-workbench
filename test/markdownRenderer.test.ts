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

  it("renders API surface tables for page and payload reports", () => {
    const html = markdownToHtml("| Page | API | Field |\n| --- | --- | --- |\n| Review | POST /v1/reviews | applicantId |");
    expect(html).toContain("<table>");
    expect(html).toContain("<th scope=\"col\">Page</th>");
    expect(html).toContain("<td>POST /v1/reviews</td>");
  });
});
