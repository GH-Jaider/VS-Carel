/**
 * CodeLens over BEGINNING-OF-PROGRAM: the most discoverable control surface.
 *
 *   ▶ Run  ·  Step  ·  World: recolector.klm (change)
 *
 * Makes both the primary action and the program<->world association visible
 * right where the student is looking.
 */

import * as vscode from "vscode";
import * as path from "path";
import { ExecutionController } from "@/controller";

export class KarelCodeLensProvider implements vscode.CodeLensProvider {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.emitter.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly controller: ExecutionController) {
    this.disposables.push(
      this.emitter,
      controller.onDidChangeWorldLink(() => this.emitter.fire())
    );
  }

  async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    let anchor: vscode.Range | null = null;
    for (let i = 0; i < document.lineCount; i++) {
      if (/beginning-of-program/i.test(document.lineAt(i).text)) {
        anchor = new vscode.Range(i, 0, i, 0);
        break;
      }
    }
    if (!anchor) {
      return [];
    }

    const worldUri = await this.controller.peekWorldUri(document.uri);
    const worldTitle = worldUri
      ? `World: ${path.basename(worldUri.fsPath)} (change)`
      : "Choose world…";

    return [
      new vscode.CodeLens(anchor, {
        title: "▶ Run",
        tooltip: "Run this Karel program (F5)",
        command: "vs-karel.run",
        arguments: [document.uri],
      }),
      new vscode.CodeLens(anchor, {
        title: "Step",
        tooltip: "Execute one instruction at a time (F10)",
        command: "vs-karel.step",
        arguments: [document.uri],
      }),
      new vscode.CodeLens(anchor, {
        title: worldTitle,
        tooltip: "The world (.klm) this program runs in",
        command: "vs-karel.selectWorld",
        arguments: [document.uri],
      }),
    ];
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
