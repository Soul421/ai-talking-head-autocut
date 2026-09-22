#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectArg = process.argv[2];
if (!projectArg || process.argv.length !== 3) {
  console.error("Usage: node verify_project_bundle.mjs <generated-project-dir>");
  process.exit(2);
}
const requested = path.resolve(projectArg);
const rootInfo = fs.lstatSync(requested);
if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error("Generated project root must be a real directory");
const projectDir = fs.realpathSync(requested);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const canonicalRoot = path.resolve(scriptDir, "../../talking-head-hyperframes/assets/hyperframes-project");
const canonicalScripts = path.join(canonicalRoot, "scripts");
const digest = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

for (const name of fs.readdirSync(canonicalScripts).filter((item) => item.endsWith(".mjs")).sort()) {
  const canonical = path.join(canonicalScripts, name);
  const local = path.join(projectDir, "scripts", name);
  if (!fs.existsSync(local) || fs.lstatSync(local).isSymbolicLink() || digest(local) !== digest(canonical)) {
    throw new Error(`[TRUSTED_PROJECT_BUNDLE] ${name} is missing, linked, or differs from the factory-owned bundle`);
  }
}

const canonicalPackage = JSON.parse(fs.readFileSync(path.join(canonicalRoot, "package.json"), "utf8"));
const projectPackage = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8"));
const npmrc = path.join(projectDir, ".npmrc");
if (!fs.existsSync(npmrc) || fs.lstatSync(npmrc).isSymbolicLink() || fs.readFileSync(npmrc, "utf8") !== "ignore-scripts=true\n") {
  throw new Error("[TRUSTED_PROJECT_BUNDLE] .npmrc must contain only ignore-scripts=true so npm cannot run project-controlled pre/post hooks");
}
const projectNodeModules = path.join(projectDir, "node_modules");
if (fs.existsSync(projectNodeModules)) {
  throw new Error(
    "[TRUSTED_PROJECT_BUNDLE] project-local node_modules is forbidden; helper dependencies must come from the isolated factory-pinned bootstrap",
  );
}
for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies", "bundledDependencies"]) {
  if (JSON.stringify(projectPackage[field] ?? null) !== JSON.stringify(canonicalPackage[field] ?? null)) {
    throw new Error(`[TRUSTED_PROJECT_BUNDLE] package ${field} differs from the factory-owned dependency boundary`);
  }
}
const canonicalNames = Object.keys(canonicalPackage.scripts).sort();
const projectNames = Object.keys(projectPackage.scripts ?? {}).sort();
if (JSON.stringify(projectNames) !== JSON.stringify(canonicalNames)) {
  throw new Error("[TRUSTED_PROJECT_BUNDLE] package scripts must have exactly the factory-owned names; extra pre/post hooks are forbidden");
}
const dynamic = {
  inspect: /^npx --yes hyperframes@0\.7\.65 inspect --at \d+(?:\.\d+)?(?:,\d+(?:\.\d+)?)* --strict$/,
  "snapshot:stage": /^npx --yes hyperframes@0\.7\.65 snapshot --at \d+(?:\.\d+)?(?:,\d+(?:\.\d+)?)* --no-end --output snapshots\/stage --describe false$/,
  "render:draft": /^npx --yes hyperframes@0\.7\.65 render --quality draft --fps 30 --resolution 1080p --output renders\/fixed-stage-draft\.mp4$/,
};
for (const [name, command] of Object.entries(canonicalPackage.scripts)) {
  if (dynamic[name]) {
    if (!dynamic[name].test(projectPackage.scripts?.[name] ?? "")) throw new Error(`[TRUSTED_PROJECT_BUNDLE] package script ${name} is not the factory-owned duration-specific command`);
  } else if (projectPackage.scripts?.[name] !== command) {
    throw new Error(`[TRUSTED_PROJECT_BUNDLE] package script ${name} differs from the factory-owned command`);
  }
}
for (const [name, command] of Object.entries(projectPackage.scripts ?? {})) {
  if (typeof command !== "string" || /[;&|`$<>\n\r]/.test(command)) throw new Error(`[TRUSTED_PROJECT_BUNDLE] unsafe package script ${name}`);
}
console.log(`PASS trusted generated-project bundle (${fs.readdirSync(canonicalScripts).filter((item) => item.endsWith(".mjs")).length} authenticated scripts)`);
