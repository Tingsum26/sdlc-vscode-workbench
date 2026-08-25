import { escapeHtml } from "../webview/html.js";

export interface AgentReportMetadata { [key: string]: string; }

export function parseFrontMatter(markdown: string): { metadata: AgentReportMetadata; body: string } {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { metadata: {}, body: markdown };
  const metadata = Object.fromEntries(match[1]!.split(/\r?\n/).flatMap((line) => {
    const separator = line.indexOf(":");
    return separator < 0 ? [] : [[line.slice(0, separator).trim(), line.slice(separator + 1).trim()]];
  }));
  return { metadata, body: markdown.slice(match[0].length) };
}

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
  const lines = parseFrontMatter(markdown).body.split(/\r?\n/);
  const output: string[] = [];
  let code = false;
  let codeLanguage = "";
  let list = false;
  let table = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.trim().startsWith("```")) {
      if (code) { output.push("</code></pre>"); codeLanguage = ""; }
      else {
        codeLanguage = line.trim().slice(3).trim().toLowerCase();
        output.push(`<pre class="code ${codeLanguage === "mermaid" ? "diagram" : ""}"><code>`);
      }
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
    if (line.trim().startsWith("|") && lines[index + 1]?.trim().startsWith("|")) {
      const cells = (value: string) => value.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => inline(cell.trim()));
      const headerCells = cells(line);
      const separator = lines[index + 1]!.trim();
      if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(separator)) {
        if (!table) { output.push("<table><thead><tr>"); output.push(headerCells.map((cell) => `<th scope=\"col\">${cell}</th>`).join("")); output.push("</tr></thead><tbody>"); table = true; }
        index += 1;
        while (index + 1 < lines.length && lines[index + 1]!.trim().startsWith("|")) {
          index += 1; output.push(`<tr>${cells(lines[index]!).map((cell) => `<td>${cell}</td>`).join("")}</tr>`);
        }
        output.push("</tbody></table>"); table = false;
        continue;
      }
    }
    const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) { const level = heading[1]!.length; output.push(`<h${level}>${inline(heading[2]!)}</h${level}>`); continue; }
    if (!line.trim()) continue;
    output.push(`<p>${inline(line)}</p>`);
  }
  if (list) output.push("</ul>");
  if (table) output.push("</tbody></table>");
  if (code) output.push("</code></pre>");
  return output.join("\n") || "<p>No report content.</p>";
}
