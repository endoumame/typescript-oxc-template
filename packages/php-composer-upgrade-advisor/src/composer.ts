import { basename, dirname, join, relative } from "node:path";
import { readFile, readdir } from "node:fs/promises";

export interface ComposerManifestDependency {
  readonly name: string;
  readonly constraint: string;
  readonly dev: boolean;
}

export interface ComposerLockedPackage {
  readonly name: string;
  readonly version: string;
  readonly requirePhp?: string;
  readonly sourceUrl?: string;
  readonly sourceReference?: string;
  readonly dev: boolean;
}

export interface ComposerProject {
  readonly rootName: string;
  readonly directory: string;
  readonly composerJsonPath: string;
  readonly lockPath?: string;
  readonly manifestDependencies: readonly ComposerManifestDependency[];
  readonly lockedPackages: readonly ComposerLockedPackage[];
}

interface ComposerJson {
  readonly require?: Record<string, string>;
  readonly "require-dev"?: Record<string, string>;
}

interface ComposerLock {
  readonly packages?: readonly LockPackage[];
  readonly "packages-dev"?: readonly LockPackage[];
}

interface LockPackage {
  readonly name: string;
  readonly version: string;
  readonly require?: Record<string, string>;
  readonly source?: {
    readonly url?: string;
    readonly reference?: string;
  };
}

export async function discoverComposerProjects(rootDirectory: string): Promise<ComposerProject[]> {
  const composerJsonPaths = await findComposerJsonFiles(rootDirectory);
  const projects = await Promise.all(
    composerJsonPaths.map(async (composerJsonPath) =>
      readComposerProject(rootDirectory, composerJsonPath),
    ),
  );
  return projects.toSorted((left, right) => left.directory.localeCompare(right.directory));
}

async function findComposerJsonFiles(rootDirectory: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        if ([".git", "node_modules", "vendor", "dist", "coverage"].includes(entry.name)) {
          continue;
        }
        await walk(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name === "composer.json") {
        found.push(fullPath);
      }
    }
  }
  await walk(rootDirectory);
  return found;
}

async function readComposerProject(
  rootDirectory: string,
  composerJsonPath: string,
): Promise<ComposerProject> {
  const directory = dirname(composerJsonPath);
  const composerJson = JSON.parse(await readFile(composerJsonPath, "utf8")) as ComposerJson;
  const lockPath = await firstReadable([
    join(directory, "composer.lock"),
    join(directory, "composer.lock.json"),
  ]);
  const manifestDependencies = [
    ...dependenciesFromSection(composerJson.require, false),
    ...dependenciesFromSection(composerJson["require-dev"], true),
  ];
  const lockedPackages = lockPath ? await readLockedPackages(lockPath) : [];
  return {
    composerJsonPath: relative(rootDirectory, composerJsonPath),
    directory: relative(rootDirectory, directory) || ".",
    lockPath: lockPath ? relative(rootDirectory, lockPath) : undefined,
    lockedPackages,
    manifestDependencies,
    rootName: basename(directory),
  };
}

function dependenciesFromSection(
  section: Record<string, string> | undefined,
  dev: boolean,
): ComposerManifestDependency[] {
  return Object.entries(section ?? {})
    .filter(([name]) => name !== "php" && !name.startsWith("ext-"))
    .map(([name, constraint]) => ({ constraint, dev, name }));
}

async function readLockedPackages(lockPath: string): Promise<ComposerLockedPackage[]> {
  const lock = JSON.parse(await readFile(lockPath, "utf8")) as ComposerLock;
  return [
    ...(lock.packages ?? []).map((pkg) => lockPackage(pkg, false)),
    ...(lock["packages-dev"] ?? []).map((pkg) => lockPackage(pkg, true)),
  ];
}

function lockPackage(pkg: LockPackage, dev: boolean): ComposerLockedPackage {
  return {
    dev,
    name: pkg.name,
    requirePhp: pkg.require?.php,
    sourceReference: pkg.source?.reference,
    sourceUrl: pkg.source?.url,
    version: pkg.version,
  };
}

async function firstReadable(paths: readonly string[]): Promise<string | undefined> {
  for (const path of paths) {
    try {
      await readFile(path, "utf8");
      return path;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
  return undefined;
}
