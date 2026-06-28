import * as vscode from "vscode";
import { RULES_STORAGE_KEY, API_MAP_STORAGE_KEY } from "./ruleStore";

interface ModernRule {
  pattern: string;
  replacement: string;
  explanation: string;
  severity: "warning" | "error" | "info";
}

interface RulesPayload {
  rules: ModernRule[];
}

const STORAGE_KEY = RULES_STORAGE_KEY;
const API_MAP_KEY = API_MAP_STORAGE_KEY;
const FALLBACK_RULES_URL =
  "https://github.com/ducthepuc/extension/releases/download/rules-latest/modern_rules.json";
const FALLBACK_API_MAP_URL =
  "https://github.com/ducthepuc/extension/releases/download/rules-latest/valid_api_map.json";
const RAW_RULES_URL =
  "https://raw.githubusercontent.com/ducthepuc/extension/main/fallback/modern_rules.json";
const RAW_API_MAP_URL =
  "https://raw.githubusercontent.com/ducthepuc/extension/main/fallback/valid_api_map.json";

async function isRobloxWorkspace(): Promise<boolean> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    console.log("[syncManager] No workspace folders open — skipping");
    return false;
  }
  console.log(`[syncManager] Scanning ${folders.length} workspace folder(s) for Roblox markers`);
  const patterns = ["*.project.json", "*.rojo", "default.project.json", "rojo.json"];
  for (const folder of folders) {
    for (const pat of patterns) {
      const pattern = new vscode.RelativePattern(folder, pat);
      const results = await vscode.workspace.findFiles(pattern, undefined, 1);
      if (results.length > 0) {
        console.log(`[syncManager] Found marker "${pat}" in "${folder.name}" — Roblox workspace confirmed`);
        return true;
      }
    }
  }
  console.log("[syncManager] No Roblox project markers found — skipping");
  return false;
}

async function fetchRemoteJson(
  url: string,
  token: vscode.CancellationToken
): Promise<unknown | null> {
  const controller = new AbortController();
  token.onCancellationRequested(() => controller.abort());
  try {
    console.log(`[syncManager] Fetching remote: ${url}`);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "roblox-builder-rules-extension/1.0" },
    });
    if (!res.ok) {
      console.warn(`[syncManager] Remote returned ${res.status} for ${url}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error(`[syncManager] Network error fetching ${url}: ${(err as Error).message}`);
    return null;
  }
}

function fetchRemoteRules(
  url: string,
  token: vscode.CancellationToken
): Promise<RulesPayload | null> {
  return fetchRemoteJson(url, token) as Promise<RulesPayload | null>;
}

function fetchRemoteApiMap(
  url: string,
  token: vscode.CancellationToken
): Promise<Record<string, string> | null> {
  return fetchRemoteJson(url, token) as Promise<Record<string, string> | null>;
}

async function loadBundledFallback(
  context: vscode.ExtensionContext,
  filename: string
): Promise<string> {
  console.log(`[syncManager] Loading bundled fallback: fallback/${filename}`);
  const uri = vscode.Uri.joinPath(context.extensionUri, "fallback", filename);
  const bytes = await vscode.workspace.fs.readFile(uri);
  return new TextDecoder().decode(bytes);
}

async function loadBundledRules(
  context: vscode.ExtensionContext
): Promise<RulesPayload> {
  const raw = await loadBundledFallback(context, "modern_rules.json");
  const payload = JSON.parse(raw) as RulesPayload;
  console.log(`[syncManager] Fallback loaded: ${payload.rules.length} rules`);
  return payload;
}

async function loadBundledApiMap(
  context: vscode.ExtensionContext
): Promise<Record<string, string>> {
  try {
    const raw = await loadBundledFallback(context, "valid_api_map.json");
    const parsed = JSON.parse(raw);
    console.log(`[syncManager] Fallback API map loaded: ${Object.keys(parsed).length} entries`);
    return parsed as Record<string, string>;
  } catch (err) {
    console.warn("[syncManager] No bundled API map fallback — skipping");
    return {};
  }
}

function rulesChanged(
  cached: RulesPayload | null,
  fetched: RulesPayload
): boolean {
  if (!cached) {
    console.log("[syncManager] No cached rules — update needed");
    return true;
  }
  if (cached.rules.length !== fetched.rules.length) {
    console.log(`[syncManager] Rule count changed: ${cached.rules.length} → ${fetched.rules.length}`);
    return true;
  }
  for (let i = 0; i < cached.rules.length; i++) {
    const a = cached.rules[i];
    const b = fetched.rules[i];
    if (
      a.pattern !== b.pattern ||
      a.replacement !== b.replacement ||
      a.severity !== b.severity
    ) {
      console.log(`[syncManager] Rule ${i} changed: "${a.pattern}"`);
      return true;
    }
  }
  console.log("[syncManager] Remote rules unchanged from cache");
  return false;
}

export function getCachedRules(
  state: vscode.Memento
): string | undefined {
  return state.get<string>(STORAGE_KEY);
}

export function parseCachedPayload(raw: string | undefined): RulesPayload | null {
  if (!raw) {
    console.log("[syncManager] No cached payload found");
    return null;
  }
  try {
    return JSON.parse(raw) as RulesPayload;
  } catch (err) {
    console.error("[syncManager] Failed to parse cached payload:", (err as Error).message);
    return null;
  }
}

async function syncRules(
  context: vscode.ExtensionContext,
  token: vscode.CancellationToken
): Promise<void> {
  console.log("[syncManager] Sync started");
  const cachedRaw = context.globalState.get<string>(STORAGE_KEY);
  const cached = parseCachedPayload(cachedRaw);

  console.log("[syncManager] Attempting release asset download (rules)");
  const fetchedRules =
    (await fetchRemoteRules(FALLBACK_RULES_URL, token)) ??
    (await fetchRemoteRules(RAW_RULES_URL, token));

  if (fetchedRules) {
    if (rulesChanged(cached, fetchedRules)) {
      await context.globalState.update(STORAGE_KEY, JSON.stringify(fetchedRules));
      console.log("[syncManager] Rules cache updated successfully");
    }
  } else {
    console.log("[syncManager] Rules sources failed — keeping existing rules cache");
  }

  console.log("[syncManager] Attempting release asset download (api map)");
  const cachedMapRaw = context.globalState.get<string>(API_MAP_KEY);
  const fetchedMap =
    (await fetchRemoteApiMap(FALLBACK_API_MAP_URL, token)) ??
    (await fetchRemoteApiMap(RAW_API_MAP_URL, token));

  if (fetchedMap) {
    const changed = cachedMapRaw !== JSON.stringify(fetchedMap);
    if (changed) {
      await context.globalState.update(API_MAP_KEY, JSON.stringify(fetchedMap));
      console.log("[syncManager] API map cache updated successfully");
    }
  } else {
    console.log("[syncManager] API map sources failed — keeping existing map cache");
  }
}

export async function activateSyncManager(context: vscode.ExtensionContext): Promise<void> {
  console.log("[syncManager] Activation started");

  const isRoblox = await isRobloxWorkspace();
  if (!isRoblox) {
    console.log("[syncManager] Activation skipped — not a Roblox workspace");
    return;
  }

  console.log("[syncManager] Registering sync command");
  const disposable = vscode.commands.registerCommand(
    "roblox-builder-rules.syncRules",
    () => syncRules(context, new vscode.CancellationTokenSource().token)
  );
  context.subscriptions.push(disposable);

  const cts = new vscode.CancellationTokenSource();
  context.subscriptions.push(cts);

  console.log("[syncManager] Starting background sync");
  syncRules(context, cts.token).then(async () => {
    const raw = context.globalState.get<string>(STORAGE_KEY);
    const parsed = parseCachedPayload(raw);
    if (!parsed) {
      console.log("[syncManager] Cache empty after sync — loading bundled fallback");
      try {
        const fallback = await loadBundledRules(context);
        await context.globalState.update(STORAGE_KEY, JSON.stringify(fallback));
        console.log("[syncManager] Bundled fallback persisted to globalState");
      } catch (err) {
        console.error("[syncManager] Failed to load rules fallback:", (err as Error).message);
      }
    } else {
      console.log(`[syncManager] Cache ready: ${parsed.rules.length} rules available`);
    }

    const mapRaw = context.globalState.get<string>(API_MAP_KEY);
    if (!mapRaw) {
      console.log("[syncManager] API map empty — loading bundled fallback");
      try {
        const fallbackMap = await loadBundledApiMap(context);
        if (Object.keys(fallbackMap).length > 0) {
          await context.globalState.update(API_MAP_KEY, JSON.stringify(fallbackMap));
          console.log("[syncManager] Bundled API map persisted to globalState");
        }
      } catch (err) {
        console.error("[syncManager] Failed to load API map fallback:", (err as Error).message);
      }
    }
  });
}

export function getFallbackRules(
  context: vscode.ExtensionContext
): Thenable<RulesPayload> {
  return loadBundledRules(context);
}
