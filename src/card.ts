import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import { BLOCKS, col, h, JB, LABEL, PS, row, text, type Ctx } from "./blocks.ts";
import {
  CANVASES,
  manifestFor,
  type DetailName,
  type LayoutName,
} from "./layouts.ts";
import type { Stats } from "./parse.ts";
import type { Quip } from "./quips.ts";
import type { Scored } from "./score.ts";
import type { Palette } from "./themes.ts";

export type CardInput = {
  stats: Stats;
  scored: Scored;
  palette: Palette;
  handle: string;
  styleName: string;
  blurb: string;
  quips: Quip[];
  cost: number | null;
  trend: number | null;
  layout: LayoutName;
  detail: DetailName;
  /** Set only by measureHeight, so satori sizes to content instead of clipping. */
  measure?: boolean;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;

/**
 * A title bar and a prompt line, and that is the whole terminal reference. Any
 * more of it and the chrome competes with the content it is framing.
 */
function chrome(c: Ctx, input: CardInput) {
  const p = c.palette;
  const size = Math.round(LABEL * c.scale);
  const dot = (color: string) =>
    h("div", {
      style: {
        display: "flex",
        width: Math.round(11 * c.scale),
        height: Math.round(11 * c.scale),
        borderRadius: Math.round(6 * c.scale),
        backgroundColor: color,
      },
    });

  return col(
    { width: "100%", flexShrink: 0 },
    row(
      {
        width: "100%",
        alignItems: "center",
        gap: Math.round(8 * c.scale),
        padding: `${Math.round(12 * c.scale)}px ${Math.round(16 * c.scale)}px`,
        backgroundColor: p.panel,
        borderBottom: `1px solid ${p.border}`,
      },
      dot(p.border),
      dot(p.border),
      dot(p.accent),
      text(`${c.handle} — agent-wrapped`, {
        fontSize: size,
        color: p.muted,
        flex: 1,
        justifyContent: "center",
      }),
      // Balances the three dots so the title sits centred rather than off to one side.
      h("div", { style: { display: "flex", width: Math.round(50 * c.scale) } }),
    ),
    row(
      {
        width: "100%",
        alignItems: "baseline",
        gap: Math.round(10 * c.scale),
        padding: `${Math.round(14 * c.scale)}px ${Math.round(20 * c.scale)}px 0`,
      },
      text("$", { fontSize: size, color: p.accent }),
      text("npx @nitrimandylis/agent-wrapped", { fontSize: size, color: p.text }),
      text(
        `${shortDate(c.stats.since)} – ${shortDate(c.stats.until)} · ${c.stats.days}d`,
        { fontSize: size, color: p.muted, flex: 1, justifyContent: "flex-end" },
      ),
    ),
  );
}

function layoutFor(input: CardInput) {
  const canvas = CANVASES[input.layout];
  const p = input.palette;
  const s = canvas.scale;

  const ctx: Ctx = {
    stats: input.stats,
    scored: input.scored,
    palette: p,
    handle: input.handle,
    styleName: input.styleName,
    blurb: input.blurb,
    quips: input.quips.slice(0, canvas.quips),
    cost: input.cost,
    trend: input.trend,
    scale: s,
  };

  const rows = manifestFor(input.layout, input.detail).map((names) =>
    row(
      { width: "100%", gap: Math.round(14 * s), flexShrink: 0 },
      ...names.map((name) => {
        const block = BLOCKS[name];
        if (!block) throw new Error(`unknown block "${name}"`);
        return block(ctx);
      }),
    ),
  );

  return col(
    {
      width: canvas.width,
      backgroundColor: p.base,
      fontFamily: JB,
      // Set only when the canvas is fixed. Left off, satori sizes to content,
      // which is how the overflow check measures a combo.
      ...(input.measure ? {} : { height: canvas.height }),
    },
    chrome(ctx, input),
    col(
      {
        flex: 1,
        width: "100%",
        gap: Math.round(18 * s),
        padding: `${Math.round(20 * s)}px ${Math.round(20 * s)}px ${Math.round(16 * s)}px`,
        // Centred, not space-between. Spreading the slack put a 400px hole in the
        // middle of every `min` layout.
        justifyContent: "center",
      },
      ...rows,
    ),
    text("runs entirely on your machine · nothing uploaded", {
      fontSize: Math.round(LABEL * 0.85 * s),
      color: p.muted,
      alignSelf: "center",
      paddingBottom: Math.round(18 * s),
      flexShrink: 0,
    }),
  );
}

let fontCache: Awaited<ReturnType<typeof loadFonts>> | null = null;

async function loadFonts() {
  const assets = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");
  const [pixel, mono, monoBold] = await Promise.all([
    readFile(join(assets, "PressStart2P-Regular.ttf")),
    readFile(join(assets, "JetBrainsMono-Regular.ttf")),
    readFile(join(assets, "JetBrainsMono-Bold.ttf")),
  ]);
  return [
    { name: PS, data: pixel, weight: 400 as const, style: "normal" as const },
    { name: JB, data: mono, weight: 400 as const, style: "normal" as const },
    { name: JB, data: monoBold, weight: 700 as const, style: "normal" as const },
  ];
}

/** satori emits the SVG; resvg only rasterises it, so SVG is the cheaper output. */
export async function renderSvg(input: CardInput): Promise<string> {
  fontCache ??= await loadFonts();
  const canvas = CANVASES[input.layout];
  return satori(layoutFor(input), {
    width: canvas.width,
    height: canvas.height,
    fonts: fontCache,
    // Glyphs become paths, so the card renders the same on a machine that has
    // neither font installed. That is the whole point of shipping an image.
    embedFont: true,
  });
}

export async function renderPng(input: CardInput): Promise<Buffer> {
  const svg = await renderSvg(input);
  const { width } = CANVASES[input.layout];
  return Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng());
}

/**
 * Height this combo actually wants. satori clips silently, so the only way to
 * know a block fell off the bottom is to render once without a fixed height and
 * compare. Used by the check, never by a real run.
 */
export async function measureHeight(input: CardInput): Promise<number> {
  fontCache ??= await loadFonts();
  const canvas = CANVASES[input.layout];
  const svg = await satori({ ...layoutFor({ ...input, measure: true }) }, {
    width: canvas.width,
    fonts: fontCache,
  });
  return Number(svg.match(/height="(\d+(?:\.\d+)?)"/)?.[1] ?? 0);
}
