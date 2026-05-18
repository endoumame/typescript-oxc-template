import { compareVersions, constraintAllowsPhp, normalizeVersion } from "./version.js";

export type HttpClient = (url: string, init?: RequestInit) => Promise<Response>;

export interface PackagistPackageVersion {
  readonly name: string;
  readonly version: string;
  readonly normalizedVersion: string;
  readonly requirePhp?: string;
  readonly sourceUrl?: string;
  readonly sourceReference?: string;
  readonly time?: string;
}

interface PackagistP2Response {
  readonly packages: Record<string, readonly PackagistP2Version[]>;
}

interface PackagistP2Version {
  readonly name: string;
  readonly version: string;
  readonly version_normalized?: string;
  readonly require?: Record<string, string>;
  readonly source?: {
    readonly url?: string;
    readonly reference?: string;
  };
  readonly time?: string;
}

export async function fetchPackagistVersions(
  packageName: string,
  httpClient: HttpClient = fetch,
): Promise<PackagistPackageVersion[]> {
  const response = await httpClient(
    `https://repo.packagist.org/p2/${encodeURIComponent(packageName)}.json`,
  );
  if (!response.ok) {
    throw new Error(`Packagist request failed for ${packageName}: HTTP ${response.status}`);
  }
  const payload = (await response.json()) as PackagistP2Response;
  return (payload.packages[packageName] ?? [])
    .filter((version) => !isDevVersion(version.version))
    .map((version) => ({
      name: version.name,
      normalizedVersion: normalizeVersion(version.version_normalized ?? version.version),
      requirePhp: version.require?.php,
      sourceReference: version.source?.reference,
      sourceUrl: version.source?.url,
      time: version.time,
      version: version.version,
    }))
    .toSorted((left, right) => compareVersions(left.normalizedVersion, right.normalizedVersion));
}

export function findMinimumPhpCompatibleVersion(
  versions: readonly PackagistPackageVersion[],
  currentVersion: string,
  targetPhpMinor: string,
): PackagistPackageVersion | undefined {
  const normalizedCurrent = normalizeVersion(currentVersion);
  return versions.find(
    (version) =>
      compareVersions(version.normalizedVersion, normalizedCurrent) >= 0 &&
      constraintAllowsPhp(version.requirePhp, targetPhpMinor),
  );
}

function isDevVersion(version: string): boolean {
  return /^dev-|\.x-dev$/i.test(version);
}
