import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function serverEnv(name: string) {
  if (process.env[name]) return process.env[name];
  try {
    const content = readFileSync(join(process.cwd(), ".env.local"), "utf8");
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return content.match(new RegExp(`^${escaped}=(.+)$`, "m"))?.[1]?.trim().replace(/^['"]|['"]$/g, "");
  } catch {
    return undefined;
  }
}
