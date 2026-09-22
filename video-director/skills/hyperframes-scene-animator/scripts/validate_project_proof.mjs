#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const projectArg = argv.find((item) => !item.startsWith("--"));
if (!projectArg) {
  console.error("Usage: node validate_project_proof.mjs <project-dir> [review/proof-manifest-v1.json] [--promotion-check]");
  process.exit(2);
}
const projectDir = path.resolve(projectArg);
const remaining = argv.slice(1);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const canonicalScripts = path.resolve(scriptDir, "../../talking-head-hyperframes/assets/hyperframes-project/scripts");
const digest = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
for (const name of fs.readdirSync(canonicalScripts).filter((item) => item.endsWith(".mjs")).sort()) {
  const canonical = path.join(canonicalScripts, name);
  const local = path.join(projectDir, "scripts", name);
  if (!fs.existsSync(local) || fs.lstatSync(local).isSymbolicLink() || digest(local) !== digest(canonical)) {
    console.error(`[TRUSTED_PROJECT_BUNDLE] ${name} is missing, linked, or differs from the factory-owned validator bundle`);
    process.exit(1);
  }
}
const validator = path.join(canonicalScripts, "validate-project-proof.mjs");
const result = spawnSync(process.execPath, [validator, projectDir, ...remaining], { cwd: projectDir, encoding: "utf8", timeout: 300_000, maxBuffer: 20 * 1024 * 1024 });
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
if (result.error) {
  console.error(`Project-local proof validator could not run: ${result.error.message}`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
