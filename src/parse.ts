import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

/** A message gap longer than this means you walked away, so the time doesn't count. */
const IDLE_GAP_MS = 15 * 60 * 1000;

export type Stats = {
  since: Date;
  until: Date;
  days: number;
  tokens: number;
  models: Record<string, number>;
  sessions: number;
  activeMs: number;
  activeDays: number;
  hourly: number[];
  weekdayMsgs: number;
  weekendMsgs: number;
  projects: string[];
  agentsTotal: number;
  agentTypes: Record<string, number>;
  avgAgents: number;
  titles: string[];
  /** Grouped so one busy project can't swamp the blurb's sense of what you do. */
  titlesByProject: Record<string, string[]>;
  prompts: string[];
};

/** One session's contribution, before it gets folded into the totals. */
type SessionScan = {
  /** Every message, used for elapsed-time maths. */
  timestamps: number[];
  /** Only what you typed, used for "when you code". */
  userTimestamps: number[];
  tokens: number;
  models: Record<string, number>;
  titles: string[];
  prompts: string[];
};

function emptyScan(): SessionScan {
  return { timestamps: [], userTimestamps: [], tokens: 0, models: {}, titles: [], prompts: [] };
}

async function listDir(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Read one .jsonl transcript line by line. These run to 14MB, and there are
 * ~11k of them, so nothing here may hold a whole file in memory.
 */
async function scanTranscript(
  path: string,
  since: number,
  into: SessionScan,
  seen: Set<string>,
): Promise<void> {
  const rl = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // a half-written last line is normal, skip it
    }

    // Session titles carry no timestamp, so they're handled before the window filter.
    if (entry.type === "ai-title" && typeof entry.aiTitle === "string") {
      into.titles.push(entry.aiTitle.trim());
      continue;
    }

    const ts = Date.parse(entry.timestamp ?? "");
    if (!Number.isFinite(ts) || ts < since) continue;

    if (entry.type === "assistant" || entry.type === "user") {
      into.timestamps.push(ts);
    }

    if (entry.type === "user" && typeof entry.message?.content === "string") {
      const text = entry.message.content.trim();
      // Slash commands and injected tool-result echoes aren't things you typed.
      if (text && !text.startsWith("<") && !text.startsWith("/")) {
        into.userTimestamps.push(ts);
        into.prompts.push(text);
      }
    }

    const usage = entry.message?.usage;
    if (entry.type === "assistant" && usage) {
      // Claude Code rewrites the same assistant turn into every session file that
      // resumes or forks from it. ccusage dedupes on request id; without this the
      // total comes out roughly double.
      const key = `${entry.message?.id ?? ""}:${entry.requestId ?? ""}`;
      if (key !== ":" && seen.has(key)) continue;
      if (key !== ":") seen.add(key);

      const model = entry.message.model ?? "unknown";
      if (model === "<synthetic>") continue; // local error placeholders, not real spend

      const n =
        (usage.input_tokens ?? 0) +
        (usage.output_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0);
      into.tokens += n;
      into.models[model] = (into.models[model] ?? 0) + n;
    }
  }
}

/** Sum the gaps between consecutive messages, ignoring the ones you spent away. */
function activeMsOf(timestamps: number[]): number {
  if (timestamps.length < 2) return 0;
  const sorted = [...timestamps].sort((a, b) => a - b);
  let total = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap <= IDLE_GAP_MS) total += gap;
  }
  return total;
}

export async function collect(windowDays = 30, root?: string): Promise<Stats> {
  const base = root ?? join(homedir(), ".claude", "projects");
  const until = new Date();
  const since = new Date(until.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const sinceMs = since.getTime();

  const tokensByModel: Record<string, number> = {};
  const agentTypes: Record<string, number> = {};
  const hourly = new Array(24).fill(0);
  const activeDays = new Set<string>();
  const projects = new Set<string>();
  const titles: string[] = [];
  const titlesByProject: Record<string, string[]> = {};
  const prompts: string[] = [];

  let tokens = 0;
  let sessions = 0;
  let activeMs = 0;
  let weekdayMsgs = 0;
  let weekendMsgs = 0;
  let agentsTotal = 0;
  let agentsPerSessionSum = 0;

  /** Assistant turns already counted, so resumed sessions don't double-bill. */
  const seen = new Set<string>();

  for (const projectDir of await listDir(base)) {
    const projectPath = join(base, projectDir);
    if (!(await isDir(projectPath))) continue;

    for (const entry of await listDir(projectPath)) {
      if (!entry.endsWith(".jsonl")) continue;

      const sessionId = entry.slice(0, -".jsonl".length);
      const scan = emptyScan();
      await scanTranscript(join(projectPath, entry), sinceMs, scan, seen);

      // Subagent transcripts live beside the session, one file per agent.
      const subagentDir = join(projectPath, sessionId, "subagents");
      let agentsHere = 0;
      for (const file of await listDir(subagentDir)) {
        if (file.endsWith(".meta.json")) {
          try {
            // node:fs, not Bun.file — this ships to npx users running plain node.
            const meta = JSON.parse(await readFile(join(subagentDir, file), "utf8"));
            const type = meta.agentType ?? "unknown";
            agentTypes[type] = (agentTypes[type] ?? 0) + 1;
          } catch {
            // a meta file we can't read still counted as an agent below
          }
          continue;
        }
        if (!file.endsWith(".jsonl")) continue;
        agentsHere++;
        // Subagent tokens are real spend, so they belong in the total.
        await scanTranscript(join(subagentDir, file), sinceMs, scan, seen);
      }

      if (scan.timestamps.length === 0) continue; // nothing inside the window

      sessions++;
      agentsTotal += agentsHere;
      agentsPerSessionSum += 1 + agentsHere;
      tokens += scan.tokens;
      activeMs += activeMsOf(scan.timestamps);
      projects.add(projectDir);
      titles.push(...scan.titles);
      if (scan.titles.length > 0) {
        (titlesByProject[projectDir] ??= []).push(...scan.titles);
      }
      prompts.push(...scan.prompts);

      for (const [model, n] of Object.entries(scan.models)) {
        tokensByModel[model] = (tokensByModel[model] ?? 0) + n;
      }

      // "When you code" means when you typed, not when Claude replied.
      for (const ts of scan.userTimestamps) {
        const d = new Date(ts);
        hourly[d.getHours()]++;
        activeDays.add(d.toDateString());
        const day = d.getDay();
        if (day === 0 || day === 6) weekendMsgs++;
        else weekdayMsgs++;
      }
    }
  }

  return {
    since,
    until,
    days: windowDays,
    tokens,
    models: tokensByModel,
    sessions,
    activeMs,
    activeDays: activeDays.size,
    hourly,
    weekdayMsgs,
    weekendMsgs,
    projects: [...projects],
    agentsTotal,
    agentTypes,
    avgAgents: sessions === 0 ? 0 : agentsPerSessionSum / sessions,
    titles,
    titlesByProject,
    prompts,
  };
}

export function peakHour(hourly: number[]): number {
  let best = 0;
  for (let h = 1; h < 24; h++) if (hourly[h] > hourly[best]) best = h;
  return best;
}
