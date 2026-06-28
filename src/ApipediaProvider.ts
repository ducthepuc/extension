import * as vscode from "vscode";
import {
  loadCachedRules,
  loadCachedApiMap,
  loadBundledFallback,
  resolveReplacement,
  extractMemberName,
  type ModernRule,
} from "./ruleStore";

interface RulesPayload {
  rules: ModernRule[];
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildHtml(rules: ModernRule[], apiMap: Record<string, string>): string {
  const cards = rules.map((rule, i) => {
    const resolved = resolveReplacement(rule, apiMap);
    const pattern = escapeHtml(rule.pattern);
    const explanation = escapeHtml(rule.explanation);
    const searchText = (
      rule.pattern + " " + resolved.value + " " + rule.explanation
    ).toLowerCase();

    let flowHtml: string;
    if (resolved.isIdentity) {
      flowHtml = `
          <code class="old">${pattern}</code>
          <span class="badge">⚠️ Legacy System Warning</span>`;
    } else {
      const repl = escapeHtml(resolved.value);
      flowHtml = `
          <code class="old">${pattern}</code>
          <span class="arrow">➔</span>
          <code class="new">${repl}</code>`;
    }

    return `
      <div class="card${resolved.isIdentity ? " card-legacy" : ""}" data-index="${i}" data-text="${escapeHtml(searchText)}">
        <div class="card-flow">${flowHtml}
        </div>
        <p class="explanation">${explanation}</p>
      </div>`;
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body {
      margin: 0;
      padding: 12px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
    }
    .search-wrap {
      position: sticky;
      top: 0;
      z-index: 10;
      padding-bottom: 10px;
      background: var(--vscode-sideBar-background);
    }
    #search {
      width: 100%;
      box-sizing: border-box;
      padding: 8px 10px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 4px;
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-font-size);
      outline: none;
    }
    #search:focus {
      border-color: var(--vscode-focusBorder);
    }
    #search::placeholder {
      color: var(--vscode-input-placeholderForeground);
    }
    .status {
      margin: 8px 2px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }
    .card {
      border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.25));
      border-left: 3px solid var(--vscode-textLink-foreground);
      border-radius: 5px;
      padding: 10px 12px;
      margin-bottom: 10px;
      background: var(--vscode-editor-background);
    }
    .card-flow {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 8px;
    }
    code {
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      padding: 2px 6px;
      border-radius: 3px;
    }
    code.old {
      color: var(--vscode-errorForeground, #f48771);
      background: var(--vscode-textBlockQuote-background, rgba(255,255,255,0.04));
    }
    code.new {
      color: var(--vscode-textLink-foreground);
      background: var(--vscode-textBlockQuote-background, rgba(255,255,255,0.04));
    }
    .arrow {
      color: var(--vscode-textLink-foreground);
      font-weight: bold;
    }
    .card-legacy {
      border-left-color: var(--vscode-editorWarning-foreground, #cca700);
    }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 11px;
      font-weight: 600;
      color: var(--vscode-editorWarning-foreground, #cca700);
      background: var(--vscode-textBlockQuote-background, rgba(255,255,255,0.04));
      border: 1px solid var(--vscode-editorWarning-foreground, #cca700);
    }
    .explanation {
      margin: 0;
      color: var(--vscode-descriptionForeground);
      line-height: 1.45;
      font-size: 12px;
    }
    .empty {
      padding: 24px 8px;
      text-align: center;
      color: var(--vscode-descriptionForeground);
    }
  </style>
</head>
<body>
  <div class="search-wrap">
    <input id="search" type="text" placeholder="🔍 Search deprecated APIs, replacements, explanations..." autocomplete="off" autofocus />
    <div id="status" class="status">${rules.length} rules loaded</div>
  </div>
  <div id="cards">${cards.join("")}</div>
  <div id="empty" class="empty" style="display:none">No matching rules found.</div>

  <script>
    (function () {
      const vscode = acquireVsCodeApi();
      const input = document.getElementById('search');
      const status = document.getElementById('status');
      const cards = Array.from(document.querySelectorAll('.card'));
      const emptyEl = document.getElementById('empty');
      const total = cards.length;

      input.addEventListener('input', function () {
        const q = input.value.trim().toLowerCase();
        let visible = 0;
        for (const card of cards) {
          const text = card.getAttribute('data-text') || '';
          const show = q === '' || text.indexOf(q) !== -1;
          card.style.display = show ? '' : 'none';
          if (show) visible++;
        }
        emptyEl.style.display = visible === 0 ? '' : 'none';
        status.textContent = q === ''
          ? total + ' rules loaded'
          : visible + ' / ' + total + ' matching';
      });
    })();
  </script>
</body>
</html>`;
}

export class BuilderApipediaProvider implements vscode.WebviewViewProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): Promise<void> {
    console.log("[apipedia] resolveWebviewView");

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "fallback"),
      ],
    };

    let rules: ModernRule[] = [];
    let apiMap: Record<string, string> = {};

    const cachedRules = loadCachedRules(this.context);
    if (cachedRules) {
      rules = cachedRules.rules;
      console.log(`[apipedia] Loaded ${rules.length} cached rules from globalState`);
    } else {
      try {
        const raw = await loadBundledFallback(this.context, "modern_rules.json");
        if (raw) {
          const parsed = JSON.parse(raw) as RulesPayload;
          rules = parsed.rules ?? [];
          console.log(`[apipedia] Loaded ${rules.length} bundled fallback rules`);
        }
      } catch (err) {
        console.error("[apipedia] Failed to load bundled rules:", (err as Error).message);
      }
    }

    apiMap = loadCachedApiMap(this.context);
    if (Object.keys(apiMap).length === 0) {
      try {
        const raw = await loadBundledFallback(this.context, "valid_api_map.json");
        if (raw) apiMap = JSON.parse(raw);
        console.log(`[apipedia] Loaded ${Object.keys(apiMap).length} bundled API map entries`);
      } catch (err) {
        console.error("[apipedia] Failed to load bundled API map:", (err as Error).message);
      }
    }

    webviewView.webview.html = buildHtml(rules, apiMap);
  }
}
