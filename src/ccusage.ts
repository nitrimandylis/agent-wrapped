import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";

export type Spend = { tokens: number; cost: number };

/**
 * ccusage owns the model-to-price table so we don't have to. `--offline` uses
 * its bundled pricing, which keeps this tool free of runtime network calls.
 */
export async function spend(windowDays: number): Promise<Spend | null> {
  const since = new Date(Date.now() - windowDays * 864e5)
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, "");

  let bin: string;
  try {
    const require = createRequire(import.meta.url);
    const pkg = require.resolve("ccusage/package.json");
    bin = join(pkg, "..", "src", "cli.js");
  } catch {
    return null;
  }

  const json = await new Promise<string>((resolve) => {
    const child = spawn(
      process.execPath,
      [bin, "daily", "--json", "--offline", "--since", since],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    child.on("error", () => resolve(""));
    child.on("close", () => resolve(out));
  });

  try {
    const parsed = JSON.parse(json);
    let tokens = 0;
    let cost = 0;
    for (const row of parsed.daily ?? []) {
      tokens += row.totalTokens ?? 0;
      cost += row.totalCost ?? 0;
    }
    return { tokens, cost };
  } catch {
    return null; // ccusage changed its output shape; fall back to our own count
  }
}
