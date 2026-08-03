/**
 * Smallest runnable check: parse real transcripts and assert the numbers are
 * sane, then print them next to ccusage so token counts can be eyeballed.
 * Run with `bun run check`.
 */
import { collect, peakHour } from "./parse.ts";

const started = Date.now();
const s = await collect(30);
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

const fmt = (n: number) =>
  n >= 1e9 ? (n / 1e9).toFixed(1) + "B" : n >= 1e6 ? (n / 1e6).toFixed(0) + "M" : String(n);

console.log(`parsed in ${elapsed}s`);
console.log(`window       ${s.since.toISOString().slice(0, 10)} .. ${s.until.toISOString().slice(0, 10)}`);
console.log(`tokens       ${fmt(s.tokens)}`);
console.log(`sessions     ${s.sessions}`);
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

// These are the invariants the card depends on. If any trips, the card lies.
const fail = (msg: string) => {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
};

if (s.sessions === 0) fail("no sessions found in window");
if (s.tokens <= 0) fail("no tokens counted");
if (s.activeDays > s.days) fail(`active days ${s.activeDays} exceeds window ${s.days}`);
if (s.avgAgents < 1) fail(`avgAgents ${s.avgAgents} below 1 (every session has at least itself)`);
if (s.hourly.reduce((a, b) => a + b, 0) !== s.weekdayMsgs + s.weekendMsgs) {
  fail("hourly histogram and weekday/weekend split disagree on message count");
}
if (s.activeMs / 3.6e6 > s.days * 24) fail("active hours exceed wall-clock hours in window");

console.log("\nall invariants hold");
