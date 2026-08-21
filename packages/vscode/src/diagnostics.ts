/**
 * Diagnostics Provider for Karel instruction files.
 *
 * Reparses on change (debounced) and publishes all parser diagnostics.
 * Highlighting can be toggled off for classroom use.
 */

import * as vscode from "vscode";
import { Parser, Diagnostic as KarelDiagnostic } from "@karel/core";

const DEBOUNCE_MS = 250;

export class DiagnosticsProvider implements vscode.Disposable {
  private readonly collection: vscode.DiagnosticCollection;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor() {
    this.collection = vscode.languages.createDiagnosticCollection("karel");

    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.languageId === "karel-instructions") {
          this.scheduleUpdate(e.document);
        }
      }),
      vscode.workspace.onDidOpenTextDocument((doc) => {
        if (doc.languageId === "karel-instructions") {
          this.updateDiagnostics(doc);
        }
      }),
      vscode.workspace.onDidCloseTextDocument((doc) => {
        this.collection.delete(doc.uri);
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("vs-karel.enableErrorHighlighting")) {
          this.refreshAllDocuments();
        }
      })
    );

    vscode.workspace.textDocuments.forEach((doc) => {
      if (doc.languageId === "karel-instructions") {
        this.updateDiagnostics(doc);
      }
    });
  }

  private isEnabled(): boolean {
    return vscode.workspace.getConfiguration("vs-karel").get("enableErrorHighlighting", true);
  }

  private scheduleUpdate(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    const existing = this.timers.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        this.updateDiagnostics(document);
      }, DEBOUNCE_MS)
    );
  }

  updateDiagnostics(document: vscode.TextDocument): void {
    if (document.isClosed) {
      return;
    }
    if (!this.isEnabled()) {
      this.collection.set(document.uri, []);
      return;
    }

    const parser = new Parser();
    const { diagnostics } = parser.parse(document.getText());
    this.collection.set(
      document.uri,
      diagnostics.map((d) => this.toVSCodeDiagnostic(d, document))
    );
  }

  private toVSCodeDiagnostic(
    diagnostic: KarelDiagnostic,
    document: vscode.TextDocument
  ): vscode.Diagnostic {
    const line = Math.min(Math.max(0, diagnostic.line - 1), document.lineCount - 1);
    const lineLength = document.lineAt(line).text.length;
    const startCol = Math.min(diagnostic.column, lineLength);
    const endCol = Math.min(diagnostic.endColumn ?? lineLength, Math.max(lineLength, startCol + 1));

    const range = new vscode.Range(line, startCol, line, Math.max(endCol, startCol + 1));

    const severity =
      diagnostic.severity === "error"
        ? vscode.DiagnosticSeverity.Error
        : diagnostic.severity === "warning"
          ? vscode.DiagnosticSeverity.Warning
          : vscode.DiagnosticSeverity.Information;

    const vsDiag = new vscode.Diagnostic(range, diagnostic.message, severity);
    vsDiag.source = "Karel";
    return vsDiag;
  }

  refreshAllDocuments(): void {
    this.collection.clear();
    if (this.isEnabled()) {
      vscode.workspace.textDocuments.forEach((doc) => {
        if (doc.languageId === "karel-instructions") {
          this.updateDiagnostics(doc);
        }
      });
    }
  }

  async toggle(): Promise<boolean> {
    const config = vscode.workspace.getConfiguration("vs-karel");
    const current = config.get("enableErrorHighlighting", true);
    await config.update("enableErrorHighlighting", !current, vscode.ConfigurationTarget.Global);
    return !current;
  }

  dispose(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.collection.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
