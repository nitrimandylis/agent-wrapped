import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Stats } from "./parse.ts";
import type { Scored } from "./score.ts";

/**
 * Claude Code prunes transcripts at about 30 days, so a real year in review is
 * impossible from the transcripts alone. One small snapshot per month is what
 * makes it possible later. Prompts and titles are deliberately not stored: they
 * are unbounded and they are the only fields that contain anything you wrote.
 */
export type Snapshot = {
  month: string;
  window: { since: string; until: string; days: number };
  score: number;
  archetype: string;
  axes: Record<string, number>;
  tokens: number;
  models: Record<string, number>;
  sessions: number;
  interactive: number;
  headless: number;
  activeMs: number;
  activeDays: number;
  hourly: number[];
  weekdayMsgs: number;
  weekendMsgs: number;
  projects: number;
  agentsTotal: number;
  agentTypes: Record<string, number>;
  mined: Stats["mined"];
};

export type History = Record<string, Snapshot>;

export function historyPath(): string {
  return join(homedir(), ".agent-wrapped", "history.json");
}

export function snapshot(stats: Stats, scored: Scored): Snapshot {
  return {
    month: stats.until.toISOString().slice(0, 7),
    window: {
      since: stats.since.toISOString(),
      until: stats.until.toISOString(),
      days: stats.days,
    },
    score: scored.total,
    archetype: scored.archetype,
    axes: Object.fromEntries(scored.axes.map((a) => [a.key, a.points])),
    tokens: stats.tokens,
    models: stats.models,
    sessions: stats.sessions,
    interactive: stats.interactive,
    headless: stats.headless,
    activeMs: stats.activeMs,
    activeDays: stats.activeDays,
    hourly: stats.hourly,
    weekdayMsgs: stats.weekdayMsgs,
    weekendMsgs: stats.weekendMsgs,
    // A count, not the names: project directories carry client and employer names.
    projects: stats.projects.length,
    agentsTotal: stats.agentsTotal,
    agentTypes: stats.agentTypes,
    mined: stats.mined,
  };
}

export async function readHistory(path = historyPath()): Promise<History> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    // A hand-edited or half-written file must not take the whole run down.
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Keyed by month and overwritten on re-run, so running twice in August leaves one
 * August record rather than two overlapping 30-day windows that double-count.
 */
export async function writeHistory(entry: Snapshot, path = historyPath()): Promise<History> {
  const history = await readHistory(path);
  history[entry.month] = entry;

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(history, null, 2)}\n`);
  return history;
}

/** The month before this one, when there is one, for a "up 6 from July" line. */
export function previous(history: History, month: string): Snapshot | null {
  const earlier = Object.keys(history)
    .filter((m) => m < month)
    .sort();
  const last = earlier[earlier.length - 1];
  return last ? history[last] : null;
}
