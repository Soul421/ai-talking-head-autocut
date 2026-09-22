#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { canonicalProjectRoot, safeProjectPath } from "./project-integrity.mjs";

const projectDir = canonicalProjectRoot(process.cwd());
const runner = safeProjectPath(projectDir, "scripts/hyperframes-animation-map.mjs", { type: "file" });
const output = safeProjectPath(projectDir, "review/animation-map-v1", { mustExist: false });
const result = spawnSync(process.execPath, [runner, projectDir, "--frames", "6", "--out", output, "--min-duration", "0.05", "--width", "1920", "--height", "1080", "--fps", "30"], {
  cwd: projectDir,
  encoding: "utf8",
  timeout: 600_000,
  env: { ...process.env, HYPERFRAMES_SKILL_BOOTSTRAP_DEPS: "1" },
});

process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
if (result.error) {
  console.error(`Animation-map runner failed to start: ${result.error.message}`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
