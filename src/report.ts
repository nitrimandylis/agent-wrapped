import type { Stats } from "./parse.ts";
import { peakHour } from "./parse.ts";
import type { Quip } from "./quips.ts";
import { fmtTokens, valueForPoints, type Scored } from "./score.ts";
import type { Snapshot } from "./history.ts";

export type ReportInput = {
  stats: Stats;
  scored: Scored;
  quips: Quip[];
  styleName: string;
  blurb: string;
  blurbSource: "claude" | "template";
  cost: number | null;
  previous: Snapshot | null;
  paletteName: string;
};

const num = (n: number) => Math.round(n).toLocaleString("en-US");

/** Enough decimals to be useful, no more than the axis unit deserves. */
function value(n: number, unit: string): string {
  const rounded = n >= 100 ? num(n) : n.toFixed(1);
  return `${rounded} ${unit}`;
}

/**
 * The auditable version of the score. Every axis shows what was measured, the
 * ceiling it was measured against, the curve, and what one more point costs,
 * so nobody has to take the total on faith.
 */
export function report(input: ReportInput): string {
  const { stats, scored } = input;
  const out: string[] = [];
  const line = (s = "") => out.push(s);

  const delta =
    input.previous === null ? "" : `  (${scored.total - input.previous.score >= 0 ? "+" : ""}${scored.total - input.previous.score} on ${input.previous.month})`;

  line();
  line(`  ${scored.total}/100  ${scored.archetype}${delta}`);
  line(`  ${scored.defining[0].label} + ${scored.defining[1].label} · theme ${input.paletteName}`);
  line();

  for (const axis of scored.axes) {
    const full = axis.points >= 20;
    line(
      `  ${axis.label.padEnd(14)}${axis.points.toFixed(1).padStart(5)}/20  ${axis.curve}`,
    );
    line(`    ${value(axis.raw, axis.unit)}, ceiling ${value(axis.ceiling, axis.unit)}`);
    if (!full) {
      const need = valueForPoints(axis, Math.floor(axis.points) + 1);
      line(`    +1pt at ${value(need, axis.unit)}`);
    } else {
      line("    maxed");
    }
  }

  line();
  line(`  window     ${stats.since.toISOString().slice(0, 10)} .. ${stats.until.toISOString().slice(0, 10)}`);
  line(`  tokens     ${fmtTokens(stats.tokens)}${input.cost === null ? "" : `  ·  $${num(input.cost)} at API rates`}`);
  line(`  sessions   ${num(stats.interactive)} interactive, ${num(stats.headless)} headless`);
  line(`  time       ${Math.round(stats.activeMs / 3.6e6)}h across ${stats.activeDays}/${stats.days} days`);
  line(`  peak       ${String(peakHour(stats.hourly)).padStart(2, "0")}:00`);
  line();
  line(`  style      ${input.styleName}`);
  line(`  blurb      ${input.blurb}`);
  line(`  source     ${input.blurbSource === "claude" ? "your local claude" : "template (claude unavailable)"}`);

  if (input.quips.length > 0) {
    line();
    for (const q of input.quips) line(`  › ${q.line}`);
  }

  line();
  return out.join("\n");
}

/** Everything the report knows, for anyone who would rather script it. */
export function asJson(input: ReportInput) {
  const { stats, scored } = input;
  return {
    window: {
      since: stats.since.toISOString(),
      until: stats.until.toISOString(),
      days: stats.days,
    },
    score: scored.total,
    archetype: scored.archetype,
    defining: scored.defining.map((a) => a.key),
    axes: scored.axes.map((a) => ({
      key: a.key,
      points: a.points,
      raw: a.raw,
      ceiling: a.ceiling,
      curve: a.curve,
      unit: a.unit,
      nextPointAt: a.points >= 20 ? null : valueForPoints(a, Math.floor(a.points) + 1),
    })),
    previousMonth: input.previous
      ? { month: input.previous.month, score: input.previous.score }
      : null,
    tokens: stats.tokens,
    models: stats.models,
    apiEquivalentUsd: input.cost,
    sessions: {
      total: stats.sessions,
      interactive: stats.interactive,
      headless: stats.headless,
    },
    activeMs: stats.activeMs,
    activeDays: stats.activeDays,
    hourly: stats.hourly,
    weekdayMsgs: stats.weekdayMsgs,
    weekendMsgs: stats.weekendMsgs,
    projects: stats.projects.length,
    agentsTotal: stats.agentsTotal,
    agentTypes: stats.agentTypes,
    mined: stats.mined,
    styleName: input.styleName,
    blurb: input.blurb,
    blurbSource: input.blurbSource,
    quips: input.quips.map((q) => ({ key: q.key, line: q.line })),
  };
}
