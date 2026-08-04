import type { Stats } from "./parse.ts";

/**
 * One true sentence about your month. These are computed, never generated, so
 * they survive `claude` being missing and can never say anything that isn't in
 * the transcripts. Counts and single words only: no phrase you typed appears here.
 */
export type Quip = { key: string; line: string };

type Rule = {
  key: string;
  /** Skip the rule when the number isn't interesting enough to print. */
  when: (s: Stats) => boolean;
  say: (s: Stats) => string;
};

const n = (value: number) => Math.round(value).toLocaleString("en-US");

/** Highest count in a histogram, or null when it's empty. */
function top(counts: Record<string, number>): { name: string; count: number } | null {
  let best: { name: string; count: number } | null = null;
  for (const [name, count] of Object.entries(counts)) {
    if (!best || count > best.count) best = { name, count };
  }
  return best;
}

function hoursMinutes(ms: number): string {
  const total = Math.round(ms / 60000);
  return `${Math.floor(total / 60)}h${String(total % 60).padStart(2, "0")}m`;
}

/**
 * Ordered most surprising first. The card takes the first few that apply, so
 * moving a rule up this list is how you promote it.
 */
const RULES: Rule[] = [
  {
    key: "headless",
    when: (s) => s.headless >= s.interactive * 2 && s.headless >= 50,
    say: (s) => `your own tooling called Claude ${n(s.headless)} times without you`,
  },
  {
    key: "midnight",
    when: (s) => s.mined.afterMidnight >= 50,
    say: (s) => `${n(s.mined.afterMidnight)} messages sent after midnight`,
  },
  {
    key: "interrupted",
    when: (s) => s.mined.interruptions >= 10,
    say: (s) => `cut Claude off mid-sentence ${n(s.mined.interruptions)} times`,
  },
  {
    key: "no",
    when: (s) => s.mined.pushback.no >= 20,
    say: (s) => `said "no" ${n(s.mined.pushback.no)} times`,
  },
  {
    key: "streak",
    when: (s) => s.mined.longestStreak >= s.days,
    say: (s) => `${s.mined.longestStreak} days straight, not one off`,
  },
  {
    key: "longest-prompt",
    when: (s) => s.mined.longestPrompt >= 20000,
    say: (s) => `longest single message: ${n(s.mined.longestPrompt)} characters`,
  },
  {
    key: "bash-verb",
    when: (s) => (top(s.mined.bashVerbs)?.count ?? 0) >= 50,
    say: (s) => {
      const verb = top(s.mined.bashVerbs)!;
      return `ran ${verb.name} ${n(verb.count)} times`;
    },
  },
  {
    key: "actually",
    when: (s) => s.mined.pushback.actually >= 20,
    say: (s) => `said "actually" ${n(s.mined.pushback.actually)} times`,
  },
  {
    key: "busiest",
    when: (s) => s.mined.busiestDay.count >= 100,
    say: (s) => `busiest day was ${s.mined.busiestDay.date}, ${n(s.mined.busiestDay.count)} messages`,
  },
  {
    key: "streak-partial",
    when: (s) => s.mined.longestStreak >= 5 && s.mined.longestStreak < s.days,
    say: (s) => `longest streak: ${s.mined.longestStreak} days`,
  },
  {
    key: "files",
    when: (s) => s.mined.filesTouched >= 25,
    say: (s) => `touched ${n(s.mined.filesTouched)} different files`,
  },
  {
    key: "longest-session",
    when: (s) => s.mined.longestSessionMs >= 1 * 3.6e6,
    say: (s) => `longest unbroken session: ${hoursMinutes(s.mined.longestSessionMs)}`,
  },
  {
    key: "top-word",
    when: (s) => s.mined.topWordCount >= 15,
    say: (s) => `most typed word: "${s.mined.topWord}", ${n(s.mined.topWordCount)} times`,
  },
  {
    key: "agent-type",
    when: (s) => (top(s.agentTypes)?.count ?? 0) >= 10,
    say: (s) => {
      const agent = top(s.agentTypes)!;
      return `${n(agent.count)} of your agents were ${agent.name}`;
    },
  },
  {
    key: "weekend",
    when: (s) => s.weekendMsgs > 0 && s.weekendMsgs / (s.weekdayMsgs + s.weekendMsgs) >= 0.25,
    say: (s) =>
      `${Math.round((100 * s.weekendMsgs) / (s.weekdayMsgs + s.weekendMsgs))}% of it happened at the weekend`,
  },
  {
    key: "models",
    when: (s) => Object.keys(s.models).length >= 3,
    say: (s) => `spread across ${Object.keys(s.models).length} different models`,
  },
  {
    key: "top-tool",
    when: (s) => (top(s.mined.tools)?.count ?? 0) >= 10,
    say: (s) => {
      const tool = top(s.mined.tools)!;
      return `${tool.name} was your most used tool, ${n(tool.count)} calls`;
    },
  },
  {
    key: "no-weekends",
    when: (s) => s.weekendMsgs === 0 && s.weekdayMsgs > 0,
    say: () => "not one message at the weekend",
  },
  {
    // Deliberately not the peak hour: the clock block already prints that, and
    // a quip repeating the panel underneath it reads as padding.
    key: "day-range",
    when: (s) => {
      const active = s.hourly.map((v, h) => (v > 0 ? h : -1)).filter((h) => h >= 0);
      return active.length >= 2 && active[0] !== active[active.length - 1];
    },
    say: (s) => {
      const active = s.hourly.map((v, h) => (v > 0 ? h : -1)).filter((h) => h >= 0);
      const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
      return `your day runs ${hh(active[0])} to ${hh(active[active.length - 1])}`;
    },
  },
  {
    // Last resort, always true, and the one number no panel on any layout shows.
    key: "messages",
    when: (s) => s.weekdayMsgs + s.weekendMsgs > 0,
    say: (s) => `you and Claude traded ${n(s.weekdayMsgs + s.weekendMsgs)} messages`,
  },
];

export function quips(s: Stats, limit = 3): Quip[] {
  return RULES.filter((rule) => rule.when(s))
    .slice(0, limit)
    .map((rule) => ({ key: rule.key, line: rule.say(s) }));
}

/** Everything that applied, for the terminal report and the LLM prompt. */
export function allQuips(s: Stats): Quip[] {
  return quips(s, RULES.length);
}
