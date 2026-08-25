import { escapeHtml } from "../webview/html.js";

const inline = (value: string): string => {
  let result = escapeHtml(value);
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, url: string) => {
    const safeUrl = /^(https?:\/\/|\/|\.\.\/|\.\/)/i.test(url) ? url : "#";
    return `<a href="${escapeHtml(safeUrl)}">${label}</a>`;
  });
  return result;
};

/** Small, dependency-free Markdown renderer for committed Journey reports. */
export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").split(/\r?\n/);
  const output: string[] = [];
  let code = false;
  let list = false;
  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (code) output.push("</code></pre>");
      else output.push("<pre class=\"code\"><code>");
      code = !code;
      continue;
    }
    if (code) { output.push(inline(line) + "\n"); continue; }
    if (/^\s*-\s+/.test(line)) {
      if (!list) { output.push("<ul>"); list = true; }
      output.push(`<li>${inline(line.replace(/^\s*-\s+/, ""))}</li>`);
      continue;
    }
    if (list) { output.push("</ul>"); list = false; }
    const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) { const level = heading[1]!.length; output.push(`<h${level}>${inline(heading[2]!)}</h${level}>`); continue; }
    if (!line.trim()) continue;
    output.push(`<p>${inline(line)}</p>`);
  }
  if (list) output.push("</ul>");
  if (code) output.push("</code></pre>");
  return output.join("\n") || "<p>No report content.</p>";
}
