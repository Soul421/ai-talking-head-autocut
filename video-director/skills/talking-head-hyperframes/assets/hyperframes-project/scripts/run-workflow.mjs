#!/usr/bin/env node

import process from "node:process";
import { spawnSync } from "node:child_process";
import { canonicalProjectRoot, trustedExecutable } from "./project-integrity.mjs";

const workflow = process.argv[2];
const projectDir = canonicalProjectRoot(process.cwd());
const steps = {
  "check-template": [
    [process.execPath, ["scripts/check-inputs.mjs"]],
    [process.execPath, ["scripts/check-fixed-stage.mjs"]],
    ["npx", ["--yes", "hyperframes@0.7.65", "check"]],
  ],
  "proof-generate": [
    [process.execPath, ["scripts/proof-prepare.mjs"]],
    ...["inputs", "fixed-stage", "motion-contract", "runtime-adaptation", "stage", "doctor", "lint", "validate", "inspect", "check", "snapshot", "animation-map", "render", "contact-sheet", "media"].map((id) => [process.execPath, ["scripts/proof-gate.mjs", id]]),
  ],
  "proof-finalize": [
    [process.execPath, ["scripts/promote-preview.mjs"]],
  ],
};

if (!steps[workflow]) {
  console.error(`Unknown workflow ${JSON.stringify(workflow)}. Expected ${Object.keys(steps).join(", ")}`);
  process.exit(2);
}
for (const [command, args] of steps[workflow]) {
  const executable = command === process.execPath ? command : trustedExecutable(command, projectDir);
  const result = spawnSync(executable, args, { cwd: projectDir, encoding: "utf8", timeout: 600_000, maxBuffer: 20 * 1024 * 1024 });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  if (result.error || result.status !== 0) {
    console.error(`Workflow ${workflow} stopped at ${command} ${args.join(" ")}: ${result.error?.message ?? `exit ${result.status}`}`);
    process.exit(result.status ?? 1);
  }
}
console.log(`PASS workflow ${workflow}`);
