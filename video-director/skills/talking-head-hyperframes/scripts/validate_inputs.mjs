#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export * from "../assets/hyperframes-project/scripts/check-inputs.mjs";
import { validateProjectInputs } from "../assets/hyperframes-project/scripts/check-inputs.mjs";

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const projectDir = process.argv[2] ?? process.cwd();
  try {
    const result = await validateProjectInputs(projectDir);
    console.log(`[inputs] PASS: ${result.status} (${result.missingIds.length} missing) in ${result.projectDir}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
