import * as vscode from "vscode";
import { activateSyncManager } from "./syncManager";
import { activateEngine, deactivateEngine } from "./engine";
import { BuilderApipediaProvider } from "./ApipediaProvider";

export function activate(context: vscode.ExtensionContext): void {
  console.log("[Builder Core] Extension entry point triggered!");
  activateSyncManager(context);
  activateEngine(context);

  const apipediaProvider = new BuilderApipediaProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("builder.apipediaView", apipediaProvider)
  );
  console.log("[Builder Core] APIpedia webview view registered");
}

export function deactivate(): void {
  deactivateEngine();
}
