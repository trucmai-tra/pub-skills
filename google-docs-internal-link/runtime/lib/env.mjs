import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const rootEnvPath = resolve(repoRoot, ".env");

export function loadLocalEnv() {
  if (process.env.VERCEL || !existsSync(rootEnvPath)) return;
  const parsed = parseEnv(readFileSync(rootEnvPath, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }

  mapScopedEnv("SUPABASE_URL", "SUPABASE_URL_INTERNAL_LINKING");
  mapScopedEnv("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY_INTERNAL_LINKING");
}

function mapScopedEnv(genericKey, scopedKey) {
  if (process.env[genericKey] === undefined && process.env[scopedKey] !== undefined) {
    process.env[genericKey] = process.env[scopedKey];
  }
}

function parseEnv(raw) {
  const out = {};
  for (const line of String(raw || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}
