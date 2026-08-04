import type { Stats } from "./parse.ts";
import { peakHour } from "./parse.ts";
import type { Quip } from "./quips.ts";
import { fmtTokens, type Scored } from "./score.ts";
import type { Palette } from "./themes.ts";

/**
 * satori takes React elements, but the shape it actually needs is
 * {type, props:{children}}. Building those directly keeps react out of
 * the dependency list for a tool that renders exactly one static image.
 */
export function h(type: string, props: Record<string, any> = {}, ...children: any[]): any {
  return { type, props: { ...props, children: children.length === 1 ? children[0] : children } };
}

export const row = (style: any, ...kids: any[]) =>
  h("div", { style: { display: "flex", ...style } }, ...kids);
export const col = (style: any, ...kids: any[]) =>
  h("div", { style: { display: "flex", flexDirection: "column", ...style } }, ...kids);
export const text = (value: string, style: any) =>
  h("div", { style: { display: "flex", ...style } }, value);

export const PS = "PressStart";
export const JB = "JetBrains";

export type Ctx = {
  stats: Stats;
  scored: Scored;
  palette: Palette;
  handle: string;
  styleName: string;
  blurb: string;
  quips: Quip[];
  cost: number | null;
  /** Score change against last month, when a history file has one. */
  trend: number | null;
  /** Everything is sized off this, so one number retunes a whole canvas. */
  scale: number;
};

/**
 * Three sizes and nothing between them. The old card used seven, which is why
 * nothing on it read as more important than anything else.
 */
export const DISPLAY = 96;
export const BODY = 22;
export const LABEL = 17;

const px = (c: Ctx, n: number) => Math.round(n * c.scale);
const num = (n: number) => Math.round(n).toLocaleString("en-US");

/** Highest-count entries of a histogram, biggest first. */
function top(counts: Record<string, number>, n: number): [string, number][] {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

/** MCP tool names run to `mcp__server__some_tool`, which is unreadable on a card. */
function shortToolName(name: string): string {
  if (!name.startsWith("mcp__")) return name;
  return name.split("__").pop() ?? name;
}

/**
 * `width: null` lets the track take whatever the row leaves it. The fill is a
 * percentage rather than a pixel count, because a flexed track has no width to
 * multiply at build time.
 */
function bar(c: Ctx, fill: number, total: number, width: number | null, height: number) {
  const pct = total === 0 ? 0 : Math.max(0.015, Math.min(1, fill / total));
  const p = c.palette;
  const radius = Math.round(height / 2);
  return h(
    "div",
    {
      style: {
        display: "flex",
        ...(width === null ? { flex: 1 } : { width }),
        height,
        backgroundColor: p.border,
        borderRadius: radius,
      },
    },
    h("div", {
      style: {
        display: "flex",
        width: `${(pct * 100).toFixed(1)}%`,
        height,
        backgroundColor: p.accent,
        borderRadius: radius,
      },
    }),
  );
}

/**
 * A filled surface, not a hollow outline. Every panel on the old card was an
 * identical 1px box, so the card had no foreground and no background.
 */
function panel(c: Ctx, style: any, ...kids: any[]) {
  return col(
    {
      backgroundColor: c.palette.panel,
      border: `1px solid ${c.palette.border}`,
      borderRadius: px(c, 10),
      padding: `${px(c, 16)}px ${px(c, 20)}px`,
      ...style,
    },
    ...kids,
  );
}

/** Big value, muted label under it. The unit of every stat panel. */
function stat(c: Ctx, value: string, label: string, accent = false) {
  return col(
    { gap: px(c, 4) },
    text(value, {
      fontSize: px(c, BODY * 1.6),
      color: accent ? c.palette.accent : c.palette.text,
    }),
    text(label, { fontSize: px(c, LABEL), color: c.palette.muted }),
  );
}

type Block = (c: Ctx) => any;

/**
 * Every element the card can show. A layout is a list of these names, so adding
 * a block to one canvas never involves touching another.
 *
 * Every block must claim its width with `flex: 1` and never `width: "100%"`.
 * Blocks sit in a row, so two hundred-percent blocks in one row push each other
 * out and the second one silently disappears.
 */
export const BLOCKS: Record<string, Block> = {
  /** The number, the archetype, and the month-on-month move. */
  score(c) {
    const { palette: p, scored } = c;
    const trend =
      c.trend === null
        ? null
        : c.trend === 0
          ? "level with last month"
          : `${c.trend > 0 ? "+" : ""}${c.trend} on last month`;

    return row(
      { alignItems: "center", justifyContent: "space-between", flex: 1 },
      col(
        { gap: px(c, 2) },
        row(
          { alignItems: "flex-end", gap: px(c, 12) },
          text(String(scored.total), {
            fontFamily: PS,
            fontSize: px(c, DISPLAY),
            color: p.accent,
            letterSpacing: px(c, 7), // Press Start 2P sets tight and the digits touch
          }),
          text("/100", {
            fontSize: px(c, BODY * 1.2),
            color: p.muted,
            paddingBottom: px(c, 10),
          }),
        ),
        trend ? text(trend, { fontSize: px(c, LABEL), color: p.muted }) : text("", {}),
      ),
      col(
        { alignItems: "flex-end", gap: px(c, 6) },
        text(scored.archetype, {
          fontSize: px(c, BODY * 1.15),
          color: p.text,
          letterSpacing: px(c, 2),
        }),
        text(
          `${scored.defining[0].label} + ${scored.defining[1].label}`,
          { fontSize: px(c, LABEL), color: p.muted },
        ),
      ),
    );
  },

  /** The five bars the total is made of, so the number is auditable on the card. */
  axes(c) {
    const p = c.palette;
    return panel(
      c,
      { flex: 1, gap: px(c, 9) },
      ...c.scored.axes.map((axis) =>
        row(
          { alignItems: "center", gap: px(c, 12), width: "100%" },
          text(axis.label, {
            fontSize: px(c, LABEL),
            color: p.text,
            width: px(c, 130),
            flexShrink: 0,
          }),
          bar(c, axis.points, 20, null, px(c, 9)),
          text(axis.points.toFixed(1), {
            fontSize: px(c, LABEL),
            color: p.muted,
            width: px(c, 46),
            flexShrink: 0,
            justifyContent: "flex-end",
          }),
        ),
      ),
    );
  },

  /** What the model made of you. */
  blurb(c) {
    const p = c.palette;
    return col(
      { flex: 1, gap: px(c, 6) },
      text(c.styleName, { fontSize: px(c, BODY), color: p.accent }),
      text(c.blurb, { fontSize: px(c, BODY), color: p.text, lineHeight: 1.4 }),
    );
  },

  /** Computed, never generated. These are the lines people screenshot. */
  quips(c) {
    const p = c.palette;
    return col(
      { flex: 1, gap: px(c, 7) },
      ...c.quips.map((q) =>
        row(
          { gap: px(c, 10), alignItems: "flex-start" },
          text("›", { fontSize: px(c, BODY), color: p.accent, flexShrink: 0 }),
          text(q.line, { fontSize: px(c, BODY), color: p.muted, lineHeight: 1.35 }),
        ),
      ),
    );
  },

  tokens(c) {
    return panel(c, { flex: 1 }, stat(c, fmtTokens(c.stats.tokens), "tokens"));
  },

  cost(c) {
    return panel(
      c,
      { flex: 1 },
      c.cost === null
        ? stat(c, "·", "install ccusage for cost")
        : stat(c, `$${num(c.cost)}`, "at API rates", true),
    );
  },

  agents(c) {
    return panel(c, { flex: 1 }, stat(c, num(c.stats.agentsTotal), "subagents"));
  },

  sessions(c) {
    return panel(
      c,
      { flex: 1 },
      stat(c, num(c.stats.interactive), `sessions · ${Math.round(c.stats.activeMs / 3.6e6)}h`),
    );
  },

  headless(c) {
    return panel(c, { flex: 1 }, stat(c, num(c.stats.headless), "headless runs"));
  },

  projects(c) {
    return panel(c, { flex: 1 }, stat(c, num(c.stats.projects.length), "projects"));
  },

  /** Promoted to hero width. It was the best thing on the card at 320px wide. */
  clock(c) {
    const p = c.palette;
    const peak = peakHour(c.stats.hourly);
    const max = Math.max(...c.stats.hourly, 1);
    const height = px(c, 84);

    return panel(
      c,
      { flex: 1, gap: px(c, 10) },
      row(
        { justifyContent: "space-between", alignItems: "baseline", width: "100%" },
        text("when you work", { fontSize: px(c, LABEL), color: p.muted }),
        text(`peak ${String(peak).padStart(2, "0")}:00`, {
          fontSize: px(c, LABEL),
          color: p.accent,
        }),
      ),
      row(
        { alignItems: "flex-end", height, gap: px(c, 4), width: "100%" },
        ...c.stats.hourly.map((n, hour) =>
          h("div", {
            style: {
              display: "flex",
              flex: 1,
              height: Math.max(px(c, 3), Math.round((n / max) * height)),
              backgroundColor: hour === peak ? p.accent : p.border,
              borderRadius: px(c, 2),
            },
          }),
        ),
      ),
      row(
        { justifyContent: "space-between", width: "100%" },
        ...["00", "06", "12", "18", "23"].map((l) =>
          text(l, { fontSize: px(c, LABEL * 0.85), color: p.muted }),
        ),
      ),
    );
  },

  /** Weekday against weekend, as one bar rather than two competing ones. */
  split(c) {
    const p = c.palette;
    const total = c.stats.weekdayMsgs + c.stats.weekendMsgs || 1;
    const weekday = Math.round((100 * c.stats.weekdayMsgs) / total);
    return panel(
      c,
      { flex: 1, gap: px(c, 10) },
      row(
        { justifyContent: "space-between", width: "100%" },
        text(`weekdays ${weekday}%`, { fontSize: px(c, LABEL), color: p.text }),
        text(`weekends ${100 - weekday}%`, { fontSize: px(c, LABEL), color: p.muted }),
      ),
      row(
        { width: "100%", height: px(c, 9), borderRadius: px(c, 5), backgroundColor: p.border },
        h("div", {
          style: {
            display: "flex",
            width: `${weekday}%`,
            height: px(c, 9),
            backgroundColor: p.accent,
            borderRadius: px(c, 5),
          },
        }),
      ),
    );
  },

  models(c) {
    const p = c.palette;
    const entries = top(c.stats.models, 4);
    const most = entries[0]?.[1] ?? 1;
    return panel(
      c,
      { flex: 1, gap: px(c, 8) },
      text("models", { fontSize: px(c, LABEL), color: p.muted }),
      ...entries.map(([name, n]) =>
        row(
          { alignItems: "center", gap: px(c, 10), width: "100%" },
          text(name.replace(/^claude-/, "").replace(/-\d{8}$/, ""), {
            fontSize: px(c, LABEL),
            color: p.text,
            flex: 1,
          }),
          bar(c, n, most, px(c, 90), px(c, 7)),
          text(fmtTokens(n), {
            fontSize: px(c, LABEL),
            color: p.muted,
            width: px(c, 54),
            flexShrink: 0,
            justifyContent: "flex-end",
          }),
        ),
      ),
    );
  },

  tools(c) {
    const p = c.palette;
    const entries = top(c.stats.mined.tools, 4);
    const most = entries[0]?.[1] ?? 1;
    return panel(
      c,
      { flex: 1, gap: px(c, 8) },
      text("tools", { fontSize: px(c, LABEL), color: p.muted }),
      ...entries.map(([name, n]) =>
        row(
          { alignItems: "center", gap: px(c, 10), width: "100%" },
          text(shortToolName(name), { fontSize: px(c, LABEL), color: p.text, flex: 1 }),
          bar(c, n, most, px(c, 90), px(c, 7)),
          text(num(n), {
            fontSize: px(c, LABEL),
            color: p.muted,
            width: px(c, 54),
            flexShrink: 0,
            justifyContent: "flex-end",
          }),
        ),
      ),
    );
  },

  agentTypes(c) {
    const p = c.palette;
    const entries = top(c.stats.agentTypes, 4);
    const most = entries[0]?.[1] ?? 1;
    return panel(
      c,
      { flex: 1, gap: px(c, 8) },
      text("agents", { fontSize: px(c, LABEL), color: p.muted }),
      ...(entries.length === 0
        ? [text("none spawned", { fontSize: px(c, LABEL), color: p.muted })]
        : entries.map(([name, n]) =>
            row(
              { alignItems: "center", gap: px(c, 10), width: "100%" },
              text(name, { fontSize: px(c, LABEL), color: p.text, flex: 1 }),
              bar(c, n, most, px(c, 90), px(c, 7)),
              text(num(n), {
                fontSize: px(c, LABEL),
                color: p.muted,
                width: px(c, 54),
                flexShrink: 0,
                justifyContent: "flex-end",
              }),
            ),
          )),
    );
  },
};
