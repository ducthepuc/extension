interface ApiMember {
  Name: string;
  Tags?: string[];
  MemberType?: string;
  ValueType?: { Name?: string; Category?: string };
  Description?: string;
}

interface ApiClass {
  Name: string;
  Tags?: string[];
  Members?: ApiMember[];
  Description?: string;
}

interface ApiDump {
  Classes: ApiClass[];
}

interface ModernRule {
  pattern: string;
  replacement: string;
  explanation: string;
  severity: "warning" | "error" | "info";
}

interface DevForumTopic {
  id: number;
  title: string;
  slug: string;
  excerpt?: string;
  created_at?: string;
}

const API_DUMP_URL =
  "https://raw.githubusercontent.com/MaximumADHD/Roblox-Client-Tracker/roblox/API-Dump.json";
const DEVFORUM_BASE = "https://devforum.roblox.com";

async function fetchApiDump(): Promise<ApiDump> {
  console.log(`[scrape] Fetching API dump from ${API_DUMP_URL}`);
  const res = await fetch(API_DUMP_URL, {
    headers: { "User-Agent": "extension-scraper/1.0" },
  });
  if (!res.ok) throw new Error(`Failed to fetch API dump: ${res.status}`);
  return (await res.json()) as ApiDump;
}

async function fetchDevForumTopics(): Promise<DevForumTopic[]> {
  console.log(`[scrape] Fetching devforum announcements`);
  const url = `${DEVFORUM_BASE}/c/updates/announcements/36.json`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "extension-scraper/1.0",
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      console.warn(`[scrape] Devforum responded ${res.status}; continuing without context`);
      return [];
    }
    const data = (await res.json()) as { topic_list?: { topics?: DevForumTopic[] } };
    return data.topic_list?.topics ?? [];
  } catch (err) {
    console.warn(`[scrape] Devforum fetch failed: ${(err as Error).message}`);
    return [];
  }
}

function isDeprecated(tags?: string[]): boolean {
  if (!tags) return false;
  return tags.some((t) => /deprecat/i.test(t) || /outdated|legacy|removed/i.test(t));
}

function modernReplacement(memberName: string): string {
  const replacements: Record<string, string> = {
    WaitForChild: "WaitForChild (use overload with timeout argument)",
    FindFirstChild: "FindFirstChild (use overload specifying class)",
    Instance: "GetChildren() or GetDescendants() iteration",
    BrickColor: "Color3",
    Vector3_Value: "Vector3 directly (not ValueBase wrapper)",
    BodyPosition: "AlignPosition + Attachment",
    BodyGyro: "AlignOrientation + Attachment",
    BodyVelocity: "LinearVelocity + Attachment",
    BodyAngularVelocity: "AngularVelocity + Attachment",
    RocketPropellant: "LinearVelocity",
    BodyThrust: "VectorForce + Attachment",
    BodyForce: "VectorForce + Attachment",
    BodyFrame: "AlignOrientation",
    ForceField: "MagnetismService / custom CollisionGroups",
    MessageDialog: "AdorneeGui prompts via PromptService",
    Dialog: "PromptPurchase flow",
    RemoveLoadingElement: "GuiService:RemoveLoadingScreen",
    Load: "ContentProvider:PreloadAsync",
    LoadAsset: "AssetService / ContentProvider:PreloadAsync",
    JointInstance: "Constraint",
    Workspace_JoinToOutsiders: "deprecated",
  };
  return replacements[memberName] ?? `modern replacement for ${memberName}`;
}

function explanationFor(member: ApiMember, topicMap: Map<string, DevForumTopic>): string {
  const base = `Heads up — "${member.Name}" is flagged as deprecated in the Roblox engine.`;
  const perf =
    " The modern alternative is faster, has fewer edge-case bugs, and avoids future runtime warnings that could clutter your console.";
  const tagHint = member.Tags?.find((t) => /deprecat/i.test(t));
  const tagSuffix = tagHint ? ` (engine tag: ${tagHint})` : "";

  let forumHint = "";
  for (const topic of topicMap.values()) {
    if (
      topic.title &&
      member.Name &&
      topic.title.toLowerCase().includes(member.Name.toLowerCase().split("_")[0])
    ) {
      forumHint = ` Recent context: "${topic.title}" — see ${DEVFORUM_BASE}/t/${topic.slug}/${topic.id}.`;
      break;
    }
  }
  return `${base}${perf}${tagSuffix}${forumHint}`;
}

function buildRules(dump: ApiDump, topics: DevForumTopic[]): ModernRule[] {
  const rules: ModernRule[] = [];
  const seen = new Set<string>();
  const topicMap = new Map(topics.map((t) => [String(t.id), t]));

  for (const cls of dump.Classes ?? []) {
    const classDeprecated = isDeprecated(cls.Tags);

    if (classDeprecated) {
      const key = `Object.${cls.Name}`;
      if (!seen.has(key)) {
        seen.add(key);
        rules.push({
          pattern: `Object.${cls.Name}`,
          replacement: "LOOKUP_REPLACEMENT",
          explanation: `Heads up — "${cls.Name}" is flagged as deprecated in the Roblox engine. (engine tag: Deprecated)`,
          severity: "warning",
        });
      }
    }

    for (const member of cls.Members ?? []) {
      if (!member.Name) continue;
      const key = `Object.${member.Name}`;
      if (seen.has(key)) continue;

      const memberDeprecated = isDeprecated(member.Tags);
      if (!memberDeprecated) continue;

      seen.add(key);
      rules.push({
        pattern: `Object.${member.Name}`,
        replacement: "LOOKUP_REPLACEMENT",
        explanation: `Heads up — "${member.Name}" is flagged as deprecated in the Roblox engine. (engine tag: Deprecated)`,
        severity: "warning",
      });
    }
  }

  console.log(`[scrape] Compiled ${rules.length} deprecated rules`);
  return rules;
}

function buildValidApiMap(dump: ApiDump): Record<string, string> {
  const map: Record<string, string> = {};

  for (const cls of dump.Classes ?? []) {
    if (cls.Name && !isDeprecated(cls.Tags)) {
      const lower = cls.Name.toLowerCase();
      if (!(lower in map)) map[lower] = cls.Name;
    }

    for (const member of cls.Members ?? []) {
      if (!member.Name) continue;
      if (isDeprecated(member.Tags)) continue;
      const lower = member.Name.toLowerCase();
      if (!(lower in map)) map[lower] = member.Name;
    }
  }

  console.log(`[scrape] Compiled ${Object.keys(map).length} valid API entries`);
  return map;
}

async function writeOutputs(
  rules: ModernRule[],
  validApiMap: Record<string, string>
): Promise<void> {
  await Bun.write("dist/modern_rules.json", JSON.stringify({ rules }));
  console.log(`[scrape] Wrote dist/modern_rules.json`);

  await Bun.write("dist/valid_api_map.json", JSON.stringify(validApiMap));
  console.log(`[scrape] Wrote dist/valid_api_map.json`);
}

async function main(): Promise<void> {
  const [dump, topics] = await Promise.all([fetchApiDump(), fetchDevForumTopics()]);
  const rules = buildRules(dump, topics);
  const validApiMap = buildValidApiMap(dump);
  await writeOutputs(rules, validApiMap);
}

main().catch((err) => {
  console.error("[scrape] Fatal:", err);
  process.exit(1);
});
