import { discoverComposerProjects } from "./composer.js";
import type { ComposerLockedPackage } from "./composer.js";
import { fetchPackagistVersions, findMinimumPhpCompatibleVersion } from "./packagist.js";
import type { HttpClient, PackagistPackageVersion } from "./packagist.js";
import { inspectGitHubEvidence, parseGitHubRepository } from "./github.js";
import { classifyVersionChange, constraintAllowsPhp } from "./version.js";

export type AdvisoryStatus = "no-update-needed" | "update-needed" | "unsupported" | "unknown";

export interface PackageAdvisory {
  readonly projectRoot: string;
  readonly packageName: string;
  readonly dev: boolean;
  readonly currentVersion: string;
  readonly currentPhpConstraint?: string;
  readonly currentAllowsTargetPhp: boolean;
  readonly status: AdvisoryStatus;
  readonly minimumVersion?: string;
  readonly minimumPhpConstraint?: string;
  readonly updateLevel?: "none" | "major" | "minor" | "patch" | "unknown";
  readonly confidenceScore: number;
  readonly evidence: readonly AdvisoryEvidence[];
  readonly errors: readonly string[];
}

export interface AdvisoryEvidence {
  readonly source:
    | "composer-lock"
    | "packagist"
    | "github-release"
    | "github-changelog"
    | "github-ci"
    | "official-docs";
  readonly confidence: number;
  readonly url?: string;
  readonly version?: string;
  readonly detail: string;
}

export interface ProjectAdvisory {
  readonly rootName: string;
  readonly directory: string;
  readonly composerJsonPath: string;
  readonly lockPath?: string;
  readonly packages: readonly PackageAdvisory[];
}

export interface UpgradeReport {
  readonly input: {
    readonly fromPhp: string;
    readonly toPhp: string;
    readonly rootDirectory: string;
  };
  readonly generatedAt: string;
  readonly projects: readonly ProjectAdvisory[];
}

export interface AnalyzeOptions {
  readonly rootDirectory: string;
  readonly fromPhp: string;
  readonly toPhp: string;
  readonly includeDev?: boolean;
  readonly githubToken?: string;
  readonly httpClient?: HttpClient;
  readonly inspectGitHub?: boolean;
}

export async function analyzePhpComposerUpgrade(options: AnalyzeOptions): Promise<UpgradeReport> {
  const projects = await discoverComposerProjects(options.rootDirectory);
  const projectReports = [];
  for (const project of projects) {
    const packages = [];
    for (const pkg of project.lockedPackages.filter(
      (item) => options.includeDev === true || !item.dev,
    )) {
      packages.push(await analyzePackage(pkg, project.rootName, options));
    }
    projectReports.push({
      composerJsonPath: project.composerJsonPath,
      directory: project.directory,
      lockPath: project.lockPath,
      packages,
      rootName: project.rootName,
    });
  }
  return {
    generatedAt: new Date().toISOString(),
    input: {
      fromPhp: options.fromPhp,
      toPhp: options.toPhp,
      rootDirectory: options.rootDirectory,
    },
    projects: projectReports,
  };
}

async function analyzePackage(
  pkg: ComposerLockedPackage,
  projectRoot: string,
  options: AnalyzeOptions,
): Promise<PackageAdvisory> {
  const currentAllowsTargetPhp = constraintAllowsPhp(pkg.requirePhp, options.toPhp);
  const evidence: AdvisoryEvidence[] = [
    {
      confidence: currentAllowsTargetPhp ? 0.9 : 0.2,
      detail: pkg.requirePhp
        ? `Locked package requires PHP constraint ${pkg.requirePhp}; target PHP ${options.toPhp} is ${currentAllowsTargetPhp ? "allowed" : "not allowed"}.`
        : "Locked package has no explicit PHP requirement; Composer treats it as unconstrained.",
      source: "composer-lock",
      version: pkg.version,
    },
  ];
  const errors: string[] = [];
  let versions: PackagistPackageVersion[] = [];
  let minimumVersion: PackagistPackageVersion | undefined;

  try {
    versions = await fetchPackagistVersions(pkg.name, options.httpClient);
    minimumVersion = findMinimumPhpCompatibleVersion(versions, pkg.version, options.toPhp);
    if (minimumVersion) {
      evidence.push({
        confidence: 0.95,
        detail: `Packagist metadata for ${minimumVersion.version} requires PHP constraint ${minimumVersion.requirePhp ?? "<none>"}, which allows PHP ${options.toPhp}.`,
        source: "packagist",
        version: minimumVersion.version,
      });
    } else {
      evidence.push({
        confidence: 0.95,
        detail: `No stable Packagist version at or above ${pkg.version} advertises PHP ${options.toPhp} compatibility through require.php metadata.`,
        source: "packagist",
      });
    }
  } catch (error) {
    errors.push((error as Error).message);
  }

  if (options.inspectGitHub !== false && versions.length > 0) {
    const sourceUrl = pkg.sourceUrl ?? minimumVersion?.sourceUrl;
    const github = await inspectGitHubEvidence({
      currentVersion: pkg.version,
      githubToken: options.githubToken,
      httpClient: options.httpClient,
      sourceUrl,
      targetPhpMinor: options.toPhp,
      versions,
    });
    errors.push(...github.errors);
    for (const item of github.evidence) {
      evidence.push({
        confidence: item.confidence,
        detail: item.detail,
        source:
          item.type === "release"
            ? "github-release"
            : item.type === "ci"
              ? "github-ci"
              : "github-changelog",
        url: item.url,
        version: item.version,
      });
    }
    if (github.repository) {
      evidence.push({
        confidence: 0.35,
        detail:
          "The package source repository is GitHub; repository documentation was inspected where available.",
        source: "official-docs",
        url: `https://github.com/${github.repository.owner}/${github.repository.repo}`,
      });
    }
  } else if (pkg.sourceUrl && !parseGitHubRepository(pkg.sourceUrl)) {
    errors.push("Package source URL is not a GitHub repository; GitHub evidence was skipped.");
  }

  const status = determineStatus(currentAllowsTargetPhp, minimumVersion);
  const selectedVersion = currentAllowsTargetPhp ? pkg.version : minimumVersion?.version;
  return {
    confidenceScore: calculateConfidence(status, evidence, errors),
    currentAllowsTargetPhp,
    currentPhpConstraint: pkg.requirePhp,
    currentVersion: pkg.version,
    dev: pkg.dev,
    errors,
    evidence,
    minimumPhpConstraint: currentAllowsTargetPhp ? pkg.requirePhp : minimumVersion?.requirePhp,
    minimumVersion: selectedVersion,
    packageName: pkg.name,
    projectRoot,
    status,
    updateLevel: selectedVersion ? classifyVersionChange(pkg.version, selectedVersion) : undefined,
  };
}

function determineStatus(
  currentAllowsTargetPhp: boolean,
  minimumVersion: PackagistPackageVersion | undefined,
): AdvisoryStatus {
  if (currentAllowsTargetPhp) {
    return "no-update-needed";
  }
  if (minimumVersion) {
    return "update-needed";
  }
  return "unsupported";
}

function calculateConfidence(
  status: AdvisoryStatus,
  evidence: readonly AdvisoryEvidence[],
  errors: readonly string[],
): number {
  const highest = Math.max(...evidence.map((item) => item.confidence), 0.1);
  const githubBoost = evidence.some((item) => item.source === "github-ci") ? 0.03 : 0;
  const penalty = Math.min(errors.length * 0.08, 0.3);
  const unsupportedPenalty = status === "unsupported" ? 0.05 : 0;
  return Math.max(
    0,
    Math.min(1, Number((highest + githubBoost - penalty - unsupportedPenalty).toFixed(2))),
  );
}
