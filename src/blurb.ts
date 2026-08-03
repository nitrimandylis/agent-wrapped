import { spawn } from "node:child_process";
import type { Stats } from "./parse.ts";
import { peakHour } from "./parse.ts";
import type { Scored } from "./score.ts";

export type Blurb = { styleName: string; text: string; source: "claude" | "template" };

const STYLE_BY_ARCHETYPE: Record<string, string> = {
  ORCHESTRATOR: "Agent Wrangler",
  "HEAVY LIFTER": "High-Volume Operator",
  METRONOME: "Daily Driver",
  "DEEP DIVER": "Long-Session Specialist",
  POLYMATH: "Context Switcher",
};

/** Always available, needs nothing installed, and never says anything false. */
export function templated(stats: Stats, scored: Scored): Blurb {
  const peak = String(peakHour(stats.hourly)).padStart(2, "0");
  const weekdayPct = Math.round(
    (100 * stats.weekdayMsgs) / (stats.weekdayMsgs + stats.weekendMsgs || 1),
  );
  const when = weekdayPct >= 80 ? "on weeknights" : "across the whole week";
  return {
    styleName: STYLE_BY_ARCHETYPE[scored.archetype] ?? "Operator",
    text: `peaks at ${peak}:00 ${when}, across ${stats.projects.length} projects`,
    source: "template",
  };
}

/**
 * Titles are Claude's own session summaries, so they carry topic without carrying
 * your words. Sampled round-robin by project: one very busy repo would otherwise
 * fill the whole sample and the blurb would think it's all you do.
 */
function topicSample(titlesByProject: Record<string, string[]>, limit: number): string[] {
  const seen = new Set<string>();
  const queues = Object.values(titlesByProject).map((titles) =>
    titles.filter((t) => {
      const key = t.toLowerCase();
      if (!t || seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  );

  const out: string[] = [];
  for (let round = 0; out.length < limit; round++) {
    let placed = false;
    for (const queue of queues) {
      if (round >= queue.length) continue;
      out.push(queue[round]);
      placed = true;
      if (out.length >= limit) break;
    }
    if (!placed) break; // every project exhausted
  }
  return out;
}

function promptSample(prompts: string[], limit: number): string[] {
  const stride = Math.max(1, Math.floor(prompts.length / limit));
  return prompts
    .filter((p) => p.length > 25)
    .filter((_, i) => i % stride === 0)
    .slice(0, limit)
    .map((p) => p.slice(0, 2000));
}

function buildPrompt(stats: Stats, scored: Scored, deep: boolean): string {
  const peak = String(peakHour(stats.hourly)).padStart(2, "0");
  const parts = [
    "You are writing two lines for a shareable stats card about a developer's use of Claude Code.",
    "",
    "STATS",
    `- score ${scored.total}/100, strongest axis ${scored.axes.slice().sort((a, b) => b.points - a.points)[0].label}`,
    `- ${stats.sessions} sessions across ${stats.projects.length} projects in ${stats.days} days`,
    `- peak hour ${peak}:00, ${stats.activeDays}/${stats.days} active days`,
    `- ${stats.agentsTotal} subagents spawned`,
    "",
    "SESSION TITLES (Claude's own summaries of what was worked on)",
    ...topicSample(stats.titlesByProject, 60).map((t) => `- ${t}`),
  ];

  if (deep) {
    parts.push(
      "",
      "PROMPT SAMPLES (the developer's own words)",
      ...promptSample(stats.prompts, 50).map((p) => `- ${p.replace(/\s+/g, " ")}`),
    );
  }

  parts.push(
    "",
    "RULES",
    "- Never reproduce more than 3 consecutive words from any prompt sample. Project, repo and tool names are exempt.",
    "- This card gets posted publicly. Nothing private, personal, or identifying about anyone other than the developer.",
    "- Be specific and dry. Name real projects. No praise, no exclamation marks, no emoji.",
    "- Do not restate numbers already printed on the card: session count, day count, hours, tokens, peak hour.",
    "- Say what they actually work on, not how much. Two contrasting projects beats one.",
    "- BLURB must be under 110 characters and must be lowercase except for proper nouns.",
    "",
    "Reply with exactly two lines and nothing else:",
    "STYLE: <2-4 word title, Title Case>",
    "BLURB: <one line>",
  );

  return parts.join("\n");
}

/** Runs the user's own Claude Code. No API key, and no third party involved. */
export async function viaClaude(
  stats: Stats,
  scored: Scored,
  deep: boolean,
  timeoutMs = 120000,
): Promise<Blurb | null> {
  const prompt = buildPrompt(stats, scored, deep);

  const output = await new Promise<string>((resolve) => {
    const child = spawn("claude", ["-p", prompt], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve("");
    }, timeoutMs);
    child.stdout.on("data", (c) => (out += c));
    child.on("error", () => {
      clearTimeout(timer);
      resolve("");
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve(out);
    });
  });

  const style = output.match(/^STYLE:\s*(.+)$/m)?.[1]?.trim();
  const text = output.match(/^BLURB:\s*(.+)$/m)?.[1]?.trim();
  if (!style || !text) return null;

  return { styleName: style.slice(0, 40), text: text.slice(0, 130), source: "claude" };
}
