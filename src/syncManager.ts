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

const STORAGE_KEY = "modern_rules_cache";
const FALLBACK_RULES_URL =
  "https://github.com/ducthepuc/extension/releases/download/rules-latest/modern_rules.json";
const RAW_DOWNLOAD_URL =
  "https://raw.githubusercontent.com/ducthepuc/extension/main/fallback/modern_rules.json";

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

async function fetchRemoteRules(
  url: string,
  token: vscode.CancellationToken
): Promise<RulesPayload | null> {
  const controller = new AbortController();
  token.onCancellationRequested(() => controller.abort());
  try {
    console.log(`[syncManager] Fetching remote rules: ${url}`);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "roblox-modern-rules-extension/1.0" },
    });
    if (!res.ok) {
      console.warn(`[syncManager] Remote returned ${res.status} for ${url}`);
      return null;
    }
    const payload = (await res.json()) as RulesPayload;
    console.log(`[syncManager] Fetched ${payload.rules?.length ?? 0} rules from ${url}`);
    return payload;
  } catch (err) {
    console.error(`[syncManager] Network error fetching ${url}: ${(err as Error).message}`);
    return null;
  }
}

async function loadBundledFallback(
  context: vscode.ExtensionContext
): Promise<RulesPayload> {
  console.log("[syncManager] Loading bundled fallback rules from extension assets");
  const uri = vscode.Uri.joinPath(context.extensionUri, "fallback", "modern_rules.json");
  const bytes = await vscode.workspace.fs.readFile(uri);
  const payload = JSON.parse(new TextDecoder().decode(bytes)) as RulesPayload;
  console.log(`[syncManager] Fallback loaded: ${payload.rules.length} rules`);
  return payload;
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

  console.log("[syncManager] Attempting release asset download");
  const fetched =
    (await fetchRemoteRules(FALLBACK_RULES_URL, token)) ??
    (await fetchRemoteRules(RAW_DOWNLOAD_URL, token));

  if (!fetched) {
    console.log("[syncManager] All remote sources failed — keeping existing cache");
    return;
  }

  if (rulesChanged(cached, fetched)) {
    await context.globalState.update(STORAGE_KEY, JSON.stringify(fetched));
    console.log("[syncManager] Rules cache updated successfully");
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
    "roblox-modern-rules.syncRules",
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
        const fallback = await loadBundledFallback(context);
        await context.globalState.update(STORAGE_KEY, JSON.stringify(fallback));
        console.log("[syncManager] Bundled fallback persisted to globalState");
      } catch (err) {
        console.error("[syncManager] Failed to load fallback:", (err as Error).message);
      }
    } else {
      console.log(`[syncManager] Cache ready: ${parsed.rules.length} rules available`);
    }
  });
}

export function getFallbackRules(
  context: vscode.ExtensionContext
): Thenable<RulesPayload> {
  return loadBundledFallback(context);
}
