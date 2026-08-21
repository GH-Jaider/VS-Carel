/**
 * Custom editor for .klm files: opening a world file shows the rendered
 * world — there is no synthetic "visualizer panel". The second screen is
 * simply the world file open beside the code, like any other file.
 *
 * Semantics: the document is the world's INITIAL state. While the
 * ExecutionController animates a session on this world, the session
 * overlay wins; otherwise the editor renders straight from the document
 * (live, debounced, as the JSON is edited). Execution never writes to the
 * document, so running can never mark the file dirty.
 *
 * "Open With → Text Editor" (or the {} editor-title button) shows the JSON,
 * which keeps schema validation and autocomplete.
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { World, validateKarelMap } from "@/interpreter";

export type WorldStatus = {
  state: "idle" | "running" | "stepping" | "error" | "done";
  message?: string;
  line?: number;
};

export type SessionView = { world: World; status: WorldStatus };

interface WorldEditorInstance {
  panel: vscode.WebviewPanel;
  ready: boolean;
}

const REFRESH_DEBOUNCE_MS = 300;

export class WorldEditorProvider implements vscode.CustomTextEditorProvider, vscode.Disposable {
  public static readonly viewType = "vs-karel.world";

  private readonly instances = new Map<string, Set<WorldEditorInstance>>();
  private readonly refreshTimers = new Map<string, NodeJS.Timeout>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    /** Returns the live session overlay for a world uri, or null. */
    private readonly sessionView: (uri: vscode.Uri) => SessionView | null
  ) {
    // Live preview while the JSON is edited — unless a session animates it.
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (!this.instances.has(e.document.uri.toString())) {
          return;
        }
        if (this.sessionView(e.document.uri)) {
          return;
        }
        this.scheduleRefresh(e.document);
      })
    );
  }

  register(): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(WorldEditorProvider.viewType, this, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    });
  }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    webviewPanel.webview.html = this.getHtmlContent(webviewPanel.webview);

    const key = document.uri.toString();
    const instance: WorldEditorInstance = { panel: webviewPanel, ready: false };
    let set = this.instances.get(key);
    if (!set) {
      set = new Set();
      this.instances.set(key, set);
    }
    set.add(instance);

    const messageSub = webviewPanel.webview.onDidReceiveMessage((message: { type?: string }) => {
      if (message?.type !== "ready") {
        return;
      }
      instance.ready = true;
      // Send the authoritative current view: session overlay if one is
      // animating this world, the document otherwise.
      const session = this.sessionView(document.uri);
      if (session) {
        this.postTo(instance, { type: "world", data: session.world.toJSON() });
        this.postTo(instance, { type: "status", ...session.status });
      } else {
        this.sendDocumentWorld(instance, document);
      }
    });

    webviewPanel.onDidDispose(() => {
      messageSub.dispose();
      set.delete(instance);
      if (set.size === 0) {
        this.instances.delete(key);
      }
    });
  }

  /** Is any world editor open for this uri? */
  isOpen(uri: vscode.Uri): boolean {
    return (this.instances.get(uri.toString())?.size ?? 0) > 0;
  }

  /**
   * Open (or reveal) the world editor for a .klm beside the current editor,
   * without stealing focus.
   */
  async openBeside(uri: vscode.Uri): Promise<void> {
    await vscode.commands.executeCommand("vscode.openWith", uri, WorldEditorProvider.viewType, {
      viewColumn: vscode.ViewColumn.Beside,
      preserveFocus: true,
    });
  }

  /** Push a session world snapshot to every editor showing this uri. */
  postWorld(uri: vscode.Uri, world: World): void {
    this.broadcast(uri, { type: "world", data: world.toJSON() });
  }

  /** Push an execution status to every editor showing this uri. */
  postStatus(uri: vscode.Uri, status: WorldStatus): void {
    this.broadcast(uri, { type: "status", ...status });
  }

  /** Re-render this uri's editors from their document (initial state). */
  refreshFromDocument(uri: vscode.Uri): void {
    const document = vscode.workspace.textDocuments.find(
      (d) => d.uri.toString() === uri.toString()
    );
    if (!document) {
      return;
    }
    for (const instance of this.instances.get(uri.toString()) ?? []) {
      this.sendDocumentWorld(instance, document);
    }
  }

  private scheduleRefresh(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    const existing = this.refreshTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    this.refreshTimers.set(
      key,
      setTimeout(() => {
        this.refreshTimers.delete(key);
        if (!this.sessionView(document.uri)) {
          this.refreshFromDocument(document.uri);
        }
      }, REFRESH_DEBOUNCE_MS)
    );
  }

  private sendDocumentWorld(instance: WorldEditorInstance, document: vscode.TextDocument): void {
    let data: unknown;
    try {
      data = JSON.parse(document.getText());
    } catch {
      // Keep the last rendered world visible while the JSON is mid-edit.
      this.postTo(instance, {
        type: "status",
        state: "error",
        message: `${path.basename(document.fileName)} is not valid JSON`,
      });
      return;
    }

    const result = validateKarelMap(data);
    if (!result.ok || !result.map) {
      this.postTo(instance, {
        type: "status",
        state: "error",
        message: `Invalid world: ${result.errors[0] ?? "unknown error"}`,
      });
      return;
    }

    this.postTo(instance, { type: "world", data: new World(result.map).toJSON() });
    this.postTo(instance, { type: "status", state: "idle" });
  }

  private broadcast(uri: vscode.Uri, message: unknown): void {
    for (const instance of this.instances.get(uri.toString()) ?? []) {
      this.postTo(instance, message);
    }
  }

  private postTo(instance: WorldEditorInstance, message: unknown): void {
    // Not ready yet: drop — the "ready" handler sends the authoritative view.
    if (!instance.ready) {
      return;
    }
    Promise.resolve(instance.panel.webview.postMessage(message)).catch(() => undefined);
  }

  private getHtmlContent(webview: vscode.Webview): string {
    const htmlPath = path.join(this.extensionUri.fsPath, "media", "webview.html");
    const htmlContent = fs.readFileSync(htmlPath, "utf8");

    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "webview.css")
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "webview.js")
    );

    return htmlContent
      .replace(/\{\{styleUri\}\}/g, styleUri.toString())
      .replace(/\{\{scriptUri\}\}/g, scriptUri.toString())
      .replace(/\{\{cspSource\}\}/g, webview.cspSource);
  }

  dispose(): void {
    for (const timer of this.refreshTimers.values()) {
      clearTimeout(timer);
    }
    this.refreshTimers.clear();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
