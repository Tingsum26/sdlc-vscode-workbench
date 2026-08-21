import type * as vscode from "vscode";

export class ExtensionLogger {
  constructor(private readonly output: vscode.OutputChannel) {}
  info(event: string, fields: Record<string, unknown> = {}): void { this.write("INFO", event, fields); }
  error(event: string, fields: Record<string, unknown> = {}): void { this.write("ERROR", event, fields); }
  private write(level: string, event: string, fields: Record<string, unknown>): void {
    const safe = Object.fromEntries(Object.entries(fields).filter(([key]) => !/token|password|cookie|secret/i.test(key)));
    this.output.appendLine(JSON.stringify({ timestamp: new Date().toISOString(), level, component: "vscode-extension", event, ...safe }));
  }
}
