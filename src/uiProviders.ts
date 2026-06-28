import * as vscode from "vscode";
import { BUILDER_PREFIX, BuilderDiagnostic } from "./diagnostics";
import { loadCachedApiMap, resolveReplacement, extractMemberName } from "./ruleStore";

const QUICKFIX_TITLE = "💡 Modernize code via Builder";

function isBuilderDiagnostic(d: vscode.Diagnostic): d is BuilderDiagnostic {
  return d.message.startsWith(BUILDER_PREFIX);
}

function findBuilderDiagnostics(
  document: vscode.TextDocument,
  range: vscode.Range | vscode.Position
): BuilderDiagnostic[] {
  const collection = vscode.languages.getDiagnostics(document.uri);
  const pos = range instanceof vscode.Position ? range : range.start;
  return collection.filter(
    (d): d is BuilderDiagnostic =>
      isBuilderDiagnostic(d) && d.range.contains(pos)
  );
}

class BuilderHoverProvider implements vscode.HoverProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Hover> {
    const hits = findBuilderDiagnostics(document, position);
    if (hits.length === 0) return null;

    const apiMap = loadCachedApiMap(this.context);

    const sections = hits.map((d) => {
      const rule = d.builderRule!;
      const resolved = resolveReplacement(rule, apiMap);
      const memberName = extractMemberName(rule.pattern);

      const oldBlock = rule.pattern.startsWith(":")
        ? `local part = workspace.Part\npart${rule.pattern}`
        : `local obj = workspace.Object\nprint(obj.${memberName})`;

      let newBlock: string;
      if (resolved.isIdentity) {
        newBlock = `-- ⚠️ No direct modern equivalent.\n-- See explanation for structural guidance.`;
      } else if (rule.pattern.startsWith("Object.")) {
        newBlock = `local obj = workspace.Object\nprint(obj.${resolved.value})`;
      } else {
        newBlock = resolved.value;
      }

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

    const header = "🤖 **Builder Code Modernizer**\n\n---\n";
    const body = sections.join("\n\n---\n\n");
    const markdown = new vscode.MarkdownString(header + body);
    markdown.isTrusted = true;
    return new vscode.Hover(markdown, hits[0].range);
  }
}

class BuilderCodeActionProvider implements vscode.CodeActionProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.CodeAction[]> {
    const diagnostics =
      context.diagnostics.length > 0
        ? (context.diagnostics.filter(isBuilderDiagnostic) as BuilderDiagnostic[])
        : findBuilderDiagnostics(document, range);

    if (diagnostics.length === 0) return [];

    const apiMap = loadCachedApiMap(this.context);

    const actions: vscode.CodeAction[] = [];
    for (const d of diagnostics) {
      const rule = d.builderRule!;
      const resolved = resolveReplacement(rule, apiMap);

      const action = new vscode.CodeAction(
        QUICKFIX_TITLE,
        vscode.CodeActionKind.QuickFix
      );
      action.diagnostics = [d];
      action.isPreferred = true;

      if (resolved.isIdentity) {
        action.disabled = { reason: "No modern replacement available for this deprecated API" };
        actions.push(action);
        continue;
      }

      action.edit = new vscode.WorkspaceEdit();

      const startLine = d.range.start.line;
      const lineText = document.lineAt(startLine).text;
      const leadingWhitespace = lineText.match(/^[ \t]*/)?.[0] ?? "";

      let replacementText: string;
      if (rule.pattern.startsWith("Object.")) {
        const charBefore =
          d.range.start.character > 0
            ? lineText.charAt(d.range.start.character - 1)
            : "";
        const prefix = charBefore === "." ? "" : ".";
        replacementText = prefix + resolved.value;
      } else {
        replacementText = leadingWhitespace + resolved.value;
      }

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
  _diagnosticCollection: vscode.DiagnosticCollection
): void {
  const selector: vscode.DocumentSelector = [
    { language: "lua" },
    { language: "luau" },
  ];

  const hover = vscode.languages.registerHoverProvider(
    selector,
    new BuilderHoverProvider(context)
  );
  context.subscriptions.push(hover);

  const codeAction = vscode.languages.registerCodeActionsProvider(
    selector,
    new BuilderCodeActionProvider(context),
    {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    }
  );
  context.subscriptions.push(codeAction);
}
