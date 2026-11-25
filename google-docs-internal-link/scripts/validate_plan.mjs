#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { validatePlan } from "./plan_links.mjs";
import { validateApplicationPlan } from "./resolve_google_conflicts.mjs";

const args = process.argv.slice(2);
const forApplication = args.includes("--for-application");
const path = args.find((value) => !value.startsWith("--"));
if (!path || args.some((value) => value.startsWith("--") && value !== "--for-application")) {
  process.stderr.write("Usage: validate_plan.mjs [--for-application] <plan.json>\n");
  process.exit(2);
}

try {
  const plan = JSON.parse(readFileSync(resolve(path), "utf8"));
  const result = forApplication ? validateApplicationPlan(plan) : validatePlan(plan);
  for (const warning of result.warnings) process.stdout.write(`WARN: ${warning}\n`);
  if (!result.ok) {
    for (const error of result.errors) process.stderr.write(`FAIL: ${error}\n`);
    process.exit(1);
  }
  process.stdout.write(`PASS: ${plan.placements.length} placements validated${forApplication ? " for application" : ""}\n`);
} catch (error) {
  process.stderr.write(`FAIL: ${error.stack || error.message}\n`);
  process.exit(1);
}
