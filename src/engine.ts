import * as vscode from "vscode";
import { refreshDiagnostics, setDiagnosticsContext, clearDiagnostics } from "./diagnostics";
import { registerUIProviders } from "./uiProviders";

const DEBOUNCE_MS = 400;

let debounceTimer: NodeJS.Timeout | undefined;
let diagnosticCollection: vscode.DiagnosticCollection | undefined;

function isTargetDocument(document: vscode.TextDocument): boolean {
  const lang = document.languageId;
  return lang === "lua" || lang === "luau";
}

function scheduleRefresh(document: vscode.TextDocument): void {
  if (!diagnosticCollection) return;
  if (!isTargetDocument(document)) return;

  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
  }

  debounceTimer = setTimeout(() => {
    debounceTimer = undefined;
    refreshDiagnostics(document, diagnosticCollection!);
  }, DEBOUNCE_MS);
}

export function activateEngine(context: vscode.ExtensionContext): void {
  console.log("[engine] Activating diagnostics engine");

  setDiagnosticsContext(context);

  diagnosticCollection = vscode.languages.createDiagnosticCollection(
    "roblox-builder-rules"
  );
  context.subscriptions.push(diagnosticCollection);

  const openDisposable = vscode.workspace.onDidOpenTextDocument((document) => {
    if (!isTargetDocument(document)) return;
    if (!diagnosticCollection) return;
    refreshDiagnostics(document, diagnosticCollection);
  });
  context.subscriptions.push(openDisposable);

  const changeDisposable = vscode.workspace.onDidChangeTextDocument((event) => {
    const document = event.document;
    if (!isTargetDocument(document)) return;
    scheduleRefresh(document);
  });
  context.subscriptions.push(changeDisposable);

  const closeDisposable = vscode.workspace.onDidCloseTextDocument((document) => {
    if (!isTargetDocument(document)) return;
    if (!diagnosticCollection) return;
    clearDiagnostics(document, diagnosticCollection);
  });
  context.subscriptions.push(closeDisposable);

  if (vscode.window.activeTextEditor) {
    const doc = vscode.window.activeTextEditor.document;
    if (isTargetDocument(doc) && diagnosticCollection) {
      refreshDiagnostics(doc, diagnosticCollection);
    }
  }

  vscode.workspace.textDocuments.forEach((document) => {
    if (!isTargetDocument(document)) return;
    if (!diagnosticCollection) return;
    refreshDiagnostics(document, diagnosticCollection);
  });

  registerUIProviders(context, diagnosticCollection);

  console.log("[engine] Diagnostics engine active");
}

export function deactivateEngine(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
  }
  diagnosticCollection = undefined;
}
