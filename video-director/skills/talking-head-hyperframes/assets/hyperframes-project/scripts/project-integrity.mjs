import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function sha256Text(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function approvalDecision(proof) {
  return {
    proofVersion: proof?.proofVersion,
    executor: proof?.executor,
    animationMapReview: proof?.animationMapReview,
    reports: proof?.reports,
    reviews: proof?.reviews,
    reviewBundle: proof?.reviewBundle,
    approval: {
      previewV1Approved: proof?.approval?.previewV1Approved,
      reviewer: proof?.approval?.reviewer,
      approvedProofVersion: proof?.approval?.approvedProofVersion,
      previewSha256: proof?.approval?.previewSha256,
      projectFingerprint: proof?.approval?.projectFingerprint,
      executionLockSha256: proof?.approval?.executionLockSha256,
      reviewBundleSha256: proof?.approval?.reviewBundleSha256,
    },
  };
}

export function approvalDecisionSha256(proof) {
  return sha256Text(JSON.stringify(approvalDecision(proof)));
}

export function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function canonicalProjectRoot(projectDir = process.cwd()) {
  const requested = path.resolve(projectDir);
  const info = fs.lstatSync(requested);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Project root must be a real directory: ${requested}`);
  return fs.realpathSync(requested);
}

export function safeProjectPath(projectDir, relative, { mustExist = true, type = null } = {}) {
  const root = canonicalProjectRoot(projectDir);
  if (typeof relative !== "string" || relative.trim() === "" || path.isAbsolute(relative)) {
    throw new Error(`Path must be project-relative: ${relative}`);
  }
  const candidate = path.resolve(root, relative);
  if (!inside(root, candidate)) throw new Error(`Path escapes project root: ${relative}`);
  let cursor = root;
  for (const part of path.relative(root, candidate).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    let info;
    try {
      info = fs.lstatSync(cursor);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      if (mustExist) throw new Error(`Path does not exist: ${relative}`);
      break;
    }
    if (info.isSymbolicLink()) throw new Error(`Symbolic links are forbidden in project evidence: ${path.relative(root, cursor)}`);
  }
  if (mustExist) {
    const actual = fs.realpathSync(candidate);
    if (!inside(root, actual)) throw new Error(`Path resolves outside project root: ${relative}`);
    const info = fs.statSync(actual);
    if (type === "file" && !info.isFile()) throw new Error(`Expected regular file: ${relative}`);
    if (type === "directory" && !info.isDirectory()) throw new Error(`Expected directory: ${relative}`);
    return actual;
  }
  return candidate;
}

function collectFiles(root, relative, output) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) return;
  const info = fs.lstatSync(absolute);
  if (info.isSymbolicLink()) throw new Error(`Symbolic links are forbidden in fingerprint inputs: ${relative}`);
  if (info.isFile()) {
    output.push(relative.split(path.sep).join("/"));
    return;
  }
  for (const entry of fs.readdirSync(absolute).sort()) collectFiles(root, path.join(relative, entry), output);
}

export function projectFingerprint(projectDir = process.cwd()) {
  const root = canonicalProjectRoot(projectDir);
  const files = [];
  for (const relative of [
    "DESIGN.md",
    "caption-overrides.json",
    "hyperframes.json",
    "index.html",
    "manifest.json",
    "meta.json",
    "package.json",
    "styles.css",
    "compositions",
    "inputs",
    "assets",
    "runtime-adaptation.json",
    "STORYBOARD.md",
    "SCENE_SCHEMA.json",
    "VECTOR_TEMPLATES.json",
    "MOTION_PRIMITIVES.json",
    "MOTION_MAP.json",
    "scripts",
    "proof/goldens",
  ]) collectFiles(root, relative, files);
  files.sort();
  const records = files.map((relative) => `${relative}\0${sha256File(path.join(root, relative))}`);
  return { algorithm: "sha256", sha256: sha256Text(records.join("\0")), files };
}

export function writeJsonAtomic(file, value) {
  writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeFileAtomic(file, value) {
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true });
  try {
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error(`Refusing to replace symbolic-link output: ${file}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const temp = path.join(directory, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(temp, value, { flag: "wx" });
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

export function trustedExecutable(command, projectDir = process.cwd()) {
  const root = canonicalProjectRoot(projectDir);
  const suffixes = process.platform === "win32" ? [".cmd", ".exe", ""] : [""];
  for (const entry of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    const directory = path.resolve(entry);
    if (inside(root, directory)) continue;
    for (const suffix of suffixes) {
      const candidate = path.join(directory, `${command}${suffix}`);
      try {
        const actual = fs.realpathSync(candidate);
        if (inside(root, actual) || !fs.statSync(actual).isFile()) continue;
        fs.accessSync(actual, fs.constants.X_OK);
        return actual;
      } catch {
        // Continue until an executable outside the project is found.
      }
    }
  }
  throw new Error(`Could not resolve trusted executable ${command} outside the project`);
}
