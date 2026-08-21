/**
 * VS Karel — Karel the Robot for VS Code.
 *
 * activate() wires four pieces together:
 *  - ExecutionController: single owner of execution state (world, interpreter,
 *    status bar, decorations, world panel sync)
 *  - DiagnosticsProvider: live parse diagnostics for .kli files
 *  - KarelCodeLensProvider: "▶ Run · Step · World: x.klm" over the program
 *  - WorldEditorProvider: .klm files open AS the rendered world (custom editor)
 */

import * as vscode from "vscode";
import { ExecutionController } from "@/controller";
import { DiagnosticsProvider } from "@/diagnostics";
import { KarelCodeLensProvider } from "@/codeLens";
import { WorldEditorProvider } from "@/worldEditor";

const PROGRAM_TEMPLATE = `BEGINNING-OF-PROGRAM
	DEFINE-NEW-INSTRUCTION turnright AS
	BEGIN
		turnleft;
		turnleft;
		turnleft
	END

	BEGINNING-OF-EXECUTION
		move;
		pickbeeper;
		turnright;
		move;
		putbeeper;
		turnoff
	END-OF-EXECUTION
END-OF-PROGRAM
`;

const WORLD_TEMPLATE = `{
  "dimensions": { "width": 8, "height": 6 },
  "karel": { "x": 1, "y": 1, "facing": "north", "beepers": 0 },
  "beepers": [{ "x": 1, "y": 2, "count": 1 }],
  "walls": []
}
`;

async function uriExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function newProgram(): Promise<void> {
  const name = await vscode.window.showInputBox({
    prompt: "Name for the new Karel program",
    value: "myprogram",
    validateInput: (value) =>
      /^[a-zA-Z0-9_-]+$/.test(value)
        ? undefined
        : "Use only letters, numbers, hyphens and underscores",
  });
  if (!name) {
    return;
  }

  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!folder) {
    const doc = await vscode.workspace.openTextDocument({
      language: "karel-instructions",
      content: PROGRAM_TEMPLATE,
    });
    await vscode.window.showTextDocument(doc);
    void vscode.window.showInformationMessage(
      "Tip: open a folder so Karel can create a matching world (.klm) next to your program."
    );
    return;
  }

  const kli = vscode.Uri.joinPath(folder, `${name}.kli`);
  const klm = vscode.Uri.joinPath(folder, `${name}.klm`);
  if (await uriExists(kli)) {
    void vscode.window.showErrorMessage(`${name}.kli already exists.`);
    return;
  }

  await vscode.workspace.fs.writeFile(kli, Buffer.from(PROGRAM_TEMPLATE, "utf8"));
  const createdWorld = !(await uriExists(klm));
  if (createdWorld) {
    await vscode.workspace.fs.writeFile(klm, Buffer.from(WORLD_TEMPLATE, "utf8"));
  }

  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(kli));
  void vscode.window.showInformationMessage(
    createdWorld
      ? `Created ${name}.kli and its world ${name}.klm — press F5 to run.`
      : `Created ${name}.kli — press F5 to run it on ${name}.klm.`
  );
}

async function newWorld(): Promise<void> {
  const active = vscode.window.activeTextEditor?.document;
  const defaultName =
    active && active.fileName.endsWith(".kli")
      ? active.fileName.replace(/^.*[/\\]/, "").replace(/\.kli$/, "")
      : "world";

  const name = await vscode.window.showInputBox({
    prompt: "Name for the new world file",
    value: defaultName,
    validateInput: (value) =>
      /^[a-zA-Z0-9_-]+$/.test(value)
        ? undefined
        : "Use only letters, numbers, hyphens and underscores",
  });
  if (!name) {
    return;
  }

  const folder =
    active && active.uri.scheme === "file"
      ? vscode.Uri.joinPath(active.uri, "..")
      : vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!folder) {
    void vscode.window.showErrorMessage("Open a folder first to create a world file.");
    return;
  }

  const klm = vscode.Uri.joinPath(folder, `${name}.klm`);
  if (await uriExists(klm)) {
    void vscode.window.showErrorMessage(`${name}.klm already exists.`);
    return;
  }

  await vscode.workspace.fs.writeFile(klm, Buffer.from(WORLD_TEMPLATE, "utf8"));
  // vscode.open respects the default editor, so the world opens drawn.
  await vscode.commands.executeCommand("vscode.open", klm);
  void vscode.window.showInformationMessage(
    `Created ${name}.klm — click the {} button in its title bar to edit the JSON.`
  );
}

export function activate(context: vscode.ExtensionContext): void {
  const controller = new ExecutionController(context);
  const worldEditors = new WorldEditorProvider(context.extensionUri, (uri) =>
    controller.getSessionView(uri)
  );
  controller.setWorldEditors(worldEditors);
  const diagnostics = new DiagnosticsProvider();
  const codeLens = new KarelCodeLensProvider(controller);

  context.subscriptions.push(
    controller,
    worldEditors,
    worldEditors.register(),
    diagnostics,
    codeLens,
    vscode.languages.registerCodeLensProvider({ language: "karel-instructions" }, codeLens),

    vscode.commands.registerCommand("vs-karel.run", (uri?: vscode.Uri) => controller.run(uri)),
    vscode.commands.registerCommand("vs-karel.step", (uri?: vscode.Uri) => controller.step(uri)),
    vscode.commands.registerCommand("vs-karel.stop", () => controller.stop()),
    vscode.commands.registerCommand("vs-karel.reset", () => controller.reset()),
    vscode.commands.registerCommand("vs-karel.statusAction", () => controller.statusAction()),
    vscode.commands.registerCommand("vs-karel.selectWorld", (uri?: vscode.Uri) =>
      controller.selectWorld(uri)
    ),
    vscode.commands.registerCommand("vs-karel.setSpeed", () => controller.setSpeed()),
    vscode.commands.registerCommand("vs-karel.openVisualizer", (uri?: vscode.Uri) =>
      controller.openVisualizer(uri)
    ),
    vscode.commands.registerCommand("vs-karel.openWorldSource", async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (target?.fsPath.endsWith(".klm")) {
        await vscode.commands.executeCommand("vscode.openWith", target, "default");
      }
    }),
    vscode.commands.registerCommand("vs-karel.newProgram", () => newProgram()),
    vscode.commands.registerCommand("vs-karel.newWorld", () => newWorld()),
    vscode.commands.registerCommand("vs-karel.toggleErrorHighlighting", async () => {
      const enabled = await diagnostics.toggle();
      void vscode.window.showInformationMessage(
        enabled ? "Karel error highlighting enabled" : "Karel error highlighting disabled"
      );
    }),

    vscode.workspace.onDidSaveTextDocument((doc) => {
      void controller.onWorldFileSaved(doc);
    })
  );
}

export function deactivate(): void {
  // Everything is disposed via context.subscriptions.
}
