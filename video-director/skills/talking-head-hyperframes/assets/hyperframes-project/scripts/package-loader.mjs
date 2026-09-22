import { spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inside, trustedExecutable } from "./project-integrity.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, "..");
const BOOTSTRAP_CONFIRM_ENV = "HYPERFRAMES_SKILL_BOOTSTRAP_DEPS";
const TRUSTED_PACKAGES = new Map([["@hyperframes/producer", "0.7.65"]]);
const cleanupRoots = new Set();

process.once("exit", () => {
  for (const root of cleanupRoots) rmSync(root, { recursive: true, force: true });
});

export async function importPackagesOrBootstrap(packageNames, options = {}) {
  const requested = validateRequestedPackages(packageNames, options.npmPackages);
  await confirmBootstrap(requested.map(({ spec }) => spec));
  const installRoot = installIsolatedPackages(requested.map(({ spec }) => spec));
  cleanupRoots.add(installRoot);

  try {
    const modules = {};
    for (const item of requested) {
      const entry = verifiedPackageEntry(installRoot, item);
      modules[item.name] = await import(pathToFileURL(entry).href);
    }
    return modules;
  } catch (error) {
    cleanupRoots.delete(installRoot);
    rmSync(installRoot, { recursive: true, force: true });
    throw error;
  }
}

export function hyperframesPackageSpec(packageName) {
  const version = TRUSTED_PACKAGES.get(packageName);
  if (!version) throw new Error(`Package is not in the factory-owned helper allowlist: ${packageName}`);
  return `${packageName}@${version}`;
}

function validateRequestedPackages(packageNames, packageSpecs) {
  if (!Array.isArray(packageNames) || packageNames.length === 0) {
    throw new Error("At least one factory-owned helper package is required");
  }
  const specs = packageSpecs ?? packageNames.map(hyperframesPackageSpec);
  if (!Array.isArray(specs) || specs.length !== packageNames.length) {
    throw new Error("Pinned npm package specs must match the requested helper package list exactly");
  }
  if (new Set(packageNames).size !== packageNames.length) {
    throw new Error("Duplicate helper package requests are forbidden");
  }

  return packageNames.map((name, index) => {
    const trustedVersion = TRUSTED_PACKAGES.get(name);
    if (!trustedVersion) throw new Error(`Package is not in the factory-owned helper allowlist: ${name}`);
    const parsed = parseExactPackageSpec(specs[index]);
    if (parsed.name !== name || parsed.version !== trustedVersion) {
      throw new Error(
        `Helper package must be exactly ${name}@${trustedVersion}; received ${String(specs[index])}`,
      );
    }
    return { name, version: trustedVersion, spec: `${name}@${trustedVersion}` };
  });
}

function parseExactPackageSpec(spec) {
  if (typeof spec !== "string") throw new Error(`Invalid pinned package spec: ${String(spec)}`);
  const separator = spec.lastIndexOf("@");
  if (separator <= 0) throw new Error(`Package spec must include an exact version: ${spec}`);
  const name = spec.slice(0, separator);
  const version = spec.slice(separator + 1);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Package spec must use an exact semantic version: ${spec}`);
  }
  return { name, version };
}

async function confirmBootstrap(packageSpecs) {
  if (process.env[BOOTSTRAP_CONFIRM_ENV] === "1") return;

  const installLine = `npm install --ignore-scripts --no-save ${packageSpecs.map(shellQuote).join(" ")}`;
  if (!process.stdin.isTTY) {
    throw new Error(
      [
        "Factory-owned helper package(s) require an isolated temporary install.",
        "Project-local packages and node_modules are never imported.",
        "To allow the one-time bootstrap for this run, set:",
        `  ${BOOTSTRAP_CONFIRM_ENV}=1`,
        "The isolated bootstrap command will be:",
        `  ${installLine}`,
      ].join("\n"),
    );
  }

  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question(
      [
        "HyperFrames needs a factory-pinned helper package in an isolated temporary directory.",
        "Project-local packages will not be used.",
        "Run the install with lifecycle scripts disabled?",
        `  ${installLine}`,
        "Proceed? [y/N] ",
      ].join("\n"),
    );
    if (!/^(y|yes)$/i.test(answer.trim())) throw new Error("Dependency bootstrap cancelled.");
  } finally {
    rl.close();
  }
}

function trustedBootstrapPath() {
  return (process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .filter((entry) => !inside(PROJECT_ROOT, resolve(entry)))
    .join(delimiter);
}

function installIsolatedPackages(packageSpecs) {
  const installRoot = mkdtempSync(join(tmpdir(), "hyperframes-skill-deps-"));
  try {
    const npm = trustedExecutable("npm", PROJECT_ROOT);
    const result = spawnSync(
      npm,
      [
        "install",
        "--silent",
        "--no-audit",
        "--no-fund",
        "--ignore-scripts",
        "--no-save",
        "--package-lock=false",
        "--prefix",
        installRoot,
        ...packageSpecs,
      ],
      {
        cwd: installRoot,
        stdio: "inherit",
        timeout: 300_000,
        env: {
          ...process.env,
          PATH: trustedBootstrapPath(),
          npm_config_ignore_scripts: "true",
          npm_config_audit: "false",
          npm_config_fund: "false",
        },
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Isolated npm bootstrap failed with status ${result.status ?? "unknown"}`);
    return installRoot;
  } catch (error) {
    rmSync(installRoot, { recursive: true, force: true });
    throw error;
  }
}

function verifiedPackageEntry(installRoot, expected) {
  const packageDir = join(installRoot, "node_modules", ...expected.name.split("/"));
  const packageInfo = lstatSync(packageDir);
  if (packageInfo.isSymbolicLink() || !packageInfo.isDirectory()) {
    throw new Error(`Isolated helper package is not a real directory: ${expected.name}`);
  }
  const canonicalPackageDir = realpathSync(packageDir);
  const manifestPath = join(canonicalPackageDir, "package.json");
  const manifestInfo = lstatSync(manifestPath);
  if (manifestInfo.isSymbolicLink() || !manifestInfo.isFile()) {
    throw new Error(`Isolated helper package manifest is invalid: ${expected.name}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.name !== expected.name || manifest.version !== expected.version) {
    throw new Error(
      `Isolated helper package identity mismatch: expected ${expected.name}@${expected.version}, received ${String(manifest.name)}@${String(manifest.version)}`,
    );
  }

  const entryRelative = packageExportEntry(manifest);
  if (!entryRelative) throw new Error(`Isolated helper package has no import entry: ${expected.name}`);
  const entry = realpathSync(join(canonicalPackageDir, entryRelative));
  if (!inside(canonicalPackageDir, entry) || !statSync(entry).isFile()) {
    throw new Error(
      `Resolved helper entry escapes its verified package directory: ${relative(canonicalPackageDir, entry)}`,
    );
  }
  return entry;
}

function packageExportEntry(manifest) {
  const root =
    typeof manifest.exports === "object" && manifest.exports !== null
      ? (manifest.exports["."] ?? manifest.exports)
      : manifest.exports;
  if (typeof root === "string") return root;
  if (typeof root === "object" && root !== null) {
    if (typeof root.import === "string") return root.import;
    if (typeof root.default === "string") return root.default;
    if (typeof root.node === "string") return root.node;
    if (typeof root.node === "object" && root.node !== null) {
      return root.node.import ?? root.node.default ?? null;
    }
  }
  return manifest.module ?? manifest.main ?? null;
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:@=-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}
