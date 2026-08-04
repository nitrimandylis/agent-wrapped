/**
 * A canvas plus a list of rows. Each row is a list of block names sharing the
 * width, so a combo is data rather than a layout function, and adding a block
 * to one canvas can never break another.
 */
export type LayoutName = "wide" | "square" | "story";
export type DetailName = "min" | "std" | "full";

export type Canvas = {
  width: number;
  height: number;
  /** Everything in blocks.ts is sized off this. 1 is the 1200px design. */
  scale: number;
  /** How many quip lines fit before the row starts pushing other blocks out. */
  quips: number;
};

export const CANVASES: Record<LayoutName, Canvas> = {
  // 16:9, the aspect a feed shows without cropping.
  wide: { width: 1200, height: 675, scale: 0.82, quips: 2 },
  square: { width: 1200, height: 1200, scale: 1, quips: 3 },
  // 9:16 for stories, tall enough to take every block at once.
  story: { width: 1080, height: 1920, scale: 1.05, quips: 5 },
};

export const LAYOUTS: LayoutName[] = ["wide", "square", "story"];
export const DETAILS: DetailName[] = ["min", "std", "full"];

/**
 * Rows, top to bottom. Blocks in the same row share the width evenly.
 * ponytail: hand-tuned per combo on purpose. An auto-packer would have to guess
 * what belongs next to what, and there are only nine of these.
 */
export const MANIFESTS: Record<string, string[][]> = {
  "wide.min": [["score"], ["blurb"]],
  "wide.std": [["score"], ["blurb"], ["quips"], ["tokens", "sessions", "agents"]],
  // Two columns, because stacking axes under the clock overflows 675 by ~30px.
  "wide.full": [
    ["score"],
    ["blurb"],
    ["axes", "clock"],
    ["tokens", "sessions", "agents", "cost"],
  ],

  "square.min": [["score"], ["blurb"], ["clock"]],
  "square.std": [
    ["score"],
    ["blurb"],
    ["quips"],
    ["tokens", "sessions", "cost"],
    ["agents", "projects"],
    ["clock"],
  ],
  "square.full": [
    ["score"],
    ["axes"],
    ["blurb"],
    ["quips"],
    ["tokens", "sessions", "agents", "cost"],
    ["clock"],
    ["models", "tools"],
  ],

  "story.min": [["score"], ["blurb"], ["clock"], ["tokens", "sessions"]],
  "story.std": [
    ["score"],
    ["blurb"],
    ["quips"],
    ["tokens", "sessions", "cost"],
    ["agents", "projects"],
    ["clock"],
    ["split"],
  ],
  "story.full": [
    ["score"],
    ["axes"],
    ["blurb"],
    ["quips"],
    ["tokens", "sessions", "cost"],
    ["agents", "projects"],
    ["clock"],
    ["split"],
    ["models", "tools"],
    ["agentTypes", "headless"],
  ],
};

export function manifestFor(layout: LayoutName, detail: DetailName): string[][] {
  const key = `${layout}.${detail}`;
  const manifest = MANIFESTS[key];
  if (!manifest) throw new Error(`no manifest for ${key}`);
  return manifest;
}
