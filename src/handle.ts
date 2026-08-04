import { readFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";

export type Handle = { name: string; source: "flag" | "github" | "system" };

/**
 * `gh` writes the logged-in login to its own config, so this reads a file rather
 * than calling the GitHub API. A network call would be a nicer lookup and would
 * also make "nothing leaves your machine" false, which is the one claim this
 * tool cannot afford to break.
 *
 * ponytail: two-line YAML reader. The file is four keys deep and gh has not
 * changed its shape in years; swap for a parser if that stops being true.
 */
async function fromGh(): Promise<string | null> {
  const dir = process.env.GH_CONFIG_DIR ?? join(homedir(), ".config", "gh");

  let text: string;
  try {
    text = await readFile(join(dir, "hosts.yml"), "utf8");
  } catch {
    return null; // gh not installed, or never logged in
  }

  // Only the top-level `user:` of the first host block. The nested `users:` map
  // lists every account ever authenticated, including ones since logged out.
  const match = text.match(/^\s{2,}user:\s*(\S+)\s*$/m);
  return match ? match[1] : null;
}

/** `--handle`, else the GitHub login gh already knows, else the OS account name. */
export async function resolveHandle(flag: string | undefined): Promise<Handle> {
  if (flag) return { name: flag, source: "flag" };

  const github = await fromGh();
  if (github) return { name: github, source: "github" };

  return { name: userInfo().username, source: "system" };
}
