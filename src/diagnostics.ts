import * as vscode from "vscode";

interface ModernRule {
  pattern: string;
  replacement: string;
  explanation: string;
  severity: "warning" | "error" | "info";
}

interface RulesPayload {
  rules: ModernRule[];
}

export const JARVIS_PREFIX = "🤖 [Jarvis] Outdated Practice: ";

export interface JarvisDiagnostic extends vscode.Diagnostic {
  jarvisRule?: ModernRule;
}

const STORAGE_KEY = "modern_rules_cache";

function loadRules(context: vscode.ExtensionContext): ModernRule[] {
  const raw = context.globalState.get<string>(STORAGE_KEY);
  if (!raw) return [];
  try {
    const payload = JSON.parse(raw) as RulesPayload;
    return Array.isArray(payload.rules) ? payload.rules : [];
  } catch (err) {
    console.error("[diagnostics] Failed to parse cached rules:", (err as Error).message);
    return [];
  }
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildMatcher(rule: ModernRule): RegExp | null {
  const pattern = rule.pattern.trim();
  if (!pattern) return null;

  if (pattern.startsWith("Object.")) {
    const propName = pattern.slice(7);
    if (!propName) return null;
    return new RegExp("\\." + escapeRegExp(propName) + "\\b", "g");
  }

  let re: RegExp;
  if (pattern.startsWith(":")) {
    re = new RegExp(escapeRegExp(pattern) + "\\s*\\(?", "g");
  } else if (/^[A-Za-z_]/.test(pattern)) {
    re = new RegExp("\\b" + escapeRegExp(pattern) + "\\s*\\(?[^(\\w]", "g");
  } else {
    re = new RegExp(escapeRegExp(pattern), "g");
  }
  return re;
}

function severityOf(rule: ModernRule): vscode.DiagnosticSeverity {
  switch (rule.severity) {
    case "error":
      return vscode.DiagnosticSeverity.Error;
    case "info":
      return vscode.DiagnosticSeverity.Information;
    case "warning":
    default:
      return vscode.DiagnosticSeverity.Warning;
  }
}

const diagnosticsContext: { context?: vscode.ExtensionContext } = {};

export function setDiagnosticsContext(context: vscode.ExtensionContext): void {
  diagnosticsContext.context = context;
}

export function refreshDiagnostics(
  document: vscode.TextDocument,
  diagnosticCollection: vscode.DiagnosticCollection
): void {
  if (diagnosticsContext.context === undefined) return;

  const lang = document.languageId;
  if (lang !== "lua" && lang !== "luau") return;

  const rules = loadRules(diagnosticsContext.context);
  if (rules.length === 0) {
    diagnosticCollection.set(document.uri, []);
    return;
  }

  const text = document.getText();
  const diagnostics: vscode.Diagnostic[] = [];

  const matchers = rules
    .map((r) => ({ rule: r, re: buildMatcher(r) }))
    .filter((m): m is { rule: ModernRule; re: RegExp } => m.re !== null);

  const lineOffsets: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) lineOffsets.push(i + 1);
  }

  for (const { rule, re } of matchers) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const startOffset = match.index;
      const matchedText = match[0];
      const endOffset = startOffset + matchedText.length;

      let startLine = 0;
      for (let i = 0; i < lineOffsets.length; i++) {
        if (lineOffsets[i] > startOffset) break;
        startLine = i;
      }
      let endLine = startLine;
      for (let i = startLine; i < lineOffsets.length; i++) {
        if (lineOffsets[i] > endOffset) break;
        endLine = i;
      }

      const startChar = startOffset - lineOffsets[startLine];
      const endChar = endOffset - lineOffsets[endLine];

      const range = new vscode.Range(
        startLine,
        startChar,
        endLine,
        endChar
      );

      const diagnostic = new vscode.Diagnostic(
        range,
        JARVIS_PREFIX + rule.pattern,
        severityOf(rule)
      ) as JarvisDiagnostic;
      diagnostic.code = rule.replacement;
      diagnostic.source = "roblox-modern-rules";
      diagnostic.jarvisRule = rule;
      diagnostics.push(diagnostic);

      if (re.lastIndex === startOffset) re.lastIndex++;
    }
  }

  diagnosticCollection.set(document.uri, diagnostics);
}

export function clearDiagnostics(
  document: vscode.TextDocument,
  diagnosticCollection: vscode.DiagnosticCollection
): void {
  diagnosticCollection.delete(document.uri);
}
