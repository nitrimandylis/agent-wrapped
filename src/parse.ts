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
  /** Every transcript file with activity in the window. interactive + headless. */
  sessions: number;
  /** Sessions you actually sat in. See isInteractive. */
  interactive: number;
  /** One-shot `claude -p` invocations: hooks, scripts, other tools calling Claude. */
  headless: number;
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
  /** Specific, funny, and true. The quips and the blurb both read from here. */
  mined: Mined;
};

/**
 * Facts too specific for the score but exactly what makes a card memorable.
 * Everything here is a count or a single common word: never a phrase, so none
 * of it can reproduce something you typed.
 */
export type Mined = {
  afterMidnight: number;
  busiestDay: { date: string; count: number };
  longestSessionMs: number;
  longestStreak: number;
  tools: Record<string, number>;
  bashVerbs: Record<string, number>;
  filesTouched: number;
  interruptions: number;
  pushback: Record<string, number>;
  longestPrompt: number;
  topWord: string;
  topWordCount: number;
};

/** Common enough to drown out anything interesting in the "most typed" count. */
const STOPWORDS = new Set([
  "that", "this", "with", "from", "have", "what", "when", "then", "they", "them",
  "your", "just", "like", "make", "want", "need", "does", "into", "also", "some",
  "only", "same", "than", "there", "these", "those", "would", "could", "should",
  "which", "where", "about", "after", "before", "being", "doesn", "didn", "don",
  "it's", "i'm", "that's", "you", "the", "and", "for", "are", "but", "not", "can",
  "its", "was", "one", "all", "now", "how", "why", "let", "get", "put", "use",
]);

/** Words that mean "that wasn't it". Counted, never quoted. */
const PUSHBACK = ["no", "wrong", "actually", "still", "sorry", "again"];

/**
 * Entry types written only when someone is driving: changing mode, answering a
 * permission prompt. `queue-operation` looks like a candidate and is not, it
 * appears in 96% of transcripts including headless ones.
 * ponytail: a one-turn interactive session where you never touched mode reads as
 * headless. Add a better signal if Claude Code ever writes one.
 */
const INTERACTIVE_TYPES = new Set(["mode", "permission-mode"]);

/** Past this, it was pasted, not typed, and its words are not your vocabulary. */
const TYPED_MAX_CHARS = 1000;

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
  /** Saw an entry type only a real session produces. */
  interactiveMarker: boolean;
  interruptions: number;
};

function emptyScan(): SessionScan {
  return {
    timestamps: [],
    userTimestamps: [],
    tokens: 0,
    models: {},
    titles: [],
    prompts: [],
    interactiveMarker: false,
    interruptions: 0,
  };
}

/**
 * Mined facts accumulate across every file at once, so unlike SessionScan they
 * live in one object for the whole run.
 */
type Miner = {
  tools: Record<string, number>;
  bashVerbs: Record<string, number>;
  files: Set<string>;
  interruptions: number;
  pushback: Record<string, number>;
  longestPrompt: number;
  words: Map<string, number>;
};

function emptyMiner(): Miner {
  return {
    tools: {},
    bashVerbs: {},
    files: new Set(),
    interruptions: 0,
    pushback: Object.fromEntries(PUSHBACK.map((w) => [w, 0])),
    longestPrompt: 0,
    words: new Map(),
  };
}

/**
 * A session counts as interactive if it carries a marker only a live session
 * produces, or if you typed more than once. Everything else is a headless
 * `claude -p`: a hook, a script, another tool calling Claude on your behalf.
 */
function isInteractive(scan: SessionScan): boolean {
  return scan.interactiveMarker || scan.prompts.length >= 2;
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
 * User content is usually a plain string, but a message sent with an attachment
 * arrives as blocks. Tool results arrive as blocks too and are not text you typed.
 */
function userText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b: any) => b && b.type === "text" && typeof b.text === "string")
    .map((b: any) => b.text)
    .join(" ");
}

/** One tokenisation pass feeds both the pushback counts and the top word. */
function minePrompt(text: string, mine: Miner): void {
  // Kept uncapped: the biggest thing you ever sent is a fact worth printing.
  if (text.length > mine.longestPrompt) mine.longestPrompt = text.length;

  // Word counts are capped, because a pasted stack trace would otherwise decide
  // that your most-used word is "type".
  if (text.length > TYPED_MAX_CHARS) return;

  const words = text.toLowerCase().match(/[a-z']+/g);
  if (!words) return;

  for (const word of words) {
    if (Object.hasOwn(mine.pushback, word)) mine.pushback[word]++;
    if (word.length >= 4 && !STOPWORDS.has(word)) {
      mine.words.set(word, (mine.words.get(word) ?? 0) + 1);
    }
  }
}

/**
 * The command name only, never an argument. Nearly every command starts by
 * changing directory, so `cd x && git status` has to report `git`, otherwise
 * the histogram just measures how often Claude moved around the filesystem.
 */
function bashVerb(command: string): string {
  for (const part of command.split(/&&|\|\||;|\|/)) {
    const word = part.trim().split(/\s+/)[0];
    if (!word || word === "cd" || word.includes("=")) continue; // env prefixes too
    // A venv interpreter is still python. Report the name, not the install path.
    return word.includes("/") ? (word.split("/").pop() ?? word) : word;
  }
  return "";
}

/** Tool calls live as blocks inside an assistant message's content array. */
function mineTools(content: unknown, mine: Miner): void {
  if (!Array.isArray(content)) return;

  for (const block of content as any[]) {
    if (!block || block.type !== "tool_use") continue;

    const name = typeof block.name === "string" ? block.name : "unknown";
    mine.tools[name] = (mine.tools[name] ?? 0) + 1;

    const input = block.input ?? {};
    if (typeof input.file_path === "string") mine.files.add(input.file_path);

    if (name === "Bash" && typeof input.command === "string") {
      const verb = bashVerb(input.command);
      if (verb) mine.bashVerbs[verb] = (mine.bashVerbs[verb] ?? 0) + 1;
    }
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
  mine: Miner,
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

    // These carry no timestamp either, and they are how a live session is told
    // apart from a headless one.
    if (INTERACTIVE_TYPES.has(entry.type)) {
      into.interactiveMarker = true;
      continue;
    }

    const ts = Date.parse(entry.timestamp ?? "");
    if (!Number.isFinite(ts) || ts < since) continue;

    if (entry.type === "assistant" || entry.type === "user") {
      into.timestamps.push(ts);
    }

    if (entry.type === "user") {
      const text = userText(entry.message?.content).trim();
      if (text.startsWith("[Request interrupted")) {
        into.interruptions++;
      } else if (text && !text.startsWith("<") && !text.startsWith("/")) {
        // Slash commands and injected tool-result echoes aren't things you typed.
        into.userTimestamps.push(ts);
        into.prompts.push(text);
      }
    }

    if (entry.type === "assistant") {
      // Claude Code rewrites the same assistant turn into every session file that
      // resumes or forks from it. ccusage dedupes on request id; without this the
      // totals come out roughly double. Tool counts double the same way, so the
      // check guards the whole entry, not just the token accounting.
      const key = `${entry.message?.id ?? ""}:${entry.requestId ?? ""}`;
      if (key !== ":" && seen.has(key)) continue;
      if (key !== ":") seen.add(key);

      const model = entry.message?.model ?? "unknown";
      if (model === "<synthetic>") continue; // local error placeholders, not real spend

      mineTools(entry.message?.content, mine);

      const usage = entry.message?.usage;
      if (usage) {
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
}

/** Sortable local day key, so consecutive days can be found by walking the list. */
function dayKey(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/** Longest run of consecutive calendar days you showed up. */
function longestStreakOf(dayKeys: string[]): number {
  if (dayKeys.length === 0) return 0;

  const sorted = [...dayKeys].sort();
  let longest = 1;
  let run = 1;

  for (let i = 1; i < sorted.length; i++) {
    const previous = new Date(`${sorted[i - 1]}T00:00:00`);
    previous.setDate(previous.getDate() + 1);
    if (dayKey(previous) === sorted[i]) run++;
    else run = 1;
    if (run > longest) longest = run;
  }
  return longest;
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
  const msgsByDay = new Map<string, number>();
  const mine = emptyMiner();

  let tokens = 0;
  let sessions = 0;
  let interactive = 0;
  let activeMs = 0;
  let longestSessionMs = 0;
  let afterMidnight = 0;
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
      await scanTranscript(join(projectPath, entry), sinceMs, scan, seen, mine);

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
        await scanTranscript(join(subagentDir, file), sinceMs, scan, seen, mine);
      }

      if (scan.timestamps.length === 0) continue; // nothing inside the window

      sessions++;

      // Vocabulary is only mined from sessions you sat in. A headless run's
      // prompts were written by whatever script called Claude, not by you, and
      // one chatty automation would otherwise decide what your top word is.
      if (isInteractive(scan)) {
        interactive++;
        mine.interruptions += scan.interruptions;
        for (const text of scan.prompts) minePrompt(text, mine);
        prompts.push(...scan.prompts);
      }

      agentsTotal += agentsHere;
      agentsPerSessionSum += 1 + agentsHere;
      tokens += scan.tokens;

      const sessionMs = activeMsOf(scan.timestamps);
      activeMs += sessionMs;
      if (sessionMs > longestSessionMs) longestSessionMs = sessionMs;

      projects.add(projectDir);
      titles.push(...scan.titles);
      if (scan.titles.length > 0) {
        (titlesByProject[projectDir] ??= []).push(...scan.titles);
      }

      for (const [model, n] of Object.entries(scan.models)) {
        tokensByModel[model] = (tokensByModel[model] ?? 0) + n;
      }

      // "When you code" means when you typed, not when Claude replied.
      for (const ts of scan.userTimestamps) {
        const d = new Date(ts);
        const hour = d.getHours();
        const key = dayKey(d);

        hourly[hour]++;
        activeDays.add(key);
        msgsByDay.set(key, (msgsByDay.get(key) ?? 0) + 1);
        if (hour < 5) afterMidnight++;

        const day = d.getDay();
        if (day === 0 || day === 6) weekendMsgs++;
        else weekdayMsgs++;
      }
    }
  }

  let busiestDay = { date: "", count: 0 };
  for (const [date, count] of msgsByDay) {
    if (count > busiestDay.count) busiestDay = { date, count };
  }

  let topWord = "";
  let topWordCount = 0;
  for (const [word, count] of mine.words) {
    if (count > topWordCount) {
      topWord = word;
      topWordCount = count;
    }
  }

  return {
    since,
    until,
    days: windowDays,
    tokens,
    models: tokensByModel,
    sessions,
    interactive,
    headless: sessions - interactive,
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
    mined: {
      afterMidnight,
      busiestDay,
      longestSessionMs,
      longestStreak: longestStreakOf([...activeDays]),
      tools: mine.tools,
      bashVerbs: mine.bashVerbs,
      filesTouched: mine.files.size,
      interruptions: mine.interruptions,
      pushback: mine.pushback,
      longestPrompt: mine.longestPrompt,
      topWord,
      topWordCount,
    },
  };
}

export function peakHour(hourly: number[]): number {
  let best = 0;
  for (let h = 1; h < 24; h++) if (hourly[h] > hourly[best]) best = h;
  return best;
}
