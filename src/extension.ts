import * as vscode from "vscode";
import { activateSyncManager } from "./syncManager";
import { activateEngine, deactivateEngine } from "./engine";

export function activate(context: vscode.ExtensionContext): void {
  console.log("[Jarvis Core] Extension entry point triggered!");
  activateSyncManager(context);
  activateEngine(context);
}

export function deactivate(): void {
  deactivateEngine();
}
