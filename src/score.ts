import type { Stats } from "./parse.ts";

export type Axis = {
  key: string;
  label: string;
  points: number;
  detail: string;
};

export type Scored = {
  total: number;
  axes: Axis[];
  archetype: string;
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
  const agentsPerOrchestrated = s.agentsTotal;

  const axes: Axis[] = [
    {
      key: "volume",
      label: "volume",
      points: logScore(s.tokens / 1e6, 6000), // 6B tokens in 30 days tops it out
      detail: `${fmtTokens(s.tokens)} tokens`,
    },
    {
      key: "consistency",
      label: "consistency",
      points: linearScore(s.activeDays, s.days),
      detail: `${s.activeDays}/${s.days} active days`,
    },
    {
      key: "depth",
      label: "depth",
      points: linearScore(hoursPerActiveDay, 10), // 10h of active time in a day is a lot
      detail: `${hoursPerActiveDay.toFixed(1)}h per active day`,
    },
    {
      key: "breadth",
      label: "breadth",
      points: logScore(s.projects.length, 100),
      detail: `${s.projects.length} projects`,
    },
    {
      key: "orchestration",
      label: "orchestration",
      points: logScore(agentsPerOrchestrated, 400),
      detail: `${s.agentsTotal} agents spawned`,
    },
  ];

  const total = Math.round(axes.reduce((sum, a) => sum + a.points, 0));
  return { total, axes, archetype: archetypeFor(axes) };
}

/** Named after whichever axis is furthest ahead of the others. Deterministic, no LLM. */
function archetypeFor(axes: Axis[]): string {
  const names: Record<string, string> = {
    volume: "HEAVY LIFTER",
    consistency: "METRONOME",
    depth: "DEEP DIVER",
    breadth: "POLYMATH",
    orchestration: "ORCHESTRATOR",
  };
  const best = [...axes].sort((a, b) => b.points - a.points)[0];
  return names[best.key] ?? "OPERATOR";
}

export function fmtTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${Math.round(n / 1e6)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(n);
}
