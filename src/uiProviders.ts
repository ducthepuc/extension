import * as vscode from "vscode";
import { JARVIS_PREFIX, JarvisDiagnostic } from "./diagnostics";

const QUICKFIX_TITLE = "💡 Modernize code via Jarvis";

function isJarvisDiagnostic(d: vscode.Diagnostic): d is JarvisDiagnostic {
  return d.message.startsWith(JARVIS_PREFIX);
}

function findJarvisDiagnostics(
  document: vscode.TextDocument,
  range: vscode.Range | vscode.Position
): JarvisDiagnostic[] {
  const collection = vscode.languages.getDiagnostics(document.uri);
  const pos = range instanceof vscode.Position ? range : range.start;
  return collection.filter(
    (d): d is JarvisDiagnostic =>
      isJarvisDiagnostic(d) && d.range.contains(pos)
  );
}

class JarvisHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Hover> {
    const hits = findJarvisDiagnostics(document, position);
    if (hits.length === 0) return null;

    const sections = hits.map((d) => {
      const rule = d.jarvisRule!;
      const oldBlock = rule.pattern.startsWith(":")
        ? `local part = workspace.Part\npart${rule.pattern}`
        : `${rule.pattern}`;
      const newBlock = rule.replacement;
      return [
        rule.explanation,
        "",
        "**Old Way:**",
        "```lua",
        oldBlock,
        "```",
        "",
        "**Modern Luau Way:**",
        "```lua",
        newBlock,
        "```",
      ].join("\n");
    });

    const header = "🤖 **Jarvis Code Modernizer**\n\n---\n";
    const body = sections.join("\n\n---\n\n");
    const markdown = new vscode.MarkdownString(header + body);
    markdown.isTrusted = true;
    return new vscode.Hover(markdown, hits[0].range);
  }
}

class JarvisCodeActionProvider implements vscode.CodeActionProvider {
  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.CodeAction[]> {
    const diagnostics =
      context.diagnostics.length > 0
        ? context.diagnostics.filter(isJarvisDiagnostic) as JarvisDiagnostic[]
        : findJarvisDiagnostics(document, range);

    if (diagnostics.length === 0) return [];

    const actions: vscode.CodeAction[] = [];
    for (const d of diagnostics) {
      const rule = d.jarvisRule!;
      const action = new vscode.CodeAction(
        QUICKFIX_TITLE,
        vscode.CodeActionKind.QuickFix
      );
      action.diagnostics = [d];
      action.isPreferred = true;

      action.edit = new vscode.WorkspaceEdit();

      const startLine = d.range.start.line;
      const lineText = document.lineAt(startLine).text;
      const leadingWhitespace = lineText.match(/^[ \t]*/)?.[0] ?? "";

      const replacementText = leadingWhitespace + rule.replacement;

      action.edit.replace(
        document.uri,
        new vscode.Range(
          d.range.start.line,
          d.range.start.character,
          d.range.end.line,
          d.range.end.character
        ),
        replacementText
      );
      actions.push(action);
    }

    return actions;
  }
}

export function registerUIProviders(
  context: vscode.ExtensionContext,
  diagnosticCollection: vscode.DiagnosticCollection
): void {
  const selector: vscode.DocumentSelector = [
    { language: "lua" },
    { language: "luau" },
  ];

  const hover = vscode.languages.registerHoverProvider(
    selector,
    new JarvisHoverProvider()
  );
  context.subscriptions.push(hover);

  const codeAction = vscode.languages.registerCodeActionsProvider(
    selector,
    new JarvisCodeActionProvider(),
    {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    }
  );
  context.subscriptions.push(codeAction);
}
