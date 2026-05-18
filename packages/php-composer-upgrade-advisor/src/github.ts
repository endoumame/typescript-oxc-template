import { Buffer } from "node:buffer";
import { compareVersions, normalizeVersion } from "./version.js";

export interface GitHubRepository {
  readonly owner: string;
  readonly repo: string;
}

export interface GitHubEvidence {
  readonly type: "release" | "changelog" | "ci";
  readonly version?: string;
  readonly url: string;
  readonly confidence: number;
  readonly detail: string;
}

export interface GitHubInspection {
  readonly repository?: GitHubRepository;
  readonly evidence: readonly GitHubEvidence[];
  readonly errors: readonly string[];
}

export type HttpClient = (url: string, init?: RequestInit) => Promise<Response>;

const DOCUMENT_FILES = [
  "CHANGELOG.md",
  "CHANGELOG",
  "UPGRADE.md",
  "UPGRADING.md",
  "UPGRADE-*.md",
  "README.md",
] as const;
const WORKFLOW_DIRECTORY = ".github/workflows";

export function parseGitHubRepository(sourceUrl: string | undefined): GitHubRepository | undefined {
  if (!sourceUrl) {
    return undefined;
  }
  const match = sourceUrl.match(/github\.com[:/](?<owner>[^/]+)\/(?<repo>[^/.]+)(?:\.git)?/i);
  if (!match?.groups) {
    return undefined;
  }
  return { owner: match.groups.owner, repo: match.groups.repo };
}

export async function inspectGitHubEvidence(input: {
  readonly sourceUrl?: string;
  readonly versions: readonly {
    version: string;
    normalizedVersion: string;
    sourceReference?: string;
  }[];
  readonly currentVersion: string;
  readonly targetPhpMinor: string;
  readonly httpClient?: HttpClient;
  readonly githubToken?: string;
}): Promise<GitHubInspection> {
  const repository = parseGitHubRepository(input.sourceUrl);
  if (!repository) {
    return {
      errors: ["No GitHub repository could be inferred from package source URL."],
      evidence: [],
    };
  }
  const httpClient = input.httpClient ?? fetch;
  const headers = input.githubToken ? { Authorization: `Bearer ${input.githubToken}` } : undefined;
  const candidateVersions = input.versions
    .filter(
      (version) =>
        compareVersions(version.normalizedVersion, normalizeVersion(input.currentVersion)) >= 0,
    )
    .slice(0, 80);
  const evidence: GitHubEvidence[] = [];
  const errors: string[] = [];

  try {
    evidence.push(
      ...(await inspectReleases(
        repository,
        candidateVersions,
        input.targetPhpMinor,
        httpClient,
        headers,
      )),
    );
  } catch (error) {
    errors.push(`GitHub release inspection failed: ${(error as Error).message}`);
  }
  try {
    evidence.push(
      ...(await inspectRepositoryFiles(
        repository,
        candidateVersions,
        input.targetPhpMinor,
        httpClient,
        headers,
      )),
    );
  } catch (error) {
    errors.push(`GitHub file inspection failed: ${(error as Error).message}`);
  }

  return { errors, evidence: evidence.sort(compareEvidence), repository };
}

async function inspectReleases(
  repository: GitHubRepository,
  versions: readonly { version: string; normalizedVersion: string }[],
  targetPhpMinor: string,
  httpClient: HttpClient,
  headers: HeadersInit | undefined,
): Promise<GitHubEvidence[]> {
  const releases = await getJson<readonly { tag_name: string; body?: string; html_url: string }[]>(
    apiUrl(repository, "/releases?per_page=100"),
    httpClient,
    headers,
  );
  const matches: GitHubEvidence[] = [];
  for (const version of versions) {
    const release = releases.find(
      (item) => normalizeVersion(item.tag_name) === version.normalizedVersion,
    );
    if (
      release &&
      mentionsPhpVersion(`${release.tag_name}\n${release.body ?? ""}`, targetPhpMinor)
    ) {
      matches.push({
        confidence: 0.72,
        detail: `GitHub release text mentions PHP ${targetPhpMinor}.`,
        type: "release",
        url: release.html_url,
        version: version.version,
      });
    }
  }
  return matches;
}

async function inspectRepositoryFiles(
  repository: GitHubRepository,
  versions: readonly { version: string; normalizedVersion: string; sourceReference?: string }[],
  targetPhpMinor: string,
  httpClient: HttpClient,
  headers: HeadersInit | undefined,
): Promise<GitHubEvidence[]> {
  const matches: GitHubEvidence[] = [];
  for (const version of versions) {
    const reference = version.sourceReference ?? version.version;
    const [documentEvidence, workflowEvidence] = await Promise.all([
      inspectDocumentFiles(
        repository,
        reference,
        version.version,
        targetPhpMinor,
        httpClient,
        headers,
      ),
      inspectWorkflowFiles(
        repository,
        reference,
        version.version,
        targetPhpMinor,
        httpClient,
        headers,
      ),
    ]);
    matches.push(...documentEvidence, ...workflowEvidence);
    if (
      matches.some((match) => match.type === "ci") &&
      matches.some((match) => match.type === "changelog")
    ) {
      break;
    }
  }
  return matches;
}

async function inspectDocumentFiles(
  repository: GitHubRepository,
  reference: string,
  version: string,
  targetPhpMinor: string,
  httpClient: HttpClient,
  headers: HeadersInit | undefined,
): Promise<GitHubEvidence[]> {
  const evidence: GitHubEvidence[] = [];
  for (const file of DOCUMENT_FILES) {
    if (file.includes("*")) {
      continue;
    }
    const content = await getContent(repository, file, reference, httpClient, headers);
    if (content && mentionsPhpVersion(content.text, targetPhpMinor)) {
      evidence.push({
        confidence: 0.68,
        detail: `${file} at package source reference mentions PHP ${targetPhpMinor}.`,
        type: "changelog",
        url: content.htmlUrl,
        version,
      });
    }
  }
  return evidence;
}

async function inspectWorkflowFiles(
  repository: GitHubRepository,
  reference: string,
  version: string,
  targetPhpMinor: string,
  httpClient: HttpClient,
  headers: HeadersInit | undefined,
): Promise<GitHubEvidence[]> {
  const entries = await getJson<
    readonly { name: string; type: string; path: string; html_url: string }[] | { message?: string }
  >(
    apiUrl(repository, `/contents/${WORKFLOW_DIRECTORY}?ref=${encodeURIComponent(reference)}`),
    httpClient,
    headers,
    true,
  );
  if (!Array.isArray(entries)) {
    return [];
  }
  const evidence: GitHubEvidence[] = [];
  for (const entry of entries.filter((item) => item.type === "file")) {
    const content = await getContent(repository, entry.path, reference, httpClient, headers);
    if (content && mentionsPhpVersion(content.text, targetPhpMinor)) {
      evidence.push({
        confidence: 0.82,
        detail: `GitHub Actions workflow ${entry.name} at package source reference mentions PHP ${targetPhpMinor}.`,
        type: "ci",
        url: entry.html_url,
        version,
      });
    }
  }
  return evidence;
}

async function getContent(
  repository: GitHubRepository,
  path: string,
  reference: string,
  httpClient: HttpClient,
  headers: HeadersInit | undefined,
): Promise<{ text: string; htmlUrl: string } | undefined> {
  const content = await getJson<
    { content?: string; encoding?: string; html_url: string } | { message?: string }
  >(
    apiUrl(repository, `/contents/${path}?ref=${encodeURIComponent(reference)}`),
    httpClient,
    headers,
    true,
  );
  if (!("content" in content) || content.encoding !== "base64" || !content.content) {
    return undefined;
  }
  return {
    htmlUrl: content.html_url,
    text: Buffer.from(content.content, "base64").toString("utf8"),
  };
}

async function getJson<T>(
  url: string,
  httpClient: HttpClient,
  headers: HeadersInit | undefined,
  allowNotFound = false,
): Promise<T> {
  const response = await httpClient(url, { headers });
  if (allowNotFound && response.status === 404) {
    return { message: "Not Found" } as T;
  }
  if (!response.ok) {
    throw new Error(`GitHub request failed for ${url}: HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

function apiUrl(repository: GitHubRepository, path: string): string {
  return `https://api.github.com/repos/${repository.owner}/${repository.repo}${path}`;
}

function mentionsPhpVersion(text: string, targetPhpMinor: string): boolean {
  const escaped = targetPhpMinor.replace(".", String.raw`\.`);
  return new RegExp(`php[^\n\r]{0,60}${escaped}|${escaped}[^\n\r]{0,60}php`, "i").test(text);
}

function compareEvidence(left: GitHubEvidence, right: GitHubEvidence): number {
  const leftVersion = left.version ? normalizeVersion(left.version) : "999999.0.0";
  const rightVersion = right.version ? normalizeVersion(right.version) : "999999.0.0";
  return compareVersions(leftVersion, rightVersion) || right.confidence - left.confidence;
}
