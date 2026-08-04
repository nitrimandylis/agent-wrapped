/**
 * Smallest runnable check: parse real transcripts and assert the numbers are
 * sane, then render every layout to make sure nothing falls off the bottom.
 * Run with `bun run check`.
 */
import { measureHeight } from "./card.ts";
import { CANVASES, DETAILS, LAYOUTS } from "./layouts.ts";
import { collect, peakHour } from "./parse.ts";
import { quips } from "./quips.ts";
import { score } from "./score.ts";
import { tierFor } from "./themes.ts";

const started = Date.now();
const s = await collect(30);
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

const fmt = (n: number) =>
  n >= 1e9 ? (n / 1e9).toFixed(1) + "B" : n >= 1e6 ? (n / 1e6).toFixed(0) + "M" : String(n);

console.log(`parsed in ${elapsed}s`);
console.log(`window       ${s.since.toISOString().slice(0, 10)} .. ${s.until.toISOString().slice(0, 10)}`);
console.log(`tokens       ${fmt(s.tokens)}`);
console.log(`sessions     ${s.sessions} (${s.interactive} interactive, ${s.headless} headless)`);
console.log(`hours        ${(s.activeMs / 3.6e6).toFixed(0)}h`);
console.log(`active days  ${s.activeDays}/${s.days}`);
console.log(`projects     ${s.projects.length}`);
console.log(`agents       ${s.agentsTotal} spawned, ${s.avgAgents.toFixed(1)} avg/session`);
console.log(`agent types  ${Object.entries(s.agentTypes).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}:${v}`).join("  ") || "none"}`);
console.log(`peak hour    ${String(peakHour(s.hourly)).padStart(2, "0")}:00`);
console.log(`weekday      ${Math.round((100 * s.weekdayMsgs) / (s.weekdayMsgs + s.weekendMsgs))}%`);
console.log(`titles       ${s.titles.length}`);
console.log(`prompts      ${s.prompts.length}`);
console.log(`models       ${Object.entries(s.models).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${fmt(v)}`).join("  ")}`);

const m = s.mined;
const top = (r: Record<string, number>, n: number) =>
  Object.entries(r).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k}:${v}`).join("  ") || "none";

console.log("");
console.log(`streak       ${m.longestStreak} days`);
console.log(`busiest day  ${m.busiestDay.date} (${m.busiestDay.count} messages)`);
console.log(`longest sesh ${(m.longestSessionMs / 3.6e6).toFixed(1)}h`);
console.log(`after 00:00  ${m.afterMidnight} messages`);
console.log(`tools        ${top(m.tools, 5)}`);
console.log(`bash verbs   ${top(m.bashVerbs, 5)}`);
console.log(`files        ${m.filesTouched} unique paths`);
console.log(`interrupts   ${m.interruptions}`);
console.log(`pushback     ${top(m.pushback, 6)}`);
console.log(`longest ask  ${m.longestPrompt} chars`);
console.log(`top word     "${m.topWord}" x${m.topWordCount}`);

// These are the invariants the card depends on. If any trips, the card lies.
const fail = (msg: string) => {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
};

const userMsgs = s.weekdayMsgs + s.weekendMsgs;

if (s.sessions === 0) fail("no sessions found in window");
if (s.tokens <= 0) fail("no tokens counted");
if (s.activeDays > s.days) fail(`active days ${s.activeDays} exceeds window ${s.days}`);
if (s.avgAgents < 1) fail(`avgAgents ${s.avgAgents} below 1 (every session has at least itself)`);
if (s.hourly.reduce((a, b) => a + b, 0) !== userMsgs) {
  fail("hourly histogram and weekday/weekend split disagree on message count");
}
if (s.activeMs / 3.6e6 > s.days * 24) fail("active hours exceed wall-clock hours in window");
if (s.interactive + s.headless !== s.sessions) {
  fail(`interactive ${s.interactive} + headless ${s.headless} != sessions ${s.sessions}`);
}
if (m.longestStreak > s.activeDays) {
  fail(`streak ${m.longestStreak} exceeds active days ${s.activeDays}`);
}
if (m.afterMidnight > userMsgs) fail(`after-midnight ${m.afterMidnight} exceeds messages ${userMsgs}`);
if (m.busiestDay.count > userMsgs) fail("busiest day exceeds total messages");
if (m.longestSessionMs > s.activeMs) fail("longest session exceeds total active time");

console.log("\nparse invariants hold");

/**
 * satori clips silently, so a block that doesn't fit just vanishes and the card
 * looks fine. Rendering each combo without a fixed height says what it wanted.
 */
const scored = score(s);
const lines = quips(s, 5);
const base = {
  stats: s,
  scored,
  palette: tierFor(scored.total),
  handle: "check",
  styleName: "Long-Session Specialist",
  // Worst realistic case for wrapping, since a short blurb can only fit better.
  blurb: "ships terminal tools at 2am and calls the resulting mess a design system",
  quips: lines,
  cost: 1204,
  trend: -6,
};

console.log("");
let overflowed = 0;

for (const layout of LAYOUTS) {
  for (const detail of DETAILS) {
    const wanted = await measureHeight({ ...base, layout, detail });
    const limit = CANVASES[layout].height;
    const ok = wanted <= limit;
    if (!ok) overflowed++;
    console.log(
      `  ${`${layout}/${detail}`.padEnd(14)} ${String(Math.ceil(wanted)).padStart(5)} ${ok ? "<=" : " >"} ${limit}  ${ok ? "ok" : "OVERFLOW"}`,
    );
  }
}

if (overflowed > 0) fail(`${overflowed} layout(s) overflow — drop a block or raise the canvas`);

console.log("\nall 9 layouts fit");
