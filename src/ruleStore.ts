import * as vscode from "vscode";
import manualOverrides from "./manual_overrides.json" assert { type: "json" };

export interface ModernRule {
  pattern: string;
  replacement: string;
  explanation: string;
  severity: "warning" | "error" | "info";
}

export interface RulesPayload {
  rules: ModernRule[];
}

export const RULES_STORAGE_KEY = "modern_rules_cache";
export const API_MAP_STORAGE_KEY = "valid_api_map_cache";

const MANUAL_OVERRIDES: Record<string, string> =
  manualOverrides as Record<string, string>;

export function getManualOverrides(): Record<string, string> {
  return MANUAL_OVERRIDES;
}

export function loadCachedRules(context: vscode.ExtensionContext): RulesPayload | null {
  const raw = context.globalState.get<string>(RULES_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RulesPayload;
  } catch {
    return null;
  }
}

export function loadCachedApiMap(
  context: vscode.ExtensionContext
): Record<string, string> {
  const raw = context.globalState.get<string>(API_MAP_STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function loadBundledFallback(
  context: vscode.ExtensionContext,
  filename: string
): Promise<string | null> {
  try {
    const uri = vscode.Uri.joinPath(context.extensionUri, "fallback", filename);
    const bytes = await vscode.workspace.fs.readFile(uri);
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export function extractMemberName(pattern: string): string {
  if (pattern.startsWith("Object.")) return pattern.slice(7);
  if (pattern.startsWith(":")) return pattern.slice(1);
  return pattern;
}

export interface ResolvedReplacement {
  value: string;
  isIdentity: boolean;
}

export function resolveReplacement(
  rule: ModernRule,
  apiMap: Record<string, string>
): ResolvedReplacement {
  const memberName = extractMemberName(rule.pattern);
  const lowerKey = memberName.toLowerCase();

  if (lowerKey in MANUAL_OVERRIDES) {
    return { value: MANUAL_OVERRIDES[lowerKey], isIdentity: false };
  }

  if (lowerKey in apiMap) {
    const mapped = apiMap[lowerKey];
    const isIdentity = mapped === memberName;
    return { value: mapped, isIdentity };
  }

  if (rule.replacement && rule.replacement !== "LOOKUP_REPLACEMENT") {
    return { value: rule.replacement, isIdentity: false };
  }

  return { value: "—", isIdentity: true };
}
