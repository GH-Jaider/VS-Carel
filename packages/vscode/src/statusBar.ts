/**
 * Status bar items for Karel: execution state, active world, and speed.
 *
 * Each item is a projection of controller state and a shortcut to a command:
 * - state  -> vs-karel.statusAction (contextual: run / stop / reset)
 * - world  -> vs-karel.selectWorld
 * - speed  -> vs-karel.setSpeed
 */

import * as vscode from "vscode";
import type { ExecutionState } from "./controller";

export class StatusBar implements vscode.Disposable {
  private readonly stateItem: vscode.StatusBarItem;
  private readonly worldItem: vscode.StatusBarItem;
  private readonly speedItem: vscode.StatusBarItem;

  private state: ExecutionState = "idle";
  private line: number | null = null;

  constructor() {
    this.stateItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 102);
    this.stateItem.name = "Karel: State";
    this.stateItem.command = "vs-karel.statusAction";

    this.worldItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 101);
    this.worldItem.name = "Karel: World";
    this.worldItem.command = "vs-karel.selectWorld";
    this.worldItem.tooltip = "Choose the world (.klm) used to run this program";

    this.speedItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.speedItem.name = "Karel: Speed";
    this.speedItem.command = "vs-karel.setSpeed";
    this.speedItem.tooltip = "Execution speed (delay between steps)";
  }

  setState(state: ExecutionState): void {
    this.state = state;
    if (state !== "running" && state !== "stepping" && state !== "error") {
      this.line = null;
    }
    this.render();
  }

  setLine(line: number): void {
    this.line = line;
    this.render();
  }

  setWorld(label: string | null): void {
    this.worldItem.text = `$(globe) ${label ?? "Choose world…"}`;
    this.render();
  }

  setSpeed(ms: number): void {
    this.speedItem.text = `$(dashboard) ${ms}ms`;
  }

  setVisible(visible: boolean): void {
    if (visible) {
      this.stateItem.show();
      this.worldItem.show();
      this.speedItem.show();
    } else {
      this.stateItem.hide();
      this.worldItem.hide();
      this.speedItem.hide();
    }
  }

  private render(): void {
    const at = this.line !== null ? ` (line ${this.line})` : "";
    let background: vscode.ThemeColor | undefined;
    let text: string;
    let tooltip: string;

    switch (this.state) {
      case "running":
        text = `$(sync~spin) Karel: Running${at}`;
        tooltip = "Click to stop";
        break;
      case "stepping":
        text = `$(debug-step-over) Karel: Step${at}`;
        tooltip = "F10 for the next step · click to stop";
        break;
      case "error":
        text = `$(error) Karel: Error${at}`;
        tooltip = "Click to reset the world";
        background = new vscode.ThemeColor("statusBarItem.errorBackground");
        break;
      case "done":
        text = "$(check) Karel: Done";
        tooltip = "Click to reset the world";
        break;
      default:
        text = "$(play) Karel: Ready";
        tooltip = "Click to run the program (F5)";
    }

    this.stateItem.text = text;
    this.stateItem.tooltip = tooltip;
    this.stateItem.backgroundColor = background;
  }

  dispose(): void {
    this.stateItem.dispose();
    this.worldItem.dispose();
    this.speedItem.dispose();
  }
}
