export type VersionTuple = readonly [number, number, number];

export function normalizeVersion(version: string): string {
  const match = version.trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/i);
  if (!match) {
    return version.trim();
  }
  return `${Number(match[1])}.${Number(match[2] ?? 0)}.${Number(match[3] ?? 0)}`;
}

export function parseVersion(version: string): VersionTuple | null {
  const normalized = normalizeVersion(version);
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) {
    return left.localeCompare(right, undefined, { numeric: true });
  }
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) {
      return a[index] - b[index];
    }
  }
  return 0;
}

export function classifyVersionChange(
  current: string,
  next: string,
): "none" | "major" | "minor" | "patch" | "unknown" {
  if (compareVersions(current, next) === 0) {
    return "none";
  }
  const a = parseVersion(current);
  const b = parseVersion(next);
  if (!a || !b) {
    return "unknown";
  }
  if (a[0] !== b[0]) {
    return "major";
  }
  if (a[1] !== b[1]) {
    return "minor";
  }
  return "patch";
}

export function phpVersionForConstraint(minorVersion: string): string {
  const parsed = parseVersion(minorVersion);
  if (parsed) {
    return `${parsed[0]}.${parsed[1]}.0`;
  }
  const match = minorVersion.match(/^(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`PHP version must be major.minor or major.minor.patch: ${minorVersion}`);
  }
  return `${Number(match[1])}.${Number(match[2])}.0`;
}

export function constraintAllowsPhp(
  constraint: string | undefined,
  phpMinorVersion: string,
): boolean {
  if (!constraint || constraint.trim() === "" || constraint.trim() === "*") {
    return true;
  }
  const phpVersion = phpVersionForConstraint(phpMinorVersion);
  return constraint
    .split(/\s*\|\|\s*|\s+or\s+/i)
    .some((orPart) => allowsAll(andConstraints(orPart), phpVersion));
}

function allowsAll(parts: string[], phpVersion: string): boolean {
  return parts.every((part) => allowsSingle(part, phpVersion));
}

function andConstraints(part: string): string[] {
  const normalized = part.replaceAll(/,/g, " ").trim();
  if (normalized === "") {
    return ["*"];
  }
  const hyphen = normalized.match(/^(\S+)\s+-\s+(\S+)$/);
  if (hyphen) {
    return [`>=${completeVersion(hyphen[1])}`, `<=${completeVersion(hyphen[2])}`];
  }
  return normalized.split(/\s+/).filter(Boolean);
}

function allowsSingle(part: string, phpVersion: string): boolean {
  if (part === "*" || /^x$/i.test(part)) {
    return true;
  }
  const wildcard = part.match(/^v?(\d+|x|\*)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/i);
  if (
    wildcard &&
    [wildcard[1], wildcard[2], wildcard[3]].some(
      (segment) => segment === "*" || /^x$/i.test(segment ?? ""),
    )
  ) {
    const major = wildcard[1];
    const minor = wildcard[2];
    if (major === "*" || /^x$/i.test(major)) {
      return true;
    }
    const lower = `${Number(major)}.${minor && !/^x|\*$/i.test(minor) ? Number(minor) : 0}.0`;
    const upper =
      minor && !/^x|\*$/i.test(minor)
        ? `${Number(major)}.${Number(minor) + 1}.0`
        : `${Number(major) + 1}.0.0`;
    return compareVersions(phpVersion, lower) >= 0 && compareVersions(phpVersion, upper) < 0;
  }
  if (part.startsWith("^")) {
    const lower = completeVersion(part.slice(1));
    const tuple = parseVersion(lower);
    if (!tuple) {
      return false;
    }
    const upper =
      tuple[0] > 0
        ? `${tuple[0] + 1}.0.0`
        : tuple[1] > 0
          ? `0.${tuple[1] + 1}.0`
          : `0.0.${tuple[2] + 1}`;
    return compareVersions(phpVersion, lower) >= 0 && compareVersions(phpVersion, upper) < 0;
  }
  if (part.startsWith("~")) {
    const raw = part.slice(1);
    const lower = completeVersion(raw);
    const tuple = parseVersion(lower);
    if (!tuple) {
      return false;
    }
    const specifiedSegments = raw.split(".").length;
    const upper = specifiedSegments >= 3 ? `${tuple[0]}.${tuple[1] + 1}.0` : `${tuple[0] + 1}.0.0`;
    return compareVersions(phpVersion, lower) >= 0 && compareVersions(phpVersion, upper) < 0;
  }
  const comparator = part.match(/^(>=|>|<=|<|=|==)?\s*v?(\d+(?:\.\d+){0,2})$/);
  if (!comparator) {
    return false;
  }
  const operator = comparator[1] ?? "=";
  const target = completeVersion(comparator[2]);
  const comparison = compareVersions(phpVersion, target);
  switch (operator) {
    case ">=": {
      return comparison >= 0;
    }
    case ">": {
      return comparison > 0;
    }
    case "<=": {
      return comparison <= 0;
    }
    case "<": {
      return comparison < 0;
    }
    case "=":
    case "==": {
      return comparison === 0;
    }
    default: {
      return false;
    }
  }
}

function completeVersion(version: string): string {
  const [major = "0", minor = "0", patch = "0"] = version.replace(/^v/i, "").split(".");
  return `${Number(major)}.${Number(minor)}.${Number(patch)}`;
}
