#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { createInterface } from "node:readline";
import { render } from "./card.ts";
import { spend } from "./ccusage.ts";
import { templated, viaClaude, type Blurb } from "./blurb.ts";
import { collect, peakHour } from "./parse.ts";
import { score } from "./score.ts";
import { resolveTheme, tierFor } from "./themes.ts";

const HELP = `agent-wrapped — your Claude Code stats as a shareable PNG

usage
  npx agent-wrapped [options]

options
  --deep            also read up to 50 of your prompts for a sharper blurb
                    (default: only Claude's own session titles)
  --theme <t>       violet | blue | green | yellow | orange | magenta
                    or a path to a swatch-style palette.toml
                    (default: picked by your score)
  --days <n>        window size, default 30 (Claude Code keeps about 30)
  --handle <name>   name on the card, default your username
  --out <path>      output file, default ./agent-wrapped-<YYYY-MM>.png
  --yes             skip the review step and write immediately
  -h, --help        this

Everything runs locally. The only thing that leaves this process is the
blurb prompt, which goes to your own \`claude\` CLI. Nothing is uploaded.`;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return true; // piped or CI: nothing to review against
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
  rl.close();
  return !["n", "no", "q"].includes(answer.trim().toLowerCase());
}

async function main() {
  if (flag("help") || process.argv.includes("-h")) {
    console.log(HELP);
    return;
  }

  const days = Number(arg("days") ?? 30);
  const deep = flag("deep");
  const handle = arg("handle") ?? userInfo().username;

  process.stderr.write("reading ~/.claude/projects ...\n");
  const stats = await collect(days);
  if (stats.sessions === 0) {
    console.error("No Claude Code sessions found in the last " + days + " days.");
    process.exit(1);
  }

  const scored = score(stats);
  const money = await spend(days);
  const palette = arg("theme") ? await resolveTheme(arg("theme")!) : tierFor(scored.total);

  process.stderr.write(
    deep ? "asking your local claude (reading prompts) ...\n" : "asking your local claude ...\n",
  );
  let blurb: Blurb = (await viaClaude(stats, scored, deep)) ?? templated(stats, scored);

  // Review before anything is written, since this image is meant to be posted.
  const peak = String(peakHour(stats.hourly)).padStart(2, "0");
  console.error("");
  console.error(`  score      ${scored.total}/100  (${scored.archetype.toLowerCase()}, ${palette.name})`);
  for (const axis of scored.axes) {
    console.error(`    ${axis.label.padEnd(14)} ${String(axis.points).padStart(4)}/20   ${axis.detail}`);
  }
  console.error(`  peak       ${peak}:00`);
  console.error(`  style      ${blurb.styleName}`);
  console.error(`  blurb      ${blurb.text}`);
  console.error(`  source     ${blurb.source === "claude" ? "your local claude" : "template (claude unavailable)"}`);
  console.error("");

  if (!flag("yes") && !(await confirm("  write the png? [Y/n] "))) {
    console.error("  nothing written.");
    return;
  }

  const stamp = new Date().toISOString().slice(0, 7);
  const out = arg("out") ?? `./agent-wrapped-${stamp}.png`;
  const png = await render({
    stats,
    scored,
    palette,
    handle,
    styleName: blurb.styleName,
    blurb: blurb.text,
    cost: money?.cost ?? null,
  });
  await writeFile(out, png);
  console.error(`  wrote ${out}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
