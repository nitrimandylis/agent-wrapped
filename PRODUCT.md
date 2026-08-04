# agent-wrapped

## What it is

A CLI that turns the last ~30 days of Claude Code transcripts into a scored, shareable card. Reads
`~/.claude/projects/**/*.jsonl`, scores five axes, renders PNG or SVG. No API key, no account, no
network call.

Ships to npm and runs through `npx`. Deliberately not a compiled Bun binary like the rest of the CLIs
here: `@resvg/resvg-js` is a native addon with per-platform prebuilds that `bun build --compile` cannot
bundle, and this is a once-a-month tool nobody wants to install permanently.

## Why it exists

`npx standout` (standout.work, YC P26) generated the same kind of card in Jul/Aug 2026. An audit of its
bundled `dist/cli.js` v0.7.1 found it POSTing up to 500 paired prompt/reply exchanges as real text,
reading Codex, Cursor, settings, skills and commands directories alongside the transcripts, redacting
only credential-shaped strings, and silently installing a launchd agent to re-run itself monthly.

None of that is needed to draw a PNG. Every number is computable locally. The rule that came out of it:
no marketing or recruiting CLI gets to read `~/.claude`. Local, OSS, inspectable, or it does not run.

## Locked decisions

- **Scope is Claude Code only.** Codex and Cursor support is a v2 PR, deliberately untested rather than
  shipped blind.
- **Score is a fixed rubric**, 5 axes × 20: volume, consistency, depth, breadth, orchestration. Volume
  is capped at a fifth so the card is not a spending leaderboard. Log curves on volume, breadth and
  orchestration; linear on consistency and depth.
- **Archetype comes from the top two axes**, 10 named combinations. Single-axis naming made every daily
  user a METRONOME, since consistency is linear against active days.
- **Sessions are split interactive vs headless.** A transcript with no `mode`/`permission-mode` entry
  and fewer than two user prompts was a script calling `claude -p`. Conflating them claimed 10,637
  sessions averaging 73 seconds.
- **Quips are computed, never generated**, so the card stays funny with no `claude` on PATH. They also
  feed the LLM prompt as raw material.
- **Blurb runs through the user's own `claude -p`.** Default diet is aggregates, single words and
  Claude's own session titles; `--deep` gates verbatim prompts. Terminal review gate before any write.
- **9 layouts** = `wide|square|story` × `min|std|full`, built as a block registry plus 9 manifests, not
  9 layout functions. Every block claims width with `flex: 1`; `width: "100%"` silently pushes the
  second block in a row off the card.
- **SVG is glyph paths** (`embedFont: true`), so it renders identically without the fonts installed.
- **History**: one snapshot per month in `~/.agent-wrapped/history.json`, counts only, no prompts, no
  titles, no project names. Reverses the original no-state-on-disk decision, because Claude Code prunes
  at ~30 days and there is no other route to a real annual card.
- **Cost reads "at API rates"**, never "spent". `ccusage --json --offline`, so pricing stays maintained
  upstream with no runtime network call.
- **`check.ts` is the whole test suite**: parse invariants, every block reachable from some manifest,
  and all 9 layouts measured with height unset to catch silent satori clipping.

## Where it's headed

Near term:

- Publish to npm. Repo is live at github.com/nitrimandylis/agent-wrapped; the package is not yet pushed.
- A real annual card, once `history.json` has enough months in it. The snapshot format was designed for
  this and nothing else consumes it yet.
- Month-on-month trend is rendered on the card already, but has only been exercised against a
  hand-written second month.

Deliberately not doing:

- **Percentiles.** They need a server holding everyone else's numbers, which is the one thing this
  refuses to be.
- **Any hosted component**, account, or telemetry.
- **Scheduling itself.** For the obvious reason.

Unknowns worth watching:

- Ceilings are calibrated against n=1. Volume tops out at 6B tokens/30d, breadth at 100 projects,
  orchestration at 400 agents. No population data exists to justify any of them, and raising them is
  guesswork until other people run it.
- The interactive/headless classifier leans on `mode` and `permission-mode` entries. If Claude Code
  stops writing those, a one-turn interactive session reads as headless.
