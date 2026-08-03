import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import type { Stats } from "./parse.ts";
import { peakHour } from "./parse.ts";
import { fmtTokens, type Scored } from "./score.ts";
import { TIERS, tierIndex, type Palette } from "./themes.ts";

const WIDTH = 1200;
const HEIGHT = 1030;
const PS = "PressStart";
const JB = "JetBrains";

/**
 * satori takes React elements, but the shape it actually needs is
 * {type, props:{children}}. Building those directly keeps react out of
 * the dependency list for a tool that renders exactly one static image.
 */
function h(type: string, props: Record<string, any> = {}, ...children: any[]): any {
  return { type, props: { ...props, children: children.length === 1 ? children[0] : children } };
}

const row = (style: any, ...kids: any[]) => h("div", { style: { display: "flex", ...style } }, ...kids);
const col = (style: any, ...kids: any[]) =>
  h("div", { style: { display: "flex", flexDirection: "column", ...style } }, ...kids);
const text = (value: string, style: any) => h("div", { style: { display: "flex", ...style } }, value);

const ART: Record<string, string[]> = {
  ORCHESTRATOR: ["   .   ", "  |o|  ", "  ' '  ", " |.-.| ", "  ( )  ", "   )   ", "  ( )  "],
  "HEAVY LIFTER": ["  ___  ", " |***| ", " |***| ", "==[_]==", "  | |  ", " _|_|_ "],
  METRONOME: ["   ^   ", "  /|\\  ", " / | \\ ", "/  |  \\", "-------", " |___| "],
  "DEEP DIVER": ["  ~~~  ", " ~   ~ ", "  \\o/  ", "   |   ", "  / \\  ", " ~~~~~ "],
  POLYMATH: [" o o o ", "  \\|/  ", " o-+-o ", "  /|\\  ", " o o o "],
};

function bar(fill: number, total: number, width: number, p: Palette) {
  const pct = total === 0 ? 0 : Math.max(0.02, fill / total);
  return h(
    "div",
    { style: { display: "flex", width, height: 22, backgroundColor: p.border, borderRadius: 3 } },
    h("div", { style: { display: "flex", width: Math.round(width * pct), backgroundColor: p.accent, borderRadius: 3 } }),
  );
}

/**
 * `side` panels sit next to each other and share the row's width. A full-width
 * panel must NOT use flex:1, because in a column parent that sets a zero height
 * basis and the panel collapses under its own contents.
 */
function panel(p: Palette, heading: string, lines: any[], side = false) {
  return col(
    {
      ...(side ? { flex: 1 } : { width: "100%" }),
      flexShrink: 0,
      border: `1px solid ${p.accent}`,
      borderRadius: 10,
      padding: "18px 22px",
      gap: 10,
    },
    text(heading, { color: p.accent, fontSize: 21, letterSpacing: 1, fontWeight: 700 }),
    ...lines,
  );
}

/** A big value followed by a muted label, the shape used in every stat panel. */
function stat(p: Palette, value: string, label: string, valueColor?: string) {
  return row(
    { alignItems: "baseline", gap: 9 },
    text(value, { color: valueColor ?? p.text, fontSize: 27 }),
    text(label, { color: p.muted, fontSize: 20 }),
  );
}

export type CardInput = {
  stats: Stats;
  scored: Scored;
  palette: Palette;
  handle: string;
  styleName: string;
  blurb: string;
  cost: number | null;
};

function layout({ stats, scored, palette: p, handle, styleName, blurb, cost }: CardInput) {
  const peak = peakHour(stats.hourly);
  const maxHour = Math.max(...stats.hourly, 1);
  const totalMsgs = stats.weekdayMsgs + stats.weekendMsgs || 1;
  const weekdayPct = Math.round((100 * stats.weekdayMsgs) / totalMsgs);
  const art = ART[scored.archetype] ?? ART.ORCHESTRATOR;
  const best = [...scored.axes].sort((a, b) => b.points - a.points)[0];
  const activeHours = Math.round(stats.activeMs / 3.6e6);
  const mine = tierIndex(p);

  return col(
    {
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: p.base,
      padding: 30,
      fontFamily: JB,
    },
    col(
      {
        flex: 1,
        border: `2px solid ${p.accent}`,
        borderRadius: 14,
        padding: "30px 34px",
        justifyContent: "space-between",
      },

      text("YOUR AI WRAPPED", { fontFamily: PS, fontSize: 52, color: p.text, flexShrink: 0 }),

      // score, art, and the tier swatches
      row(
        { alignItems: "center", justifyContent: "space-between", marginTop: 6, flexShrink: 0 },
        col(
          { gap: 6 },
          row(
            { alignItems: "flex-end", gap: 14 },
            text(String(scored.total), {
              fontFamily: PS,
              fontSize: 104,
              color: p.accent,
              letterSpacing: 8, // Press Start 2P sets tight by default and the digits touch
            }),
            text("/100", { fontSize: 32, color: p.muted, paddingBottom: 12 }),
          ),
          text(`strongest: ${best.label} ${best.points.toFixed(0)}/20`, {
            fontSize: 22,
            color: p.accent,
          }),
        ),
        col(
          { alignItems: "center", gap: 12, flexShrink: 0 },
          col(
            { alignItems: "center", flexShrink: 0 },
            ...art.map((line) => text(line, { fontSize: 21, color: p.accent, lineHeight: 1.1 })),
          ),
          text(scored.archetype, { fontSize: 21, color: p.accent, letterSpacing: 3 }),
        ),
        col(
          { gap: 7 },
          ...TIERS.map((tier, i) =>
            h("div", {
              style: {
                display: "flex",
                width: 26,
                height: 26,
                borderRadius: 4,
                backgroundColor: tier.palette.accent,
                border: i === mine ? `3px solid ${p.text}` : `3px solid ${p.base}`,
              },
            }),
          ),
        ),
      ),

      // who this is and what the model made of them
      col(
        { alignItems: "center", gap: 8, flexShrink: 0 },
        row(
          { gap: 10 },
          text(`${handle}'s style:`, { fontSize: 25, color: p.muted }),
          text(styleName, { fontSize: 25, color: p.text }),
        ),
        text(blurb, {
          fontSize: 21,
          color: p.muted,
          textAlign: "center",
          maxWidth: 940,
          lineHeight: 1.45,
        }),
      ),

      col(
        { gap: 14, flexShrink: 0 },
        text(`In the last ${stats.days} days:`, { fontSize: 20, color: p.muted }),
        row(
          { gap: 18, flexShrink: 0 },
          panel(p, "TOKENS", [
            stat(p, fmtTokens(stats.tokens), "tokens used"),
            cost === null
              ? stat(p, "·", "install ccusage for cost")
              : stat(p, `$${Math.round(cost).toLocaleString("en-US")}`, "spent at retail", p.accent),
          ], true),
          panel(p, "AGENTS", [
            stat(p, String(stats.agentsTotal), "subagents spawned"),
            stat(p, `${activeHours}h`, `across ${stats.sessions.toLocaleString("en-US")} sessions`),
          ], true),
        ),

        panel(p, "WHEN YOU CODE", [
          row(
            { alignItems: "center", gap: 24, flexShrink: 0 },
            col(
              { gap: 4, flexShrink: 0, width: 320 },
              row(
                { alignItems: "flex-end", height: 42, gap: 2, flexShrink: 0 },
                ...stats.hourly.map((n) =>
                  h("div", {
                    style: {
                      display: "flex",
                      width: 11,
                      height: Math.max(2, Math.round((n / maxHour) * 40)),
                      backgroundColor: p.accent,
                      flexShrink: 0,
                    },
                  }),
                ),
              ),
              row(
                { width: 314, justifyContent: "space-between" },
                ...["00", "06", "12", "18", "23"].map((l) => text(l, { fontSize: 15, color: p.muted })),
              ),
            ),
            text(`peak ${String(peak).padStart(2, "0")}:00`, {
              fontSize: 21,
              color: p.text,
              flexShrink: 0,
            }),
            col(
              { gap: 8, flexShrink: 0 },
              row(
                { alignItems: "center", gap: 12, flexShrink: 0 },
                text("weekdays", { fontSize: 19, color: p.text, width: 104, flexShrink: 0 }),
                bar(weekdayPct, 100, 190, p),
                text(`${weekdayPct}%`, { fontSize: 19, color: p.muted, width: 52, flexShrink: 0 }),
              ),
              row(
                { alignItems: "center", gap: 12, flexShrink: 0 },
                text("weekends", { fontSize: 19, color: p.text, width: 104, flexShrink: 0 }),
                bar(100 - weekdayPct, 100, 190, p),
                text(`${100 - weekdayPct}%`, { fontSize: 19, color: p.muted, width: 52, flexShrink: 0 }),
              ),
            ),
          ),
        ]),
      ),

      text("npx agent-wrapped · runs entirely on your machine", {
        fontSize: 17,
        color: p.muted,
        alignSelf: "center",
      }),
    ),
  );
}

export async function render(input: CardInput): Promise<Buffer> {
  const assets = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");
  const [pixel, mono, monoBold] = await Promise.all([
    readFile(join(assets, "PressStart2P-Regular.ttf")),
    readFile(join(assets, "JetBrainsMono-Regular.ttf")),
    readFile(join(assets, "JetBrainsMono-Bold.ttf")),
  ]);

  const svg = await satori(layout(input), {
    width: WIDTH,
    height: HEIGHT,
    fonts: [
      { name: PS, data: pixel, weight: 400, style: "normal" },
      { name: JB, data: mono, weight: 400, style: "normal" },
      { name: JB, data: monoBold, weight: 700, style: "normal" },
    ],
  });

  return Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: WIDTH } }).render().asPng());
}
