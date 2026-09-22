#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { canonicalProjectRoot, projectFingerprint, safeProjectPath, sha256File, writeJsonAtomic } from "./project-integrity.mjs";

const executorId = process.argv[2];
if (!executorId || !/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(executorId)) {
  console.error("Usage: node scripts/proof-lock.mjs <stable-executor-id>");
  process.exit(2);
}

const projectDir = canonicalProjectRoot(process.cwd());
const lockPath = safeProjectPath(projectDir, "review/execution-lock.json", { mustExist: false });
if (fs.existsSync(lockPath)) {
  const info = fs.lstatSync(lockPath);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error("Existing execution lock is not a regular file");
  const existing = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  if (existing.executorId !== executorId) throw new Error(`Execution is already owned by ${existing.executorId}`);
  console.log(`PASS execution lock already belongs to ${executorId}`);
  process.exit(0);
}

const source = safeProjectPath(projectDir, "inputs/motion-contract.json", { type: "file" });
const design = safeProjectPath(projectDir, "DESIGN.md", { type: "file" });
const lock = {
  version: 1,
  executorId,
  sourceContractSha256: sha256File(source),
  designSha256: sha256File(design),
  takeoverFingerprint: projectFingerprint(projectDir).sha256,
  createdAt: new Date().toISOString(),
};
writeJsonAtomic(lockPath, lock);
const proofPath = safeProjectPath(projectDir, "review/proof-manifest-v1.json", { type: "file" });
const proof = JSON.parse(fs.readFileSync(proofPath, "utf8"));
proof.executor = { ...(proof.executor ?? {}), id: executorId };
proof.reviews = proof.reviews ?? {};
proof.reviews.revisionOwner = executorId;
writeJsonAtomic(proofPath, proof);
console.log(`PASS execution locked to ${executorId}`);
