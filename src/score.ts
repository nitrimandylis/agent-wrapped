import type { Stats } from "./parse.ts";

export type Axis = {
  key: string;
  label: string;
  points: number;
  detail: string;
  /** The measured value, in `unit`. Printed by the report so the score is auditable. */
  raw: number;
  ceiling: number;
  curve: "log" | "linear";
  unit: string;
};

export type Scored = {
  total: number;
  axes: Axis[];
  archetype: string;
  /** The two axes the archetype was named after, strongest first. */
  defining: [Axis, Axis];
};

const PER_AXIS = 20;

/**
 * Log curve rather than linear. A linear scale calibrated to a heavy user makes
 * everyone else score near zero; this stays generous early and compresses at the
 * top, so `ceiling` is "comfortably maxed" rather than "the most anyone could do".
 */
function logScore(value: number, ceiling: number): number {
  if (value <= 0) return 0;
  const scaled = Math.log10(1 + value) / Math.log10(1 + ceiling);
  return Math.min(PER_AXIS, Math.round(scaled * PER_AXIS * 10) / 10);
}

function linearScore(value: number, ceiling: number): number {
  if (value <= 0) return 0;
  return Math.min(PER_AXIS, Math.round((value / ceiling) * PER_AXIS * 10) / 10);
}

export function score(s: Stats): Scored {
  const hoursPerActiveDay = s.activeDays === 0 ? 0 : s.activeMs / 3.6e6 / s.activeDays;
  const tokensInMillions = s.tokens / 1e6;

  const axes: Axis[] = [
    {
      key: "volume",
      label: "volume",
      points: logScore(tokensInMillions, 6000), // 6B tokens in 30 days tops it out
      detail: `${fmtTokens(s.tokens)} tokens`,
      raw: tokensInMillions,
      ceiling: 6000,
      curve: "log",
      unit: "M tokens",
    },
    {
      key: "consistency",
      label: "consistency",
      points: linearScore(s.activeDays, s.days),
      detail: `${s.activeDays}/${s.days} active days`,
      raw: s.activeDays,
      ceiling: s.days,
      curve: "linear",
      unit: "active days",
    },
    {
      key: "depth",
      label: "depth",
      points: linearScore(hoursPerActiveDay, 10), // 10h of active time in a day is a lot
      detail: `${hoursPerActiveDay.toFixed(1)}h per active day`,
      raw: hoursPerActiveDay,
      ceiling: 10,
      curve: "linear",
      unit: "h per active day",
    },
    {
      key: "breadth",
      label: "breadth",
      points: logScore(s.projects.length, 100),
      detail: `${s.projects.length} projects`,
      raw: s.projects.length,
      ceiling: 100,
      curve: "log",
      unit: "projects",
    },
    {
      key: "orchestration",
      label: "orchestration",
      points: logScore(s.agentsTotal, 400),
      detail: `${s.agentsTotal} agents spawned`,
      raw: s.agentsTotal,
      ceiling: 400,
      curve: "log",
      unit: "agents",
    },
  ];

  const total = Math.round(axes.reduce((sum, a) => sum + a.points, 0));
  const ranked = [...axes].sort((a, b) => b.points - a.points);
  const defining: [Axis, Axis] = [ranked[0], ranked[1]];

  return { total, axes, archetype: archetypeFor(defining), defining };
}

/**
 * Named after the top TWO axes, not the top one. Consistency is the easiest axis
 * to max — anyone who opens Claude Code daily hits 20/20 — so naming from a
 * single axis called every regular user the same thing.
 */
const ARCHETYPES: Record<string, string> = {
  "consistency+volume": "THE MACHINE",
  "breadth+consistency": "THE ROUNDS",
  "consistency+depth": "THE SHIFT",
  "consistency+orchestration": "THE DISPATCHER",
  "depth+volume": "THE EXCAVATOR",
  "breadth+volume": "THE SPRAWL",
  "orchestration+volume": "THE FOUNDRY",
  "breadth+depth": "THE OBSESSIVE",
  "depth+orchestration": "THE WAR ROOM",
  "breadth+orchestration": "AIR TRAFFIC CONTROL",
};

function archetypeFor(defining: [Axis, Axis]): string {
  // Sorted so the pair reads the same whichever of the two came out ahead.
  const key = [defining[0].key, defining[1].key].sort().join("+");
  return ARCHETYPES[key] ?? "OPERATOR";
}

/**
 * The value this axis would need for `points`. Inverts whichever curve it uses,
 * so the report can say what one more point actually costs.
 */
export function valueForPoints(axis: Axis, points: number): number {
  const fraction = Math.min(1, points / PER_AXIS);
  if (axis.curve === "linear") return fraction * axis.ceiling;
  return 10 ** (fraction * Math.log10(1 + axis.ceiling)) - 1;
}

export function fmtTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${Math.round(n / 1e6)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(n);
}
