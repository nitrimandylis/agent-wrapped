---
name: agent-wrapped-cli
description: Drive the agent-wrapped CLI — turns the last ~30 days of Claude Code transcripts into a scored, shareable PNG or SVG card, entirely offline. Use whenever the user wants their Claude Code stats, a wrapped or year-in-review card, asks how much they have used Claude Code or what it would have cost at API rates, mentions agent-wrapped, or wants the score, archetype, or usage breakdown explained.
---

# agent-wrapped

`agent-wrapped` reads `~/.claude/projects/**/*.jsonl`, scores the last 30 days on five axes, and renders
a card. Everything is local. Nothing is uploaded.

Unlike Nick's other CLIs this is **not** a compiled Bun binary. It ships to npm and runs through `npx`,
because `@resvg/resvg-js` is a native addon with per-platform prebuilds that `bun build --compile`
cannot bundle. In this repo, run it with `bun src/cli.ts`.

```bash
npx agent-wrapped                 # published
bun src/cli.ts                    # in the repo
node dist/cli.js                  # after `bun run build`
```

## Reading, always safe

```bash
bun src/cli.ts --json             # every stat and the full score breakdown, writes no files
bun run check                     # parse invariants + all 9 layouts measured for overflow
```

`--json` still calls `claude` for the blurb (see below) but writes nothing to disk. It is the right
command when you want the numbers rather than an image.

## Rendering

```bash
bun src/cli.ts --yes                                   # square/std png, the default
bun src/cli.ts --yes --layout wide --detail full
bun src/cli.ts --yes --format svg
bun src/cli.ts --yes --all --out ./sheet               # all 9 combos to a directory
```

`--layout wide|square|story` × `--detail min|std|full` is 9 combinations, each a hand-tuned manifest in
`src/layouts.ts`. `--format png|svg|both`. SVG is self-contained paths, so it renders identically on a
machine with neither font installed.

Other flags: `--days <n>`, `--theme <name|palette.toml>`, `--handle <name>`, `--out <path>`,
`--no-history`, `--deep`.

## Things that will bite you

- **It spawns `claude -p` as a subprocess, with a 120-second timeout.** Running this from inside a
  Claude Code session starts a second Claude. Expect the command to sit for 30–120s and budget for it.
  If `claude` is not on PATH it falls back to a templated blurb and still succeeds.
- **Without `--yes` it prompts `write it? [Y/n]`.** The prompt is skipped when stdin is not a TTY, so a
  piped call will not hang, but pass `--yes` explicitly when you invoke it yourself.
- **It writes `~/.agent-wrapped/history.json` on every run** unless you pass `--no-history`. One
  snapshot per month, overwritten on re-run. Use `--no-history` for throwaway or test runs so you do
  not overwrite the real month with a `--days 3` window.
- **`--deep` sends up to 50 verbatim prompts to the local `claude`.** The default sends only counts,
  single words, and Claude's own session titles. Do not add `--deep` on the user's behalf.
- **It reads the transcript of the session it is running in.** Numbers move slightly between two runs
  minutes apart. That is correct, not a bug.
- Parsing is ~3–5s over ~10k transcript files. The first run in a session feels slow; it is not stuck.
- Requires Node ≥ 20. `--days` above ~30 mostly returns nothing new: Claude Code prunes transcripts at
  about 30 days, which is why the history file exists.

## Explaining the score

Five axes worth 20 each: volume, consistency, depth, breadth, orchestration. The terminal report prints
each axis with its raw value, ceiling, curve, and what one more point would cost, so never guess at the
maths — run it and read it back.

The archetype is named from the **top two** axes, not the top one, giving 10 combinations. Naming from a
single axis made everyone `METRONOME`, because consistency is linear against active days and anyone who
shows up daily maxes it.

`sessions` on the card means **interactive** sessions only. Files with no `mode`/`permission-mode` entry
and fewer than two user prompts are headless `claude -p` runs — hooks, scripts, other tools. On a
machine with automation the headless count is 10–20× the interactive one, and conflating them made the
old card claim 10,637 sessions averaging 73 seconds each.
