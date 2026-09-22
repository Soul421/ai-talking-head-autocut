#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(process.argv[2] ?? process.cwd());
const canonicalScripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../assets/hyperframes-project/scripts");
const digest = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
for (const name of fs.readdirSync(canonicalScripts).filter((item) => item.endsWith(".mjs")).sort()) {
  const canonical = path.join(canonicalScripts, name);
  const local = path.join(projectDir, "scripts", name);
  if (!fs.existsSync(local) || fs.lstatSync(local).isSymbolicLink() || digest(local) !== digest(canonical)) {
    console.error(`[TRUSTED_PROJECT_BUNDLE] ${name} is missing, linked, or differs from the factory-owned validator bundle`);
    process.exit(1);
  }
}
const validator = path.join(canonicalScripts, "check-fixed-stage.mjs");
const result = spawnSync(process.execPath, [validator, projectDir], {
  cwd: projectDir,
  encoding: "utf8",
  timeout: 120_000,
});

if (result.error) {
  console.error(`[fixed-stage] FAIL: validator could not run: ${result.error.message}`);
  process.exitCode = 1;
} else {
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  process.exitCode = result.status ?? 1;
}
