#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { createInterface } from "node:readline";
import { renderPng, renderSvg } from "./card.ts";
import { spend } from "./ccusage.ts";
import { templated, viaClaude, type Blurb } from "./blurb.ts";
import { resolveHandle } from "./handle.ts";
import { historyPath, previous, readHistory, snapshot, writeHistory } from "./history.ts";
import { DETAILS, LAYOUTS, type DetailName, type LayoutName } from "./layouts.ts";
import { collect } from "./parse.ts";
import { quips } from "./quips.ts";
import { asJson, report } from "./report.ts";
import { score } from "./score.ts";
import { resolveTheme, tierFor } from "./themes.ts";

const HELP = `agent-wrapped — your Claude Code stats as a shareable card

usage
  npx @nitrimandylis/agent-wrapped [options]

options
  --layout <l>      wide | square | story          (default: square)
  --detail <d>      min | std | full               (default: std)
  --format <f>      png | svg | both               (default: png)
  --all             write every layout x detail combo to a directory
  --deep            also read up to 50 of your prompts for a sharper blurb
                    (default: only Claude's own session titles)
  --theme <t>       violet | blue | green | yellow | orange | magenta
                    or a path to a swatch-style palette.toml
                    (default: picked by your score)
  --days <n>        window size, default 30 (Claude Code keeps about 30)
  --handle <name>   name on the card, default your GitHub login when gh is
                    set up, otherwise your system username
  --out <path>      output file, or directory with --all
  --json            print the full stats and score breakdown, write nothing
  --no-history      skip the monthly snapshot in ~/.agent-wrapped
  --yes             skip the review step and write immediately
  -h, --help        this

Claude Code prunes transcripts at about 30 days, so a single run only ever sees
the last month. agent-wrapped keeps one small snapshot per month in
~/.agent-wrapped/history.json so a real year in review becomes possible later.
It stores counts only, never your prompts. --no-history turns it off.

Everything runs locally. The only thing that leaves this process is the blurb
prompt, which goes to your own \`claude\` CLI. Nothing is uploaded.`;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const flag = (name: string) => process.argv.includes(`--${name}`);

/** Reject a bad --layout/--detail up front rather than throwing from the renderer. */
function pick<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const value = arg(name);
  if (value === undefined) return fallback;
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`unknown ${name} "${value}" — use one of ${allowed.join(", ")}`);
  }
  return value as T;
}

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return true; // piped or CI: nothing to review against
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
  rl.close();
  return !["n", "no", "q"].includes(answer.trim().toLowerCase());
}

async function write(input: any, format: "png" | "svg", path: string): Promise<void> {
  const data = format === "svg" ? await renderSvg(input) : await renderPng(input);
  await writeFile(path, data);
}

async function main() {
  if (flag("help") || process.argv.includes("-h")) {
    console.log(HELP);
    return;
  }

  const days = Number(arg("days") ?? 30);
  if (!Number.isFinite(days) || days < 1) throw new Error(`--days must be a positive number`);

  const layout = pick<LayoutName>("layout", LAYOUTS, "square");
  const detail = pick<DetailName>("detail", DETAILS, "std");
  const format = pick("format", ["png", "svg", "both"] as const, "png");
  const deep = flag("deep");
  const handle = await resolveHandle(arg("handle"));

  process.stderr.write("reading ~/.claude/projects ...\n");
  const stats = await collect(days);
  if (stats.sessions === 0) {
    console.error(`No Claude Code sessions found in the last ${days} days.`);
    process.exit(1);
  }

  const scored = score(stats);
  const money = await spend(days);
  const palette = arg("theme") ? await resolveTheme(arg("theme")!) : tierFor(scored.total);
  const lines = quips(stats, 5);

  const month = stats.until.toISOString().slice(0, 7);
  const history = await readHistory();
  const last = previous(history, month);

  process.stderr.write(
    deep ? "asking your local claude (reading prompts) ...\n" : "asking your local claude ...\n",
  );
  const blurb: Blurb = (await viaClaude(stats, scored, lines, deep)) ?? templated(stats, scored);

  const common = {
    stats,
    scored,
    quips: lines,
    styleName: blurb.styleName,
    blurb: blurb.text,
    blurbSource: blurb.source,
    cost: money?.cost ?? null,
    previous: last,
    paletteName: palette.name,
    handle,
  };

  if (flag("json")) {
    console.log(JSON.stringify(asJson(common), null, 2));
    return;
  }

  // Review before anything is written, since this image is meant to be posted.
  console.error(report(common));

  if (!flag("yes") && !(await confirm("  write it? [Y/n] "))) {
    console.error("  nothing written.");
    return;
  }

  const card = {
    stats,
    scored,
    palette,
    handle: handle.name,
    styleName: blurb.styleName,
    blurb: blurb.text,
    quips: lines,
    cost: money?.cost ?? null,
    trend: last === null ? null : scored.total - last.score,
  };
  const formats: ("png" | "svg")[] = format === "both" ? ["png", "svg"] : [format];
  const stamp = month;

  if (flag("all")) {
    const dir = arg("out") ?? `./agent-wrapped-${stamp}`;
    await mkdir(dir, { recursive: true });
    for (const l of LAYOUTS) {
      for (const d of DETAILS) {
        for (const ext of formats) {
          const path = join(dir, `${l}-${d}.${ext}`);
          await write({ ...card, layout: l, detail: d }, ext, path);
          console.error(`  wrote ${path}`);
        }
      }
    }
  } else {
    for (const ext of formats) {
      // An explicit --out keeps its name; only the default encodes the combo.
      const given = arg("out");
      const path =
        given && formats.length === 1
          ? given
          : given
            ? given.replace(new RegExp(`${extname(given)}$`), `.${ext}`)
            : `./agent-wrapped-${stamp}-${layout}-${detail}.${ext}`;
      await write({ ...card, layout, detail }, ext, path);
      console.error(`  wrote ${path}`);
    }
  }

  if (!flag("no-history")) {
    await writeHistory(snapshot(stats, scored));
    console.error(`  snapshot saved to ${historyPath()}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
