# Builder — Roblox Deprecation Assistant

VS Code extension that scans your Luau code for deprecated Roblox engine APIs and suggests modern replacements.

## Features

- **Real-time diagnostics** — squiggly underlines on deprecated property accesses and method calls
- **Hover cards** — hover over any flagged code to see why it's deprecated and the modern alternative
- **Quick-fix lightbulb** — one click to modernize deprecated code with indentation preserved
- **APIpedia sidebar** — searchable webview listing all detected deprecated APIs with their modern replacements
- **Background sync** — automatically fetches the latest rules from GitHub Releases, with offline fallback

## How It Works

1. The extension activates when you open a Roblox workspace (detects `default.project.json`, `rojo.json`, or Lua/Luau files)
2. Background sync fetches the latest `modern_rules.json` and `valid_api_map.json` from GitHub Releases
3. A 3‑tier lookup engine resolves replacements: manual overrides → valid API map → rule built‑ins
4. Diagnostics run in‑editor with a **400ms debounce** to prevent typing lag

## Project Structure

```
.github/workflows/scrape_rules.yml   # Weekly cron + manual CI scraper
scripts/compile-rules.ts             # Bun script that fetches API-Dump.json, builds rules & api map
src/
  extension.ts                       # Entry point
  engine.ts                          # Diagnostic engine + 400ms debounce
  syncManager.ts                     # Background cache sync from GitHub Releases
  diagnostics.ts                     # Regex scanner for deprecated API detection
  uiProviders.ts                     # Hover cards + quick-fix lightbulb
  ApipediaProvider.ts                # Webview sidebar provider
  ruleStore.ts                       # Shared cache loaders + 3‑tier lookup resolver
  manual_overrides.json              # Manual structural override mappings
fallback/
  modern_rules.json                  # Bundled offline deprecation rules
  valid_api_map.json                 # Bundled offline API case map
media/
  apipedia-icon.svg                  # Activity bar icon
```

## Scripts

| Command | Description |
|---------|-------------|
| `bun run build` | Compile extension to `out/extension.js` |
| `bun run watch` | Watch and rebuild on changes |
| `bun run lint` | Type‑check with `tsc --noEmit` |
| `bun run scrape` | Run the scraper locally (fetches API‑Dump.json, outputs to `dist/`) |

## Storage Keys

The extension uses `context.globalState` to cache:

| Key | Content |
|-----|---------|
| `modern_rules_cache` | `{ rules: ModernRule[] }` — deprecated API patterns |
| `valid_api_map_cache` | `{ [lowercase]: "ProperCase" }` — non‑deprecated property map |

## License

MIT
