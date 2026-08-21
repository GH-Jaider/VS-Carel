/**
 * ExecutionController: the single owner of execution state.
 *
 * Owns the interpreter, the current world, the program<->world association,
 * the editor decorations and the status bar. Every command is a thin call
 * into this class; every UI surface (editor title buttons, CodeLens, status
 * bar, world panel) is a projection of its state.
 *
 * Rule: the .klm file is the initial state. Execution always runs on a World
 * built in memory from the map, and never writes back to the file. Reset
 * simply rebuilds the World from the map.
 */

import * as vscode from "vscode";
import * as path from "path";
import { Interpreter, RuntimeError, World, KarelMap, validateKarelMap } from "@karel/core";
import { WorldEditorProvider, SessionView } from "./worldEditor";
import { StatusBar } from "./statusBar";

export type ExecutionState = "idle" | "running" | "stepping" | "error" | "done";

const WORLD_LINKS_KEY = "vs-karel.worldLinks";

const SPEED_PRESETS: { label: string; ms: number }[] = [
  { label: "Very slow", ms: 1000 },
  { label: "Slow", ms: 750 },
  { label: "Normal", ms: 500 },
  { label: "Fast", ms: 250 },
  { label: "Turbo", ms: 50 },
];

async function uriExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

export class ExecutionController implements vscode.Disposable {
  private state: ExecutionState = "idle";
  private interpreter: Interpreter | null = null;
  private world: World | null = null;
  private worldMap: KarelMap | null = null;
  private worldUri: vscode.Uri | null = null;
  private programDoc: vscode.TextDocument | null = null;
  private worldEditors: WorldEditorProvider | null = null;
  private activeRun: Promise<void> | null = null;
  /** Serializes session preparation: a second F5/double-click no-ops instead of racing. */
  private preparing = false;

  private readonly statusBar = new StatusBar();
  private readonly output: vscode.OutputChannel;
  private readonly runningLineDecoration: vscode.TextEditorDecorationType;
  private readonly errorLineDecoration: vscode.TextEditorDecorationType;
  private readonly disposables: vscode.Disposable[] = [];

  private readonly worldLinkEmitter = new vscode.EventEmitter<void>();
  /** Fires when the program<->world association changes (CodeLens listens). */
  readonly onDidChangeWorldLink = this.worldLinkEmitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.output = vscode.window.createOutputChannel("Karel");

    this.runningLineDecoration = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor("editor.stackFrameHighlightBackground"),
      isWholeLine: true,
      overviewRulerColor: new vscode.ThemeColor("editorOverviewRuler.rangeHighlightForeground"),
      overviewRulerLane: vscode.OverviewRulerLane.Full,
    });
    this.errorLineDecoration = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor("inputValidation.errorBackground"),
      isWholeLine: true,
      overviewRulerColor: new vscode.ThemeColor("editorError.foreground"),
      overviewRulerLane: vscode.OverviewRulerLane.Full,
    });

    this.statusBar.setSpeed(this.configuredSpeed());
    this.statusBar.setWorld(null);
    this.applyState("idle");

    this.disposables.push(
      this.statusBar,
      this.worldLinkEmitter,
      this.runningLineDecoration,
      this.errorLineDecoration,
      vscode.window.onDidChangeActiveTextEditor(() => this.refreshContextUi()),
      // Focusing a world editor never changes the active TEXT editor, so the
      // status bar would keep the previous file's answer without this.
      vscode.window.tabGroups.onDidChangeTabs(() => this.refreshVisibility()),
      vscode.window.tabGroups.onDidChangeTabGroups(() => this.refreshVisibility()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("vs-karel.executionSpeed")) {
          const speed = this.configuredSpeed();
          this.interpreter?.setSpeed(speed);
          this.statusBar.setSpeed(speed);
        }
      })
    );

    // Keep CodeLens and status bar in sync when worlds appear or disappear.
    const klmWatcher = vscode.workspace.createFileSystemWatcher("**/*.klm");
    this.disposables.push(
      klmWatcher,
      klmWatcher.onDidCreate(() => {
        this.worldLinkEmitter.fire();
        void this.refreshContextUi();
      }),
      klmWatcher.onDidDelete(() => {
        this.worldLinkEmitter.fire();
        void this.refreshContextUi();
      })
    );

    void this.refreshContextUi();
  }

  /** Late wiring: the world editor provider needs the controller and vice versa. */
  setWorldEditors(provider: WorldEditorProvider): void {
    this.worldEditors = provider;
  }

  /**
   * The live session overlay for a world uri, or null. The world editor
   * shows this instead of the document while a session animates this world.
   */
  getSessionView(uri: vscode.Uri): SessionView | null {
    if (!this.world || !this.worldUri || this.worldUri.toString() !== uri.toString()) {
      return null;
    }
    if (this.state !== "running" && this.state !== "stepping") {
      return null;
    }
    return { world: this.world, status: { state: this.state } };
  }

  // ========== Commands ==========

  /**
   * Run the program: resolve program + world, rebuild the world from the
   * .klm (fresh initial state) and animate until done/error/stopped.
   * Running again while a run is active restarts cleanly.
   */
  async run(programUri?: vscode.Uri): Promise<void> {
    if (this.preparing) {
      return;
    }
    this.preparing = true;
    let doc: vscode.TextDocument | null;
    try {
      doc = await this.resolveProgram(programUri);
      if (!doc) {
        return;
      }
      await this.cancelActiveSession();
      if (!(await this.prepareSession(doc))) {
        return;
      }
    } finally {
      this.preparing = false;
    }

    this.applyState("running");
    this.log(`Running ${path.basename(doc.fileName)} on ${this.worldLabel() ?? "?"}`);

    const interpreter = this.interpreter!;
    this.activeRun = interpreter.run().catch((error: unknown) => {
      this.log(`Unexpected error: ${String(error)}`);
      void vscode.window.showErrorMessage(`Karel: unexpected error — ${String(error)}`);
      this.clearHighlights();
      this.applyState("idle");
    });
    await this.activeRun;
    this.activeRun = null;

    // onComplete/onError moved us to done/error; if we are still "running",
    // the loop was stopped by the user.
    if (this.state === "running") {
      this.applyState("idle");
      this.clearHighlights();
      this.log("Execution stopped");
    }
  }

  /**
   * One visible step. Continues the current step session, or starts a new
   * one from the initial world state.
   */
  async step(programUri?: vscode.Uri): Promise<void> {
    if (this.state === "stepping" && this.interpreter && !this.interpreter.isFinished) {
      this.interpreter.step();
      return;
    }

    if (this.preparing) {
      return;
    }
    this.preparing = true;
    let doc: vscode.TextDocument | null;
    try {
      doc = await this.resolveProgram(programUri);
      if (!doc) {
        return;
      }
      await this.cancelActiveSession();
      if (!(await this.prepareSession(doc))) {
        return;
      }
    } finally {
      this.preparing = false;
    }

    this.applyState("stepping");
    this.log(`Step mode: ${path.basename(doc.fileName)} on ${this.worldLabel() ?? "?"}`);
    this.interpreter!.step();
  }

  /**
   * Stop the current run/step session (the world keeps its current state
   * until Reset or the next Run).
   */
  stop(): void {
    if (this.state !== "running" && this.state !== "stepping") {
      return;
    }
    this.interpreter?.stop();
    if (this.state === "stepping") {
      this.applyState("idle");
      this.clearHighlights();
      this.log("Step session stopped");
    }
    // For "running", the run() loop notices the stop and finishes up.
  }

  /**
   * Reset: discard the session and rebuild the world from the .klm.
   */
  async reset(): Promise<void> {
    await this.cancelActiveSession();
    this.interpreter = null;
    this.clearHighlights();
    if (this.worldMap && this.worldUri) {
      this.world = new World(this.worldMap);
      this.worldEditors?.postWorld(this.worldUri, this.world);
    }
    this.applyState("idle");
  }

  /**
   * Contextual status bar action: idle -> run, running/stepping -> stop,
   * error/done -> reset.
   */
  async statusAction(): Promise<void> {
    switch (this.state) {
      case "running":
      case "stepping":
        this.stop();
        break;
      case "error":
      case "done":
        await this.reset();
        break;
      default:
        await this.run();
    }
  }

  /**
   * Let the user pick the world (.klm) for a program and remember the choice.
   */
  async selectWorld(programUri?: vscode.Uri): Promise<void> {
    const doc = await this.resolveProgram(programUri);
    if (!doc) {
      return;
    }

    const candidates = await vscode.workspace.findFiles("**/*.klm", "**/node_modules/**", 100);
    if (candidates.length === 0) {
      const choice = await vscode.window.showInformationMessage(
        "No world files (.klm) found in this folder.",
        "Create World"
      );
      if (choice) {
        await vscode.commands.executeCommand("vs-karel.newWorld");
      }
      return;
    }

    const conventionUri = this.conventionWorldUri(doc.uri);
    const items = candidates
      .map((uri) => ({
        label: path.basename(uri.fsPath),
        description:
          conventionUri && uri.toString() === conventionUri.toString()
            ? "matches program name"
            : vscode.workspace.asRelativePath(uri),
        uri,
      }))
      .sort((a, b) =>
        a.description === "matches program name" ? -1 : b.description === "matches program name" ? 1 : 0
      );

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: `World for ${path.basename(doc.fileName)}`,
    });
    if (!picked) {
      return;
    }

    const links = this.context.workspaceState.get<Record<string, string>>(WORLD_LINKS_KEY, {});
    links[doc.uri.toString()] = picked.uri.toString();
    await this.context.workspaceState.update(WORLD_LINKS_KEY, links);
    this.worldLinkEmitter.fire();

    // Instant feedback: open the chosen world beside (unless something is running).
    if (this.state !== "running" && this.state !== "stepping") {
      await this.worldEditors?.openBeside(picked.uri);
    }
    await this.refreshContextUi();
  }

  /**
   * Speed picker; writes the setting, which applies live to a running program.
   */
  async setSpeed(): Promise<void> {
    const current = this.configuredSpeed();
    const items = [
      ...SPEED_PRESETS.map((p) => ({
        label: `${p.label} (${p.ms}ms)`,
        description: p.ms === current ? "current" : undefined,
        ms: p.ms as number | null,
      })),
      { label: "Custom…", description: undefined, ms: null },
    ];
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: "Delay between execution steps",
    });
    if (!picked) {
      return;
    }

    let ms = picked.ms;
    if (ms === null) {
      const input = await vscode.window.showInputBox({
        prompt: "Delay between steps in milliseconds (50-2000)",
        value: String(current),
        validateInput: (v) => {
          const n = Number(v);
          return Number.isInteger(n) && n >= 50 && n <= 2000
            ? undefined
            : "Enter a whole number between 50 and 2000";
        },
      });
      if (!input) {
        return;
      }
      ms = Number(input);
    }

    await vscode.workspace
      .getConfiguration("vs-karel")
      .update("executionSpeed", ms, vscode.ConfigurationTarget.Global);
  }

  /**
   * Open the world for the current context: the active .klm itself, or the
   * world associated with the active (or last) program — always as the
   * world editor, beside the code.
   */
  async openVisualizer(resourceUri?: vscode.Uri): Promise<void> {
    const active = vscode.window.activeTextEditor;
    const klmUri =
      resourceUri?.fsPath.endsWith(".klm") === true
        ? resourceUri
        : active?.document.fileName.endsWith(".klm")
          ? active.document.uri
          : null;
    if (klmUri) {
      await this.worldEditors?.openBeside(klmUri);
      return;
    }

    const programUri =
      active?.document.languageId === "karel-instructions"
        ? active.document.uri
        : this.programDoc && !this.programDoc.isClosed
          ? this.programDoc.uri
          : null;
    if (programUri) {
      const worldUri = await this.peekWorldUri(programUri);
      if (worldUri) {
        await this.worldEditors?.openBeside(worldUri);
      } else {
        await this.selectWorld(programUri);
      }
      return;
    }

    if (this.worldUri) {
      await this.worldEditors?.openBeside(this.worldUri);
      return;
    }
    void vscode.window.showInformationMessage(
      "Open a Karel program (.kli) or world (.klm) first."
    );
  }

  /**
   * Open the JSON behind a world. Resolution mirrors openVisualizer, but it
   * must start from the tab: the world editor is a custom editor, so when it
   * has focus activeTextEditor is undefined and the Command Palette passes no
   * uri — which used to leave this command silently doing nothing.
   */
  async openWorldSource(resourceUri?: vscode.Uri): Promise<void> {
    const active = this.activeKarelTabUri();
    let target: vscode.Uri | null =
      resourceUri?.fsPath.endsWith(".klm") === true
        ? resourceUri
        : active?.fsPath.endsWith(".klm") === true
          ? active
          : null;

    if (!target && active?.fsPath.endsWith(".kli") === true) {
      target = await this.peekWorldUri(active);
    }
    if (!target) {
      target = this.worldUri;
    }
    if (!target) {
      void vscode.window.showInformationMessage(
        "Open a Karel world (.klm) — or a program that has one — to edit its JSON."
      );
      return;
    }

    // "default" is the built-in text editor, which is what shows the JSON:
    // .klm files open in the world editor by default.
    await vscode.commands.executeCommand("vscode.openWith", target, "default");
  }

  /**
   * A .klm file was saved. The world editor refreshes itself from the
   * document; here we only unwind a session that was running on it and
   * refresh the stored initial state so Reset/Run use the new content.
   */
  async onWorldFileSaved(doc: vscode.TextDocument): Promise<void> {
    if (!doc.fileName.endsWith(".klm")) {
      return;
    }
    if (this.worldUri?.toString() !== doc.uri.toString()) {
      return;
    }

    if (this.state === "running" || this.state === "stepping") {
      this.interpreter?.stop();
      await this.cancelActiveSession();
      this.clearHighlights();
      this.log(`World file changed on disk — execution stopped (${path.basename(doc.fileName)})`);
    }

    const map = await this.loadMap(doc.uri, true);
    if (map) {
      this.worldMap = map;
      this.world = new World(map);
      this.interpreter = null;
      this.applyState("idle");
      this.worldEditors?.refreshFromDocument(doc.uri);
    }
    await this.refreshContextUi();
  }

  /**
   * Non-interactive world resolution (for CodeLens / status bar):
   * remembered choice, then name convention, then a single workspace world.
   */
  async peekWorldUri(programUri: vscode.Uri): Promise<vscode.Uri | null> {
    const links = this.context.workspaceState.get<Record<string, string>>(WORLD_LINKS_KEY, {});
    const stored = links[programUri.toString()];
    if (stored) {
      const uri = vscode.Uri.parse(stored);
      if (await uriExists(uri)) {
        return uri;
      }
    }

    const convention = this.conventionWorldUri(programUri);
    if (convention && (await uriExists(convention))) {
      return convention;
    }

    const all = await vscode.workspace.findFiles("**/*.klm", "**/node_modules/**", 2);
    if (all.length === 1) {
      return all[0];
    }
    return null;
  }

  getState(): ExecutionState {
    return this.state;
  }

  // ========== Session plumbing ==========

  /**
   * Resolve which program to use: explicit uri, active editor, last program,
   * or a workspace search as a last resort.
   */
  private async resolveProgram(uri?: vscode.Uri): Promise<vscode.TextDocument | null> {
    if (uri) {
      return vscode.workspace.openTextDocument(uri);
    }

    const active = vscode.window.activeTextEditor;
    if (active?.document.languageId === "karel-instructions") {
      return active.document;
    }

    if (this.programDoc && !this.programDoc.isClosed) {
      return this.programDoc;
    }

    const files = await vscode.workspace.findFiles("**/*.kli", "**/node_modules/**", 20);
    if (files.length === 1) {
      return vscode.workspace.openTextDocument(files[0]);
    }
    if (files.length > 1) {
      const picked = await vscode.window.showQuickPick(
        files.map((f) => ({ label: path.basename(f.fsPath), description: vscode.workspace.asRelativePath(f), uri: f })),
        { placeHolder: "Which Karel program?" }
      );
      return picked ? vscode.workspace.openTextDocument(picked.uri) : null;
    }

    const choice = await vscode.window.showInformationMessage(
      "No Karel program (.kli) found. Create one to get started.",
      "New Karel Program"
    );
    if (choice) {
      await vscode.commands.executeCommand("vs-karel.newProgram");
    }
    return null;
  }

  /**
   * Build a fresh session: world from the .klm + interpreter loaded with the
   * program source. Returns false (with user feedback) on any problem.
   */
  private async prepareSession(doc: vscode.TextDocument): Promise<boolean> {
    // Clear leftovers from a previous session before programDoc changes,
    // otherwise decorations on the old program become unremovable.
    this.clearHighlights();
    this.programDoc = doc;

    const worldUri = await this.resolveWorldUriInteractive(doc);
    if (!worldUri) {
      return false;
    }
    const map = await this.loadMap(worldUri);
    if (!map) {
      return false;
    }

    this.worldUri = worldUri;
    this.worldMap = map;
    this.world = new World(map);

    const interpreter = new Interpreter(this.world);
    interpreter.setSpeed(this.configuredSpeed());

    const diagnostics = interpreter.load(doc.getText());
    if (diagnostics.some((d) => d.severity === "error")) {
      const count = diagnostics.filter((d) => d.severity === "error").length;
      const choice = await vscode.window.showErrorMessage(
        `Cannot run: the program has ${count === 1 ? "an error" : `${count} errors`}.`,
        "Show Problems"
      );
      if (choice) {
        await vscode.commands.executeCommand("workbench.actions.view.problems");
      }
      return false;
    }

    this.wireCallbacks(interpreter, doc);
    this.interpreter = interpreter;

    // The world lives in its own editor: open the .klm beside the code.
    await this.worldEditors?.openBeside(worldUri);
    this.worldEditors?.postWorld(worldUri, this.world);
    await this.refreshContextUi();
    return true;
  }

  private wireCallbacks(interpreter: Interpreter, doc: vscode.TextDocument): void {
    interpreter.onStep = (line) => {
      if (this.world && this.worldUri) {
        this.worldEditors?.postWorld(this.worldUri, this.world);
        if (this.state === "stepping") {
          this.worldEditors?.postStatus(this.worldUri, { state: "stepping", line });
        }
      }
      this.statusBar.setLine(line);
      this.highlightLine(doc, line, this.runningLineDecoration);
    };

    interpreter.onComplete = () => {
      this.clearHighlights();
      this.applyState("done");
      this.log("Program completed");
    };

    interpreter.onError = (error: RuntimeError) => {
      this.clearHighlights();
      this.applyState("error", error.message, error.line);
      if (error.line !== undefined) {
        this.statusBar.setLine(error.line);
        this.highlightLine(doc, error.line, this.errorLineDecoration);
      }
      const where = error.line !== undefined ? ` (line ${error.line})` : "";
      this.log(`Error shutoff${where}: ${error.message}`);
      void vscode.window
        .showErrorMessage(`Karel${where}: ${error.message}`, "Reset World", "Go to Line")
        .then(async (choice) => {
          if (choice === "Reset World") {
            await this.reset();
          } else if (choice === "Go to Line" && error.line !== undefined) {
            const editor = await vscode.window.showTextDocument(doc);
            const position = new vscode.Position(error.line - 1, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(
              new vscode.Range(position, position),
              vscode.TextEditorRevealType.InCenter
            );
          }
        });
    };
  }

  /**
   * Interactive world resolution used before executing:
   * remembered choice -> convention -> single world -> QuickPick.
   */
  private async resolveWorldUriInteractive(doc: vscode.TextDocument): Promise<vscode.Uri | null> {
    const peeked = await this.peekWorldUri(doc.uri);
    if (peeked) {
      return peeked;
    }

    const candidates = await vscode.workspace.findFiles("**/*.klm", "**/node_modules/**", 100);
    if (candidates.length === 0) {
      const choice = await vscode.window.showInformationMessage(
        `No world file (.klm) found for ${path.basename(doc.fileName)}. Create one?`,
        "Create World"
      );
      if (choice) {
        await vscode.commands.executeCommand("vs-karel.newWorld");
      }
      return null;
    }

    const picked = await vscode.window.showQuickPick(
      candidates.map((uri) => ({
        label: path.basename(uri.fsPath),
        description: vscode.workspace.asRelativePath(uri),
        uri,
      })),
      { placeHolder: `World for ${path.basename(doc.fileName)} (remembered for next time)` }
    );
    if (!picked) {
      return null;
    }

    const links = this.context.workspaceState.get<Record<string, string>>(WORLD_LINKS_KEY, {});
    links[doc.uri.toString()] = picked.uri.toString();
    await this.context.workspaceState.update(WORLD_LINKS_KEY, links);
    this.worldLinkEmitter.fire();
    return picked.uri;
  }

  private conventionWorldUri(programUri: vscode.Uri): vscode.Uri | null {
    if (!programUri.fsPath.endsWith(".kli")) {
      return null;
    }
    return programUri.with({ path: programUri.path.replace(/\.kli$/, ".klm") });
  }

  private async loadMap(uri: vscode.Uri, quiet = false): Promise<KarelMap | null> {
    let text: string;
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      text = Buffer.from(bytes).toString("utf8");
    } catch {
      if (!quiet) {
        void vscode.window.showErrorMessage(`Cannot read world file: ${path.basename(uri.fsPath)}`);
      }
      return null;
    }

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (e) {
      void this.showWorldFileError(
        uri,
        [`Not valid JSON: ${e instanceof Error ? e.message : String(e)}`],
        quiet
      );
      return null;
    }

    const result = validateKarelMap(data);
    if (!result.ok || !result.map) {
      void this.showWorldFileError(uri, result.errors, quiet);
      return null;
    }
    return result.map;
  }

  private async showWorldFileError(uri: vscode.Uri, errors: string[], quiet = false): Promise<void> {
    const name = path.basename(uri.fsPath);
    this.log(`Invalid world file ${name}:`);
    for (const error of errors) {
      this.log(`  - ${error}`);
    }
    if (quiet) {
      return;
    }
    const choice = await vscode.window.showErrorMessage(
      `World file ${name} is invalid: ${errors[0]}${errors.length > 1 ? ` (+${errors.length - 1} more)` : ""}`,
      "Open File"
    );
    if (choice) {
      await vscode.window.showTextDocument(uri);
    }
  }

  private async cancelActiveSession(): Promise<void> {
    if (this.activeRun) {
      this.interpreter?.stop();
      try {
        await this.activeRun;
      } catch {
        // already reported by run()
      }
      this.activeRun = null;
    }
  }

  // ========== UI projections ==========

  private applyState(state: ExecutionState, message?: string, line?: number): void {
    this.state = state;
    this.statusBar.setState(state);
    void vscode.commands.executeCommand("setContext", "vs-karel.state", state);
    if (this.worldUri) {
      this.worldEditors?.postStatus(this.worldUri, { state, message, line });
    }
    this.refreshVisibility();
  }

  private highlightLine(
    doc: vscode.TextDocument,
    line: number,
    decoration: vscode.TextEditorDecorationType
  ): void {
    const range = new vscode.Range(line - 1, 0, line - 1, Number.MAX_SAFE_INTEGER);
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document === doc) {
        editor.setDecorations(decoration, [range]);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      }
    }
  }

  private clearHighlights(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document === this.programDoc) {
        editor.setDecorations(this.runningLineDecoration, []);
        editor.setDecorations(this.errorLineDecoration, []);
      }
    }
  }

  /**
   * Show/hide status bar items and refresh the world item label.
   */
  private async refreshContextUi(): Promise<void> {
    this.refreshVisibility();

    const active = vscode.window.activeTextEditor;
    if (active?.document.languageId === "karel-instructions") {
      const worldUri = await this.peekWorldUri(active.document.uri);
      this.statusBar.setWorld(worldUri ? path.basename(worldUri.fsPath) : null);
    } else if (this.worldUri) {
      this.statusBar.setWorld(path.basename(this.worldUri.fsPath));
    }
  }

  private refreshVisibility(): void {
    // Visible where it is useful: on a Karel file, or wherever the user goes
    // while a program is actually executing. Anchoring this to "a world has
    // been built" instead would leave the items up for the rest of the
    // session, in every unrelated file.
    const executing = this.state === "running" || this.state === "stepping";
    this.statusBar.setVisible(this.activeKarelTabUri() !== null || executing);
  }

  /**
   * The .kli/.klm the user is looking at, or null. Reads the active tab rather
   * than activeTextEditor because a world opens in a custom editor, and VS Code
   * only reports text editors through activeTextEditor.
   */
  private activeKarelTabUri(): vscode.Uri | null {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    const uri =
      input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom
        ? input.uri
        : null;
    if (!uri) {
      return null;
    }
    return uri.fsPath.endsWith(".kli") || uri.fsPath.endsWith(".klm") ? uri : null;
  }

  private worldLabel(): string | null {
    return this.worldUri ? path.basename(this.worldUri.fsPath) : null;
  }

  private configuredSpeed(): number {
    return vscode.workspace.getConfiguration("vs-karel").get("executionSpeed", 500);
  }

  private log(message: string): void {
    this.output.appendLine(message);
  }

  dispose(): void {
    this.interpreter?.stop();
    this.output.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
