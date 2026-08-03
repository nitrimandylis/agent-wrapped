import { readFile } from "node:fs/promises";

export type Palette = {
  name: string;
  base: string;
  panel: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
};

/** Shared shell across every tier, so only the accent moves. */
const SHELL = {
  base: "#0b0e14",
  panel: "#0f131b",
  border: "#1c2230",
  text: "#e6edf3",
  muted: "#7d8794",
};

/**
 * Cold to hot: the accent is the score. Ordered low to high, and the card
 * draws this same list as the swatch column down the right edge.
 */
export const TIERS: { min: number; palette: Palette }[] = [
  { min: 0, palette: { ...SHELL, name: "violet", accent: "#a06cff" } },
  { min: 50, palette: { ...SHELL, name: "blue", accent: "#4d8cff" } },
  { min: 65, palette: { ...SHELL, name: "green", accent: "#3fd07a" } },
  { min: 75, palette: { ...SHELL, name: "yellow", accent: "#f5c518" } },
  { min: 85, palette: { ...SHELL, name: "orange", accent: "#f5871f" } },
  { min: 95, palette: { ...SHELL, name: "magenta", accent: "#ff3ca8" } },
];

export function tierFor(score: number): Palette {
  let chosen = TIERS[0].palette;
  for (const tier of TIERS) if (score >= tier.min) chosen = tier.palette;
  return chosen;
}

export function tierIndex(palette: Palette): number {
  return TIERS.findIndex((t) => t.palette.name === palette.name);
}

/**
 * Read a swatch-style palette.toml. Only the [roles] block matters, and the
 * format is flat `key = "#hex"`, so a full TOML parser would be overkill.
 * ponytail: hand-rolled reader, swap for a real parser if the format grows.
 */
export async function paletteFromToml(path: string): Promise<Palette> {
  const text = await readFile(path, "utf8");
  const roles: Record<string, string> = {};
  let inRoles = false;

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inRoles = line === "[roles]";
      continue;
    }
    if (!inRoles || !line || line.startsWith("#")) continue;
    const match = line.match(/^(\w+)\s*=\s*"([^"]+)"/);
    if (match) roles[match[1]] = match[2];
  }

  if (!roles.base || !roles.accent) {
    throw new Error(`${path}: [roles] needs at least base and accent`);
  }

  return {
    name: path,
    base: roles.base,
    panel: roles.surface ?? roles.base,
    border: roles.overlay ?? roles.surface ?? roles.base,
    text: roles.text ?? "#e6edf3",
    muted: roles.muted ?? "#7d8794",
    accent: roles.accent,
  };
}

/** `--theme` takes a built-in colour name or a path to a palette.toml. */
export async function resolveTheme(value: string): Promise<Palette> {
  const builtin = TIERS.find((t) => t.palette.name === value);
  if (builtin) return builtin.palette;
  if (value.endsWith(".toml")) return paletteFromToml(value);
  throw new Error(
    `unknown theme "${value}" — use one of ${TIERS.map((t) => t.palette.name).join(", ")} or a path to a palette.toml`,
  );
}
