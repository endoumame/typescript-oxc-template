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
export type Sleep = (milliseconds: number) => Promise<void>;

interface GraphQlRateLimit {
  readonly cost: number;
  readonly remaining: number;
  readonly resetAt: string;
}

interface GraphQlError {
  readonly message: string;
  readonly type?: string;
}

interface GraphQlResponse<T> {
  readonly data?: T;
  readonly errors?: readonly GraphQlError[];
}

interface GitHubReleaseNode {
  readonly tagName: string;
  readonly description?: string;
  readonly url: string;
}

interface GitHubBlobNode {
  readonly text?: string;
}

interface GitHubTreeEntry {
  readonly name: string;
  readonly path: string;
  readonly type: string;
  readonly object?: GitHubBlobNode;
}

interface GitHubTreeNode {
  readonly entries: readonly GitHubTreeEntry[];
}

interface ReleaseQueryData {
  readonly rateLimit: GraphQlRateLimit;
  readonly repository?: {
    readonly releases: {
      readonly nodes: readonly GitHubReleaseNode[];
    };
  };
}

interface ReferenceFilesQueryData {
  readonly rateLimit: GraphQlRateLimit;
  readonly repository?: Record<string, GitHubBlobNode | GitHubTreeNode | undefined>;
}

interface GraphQlClientOptions {
  readonly httpClient: HttpClient;
  readonly githubToken?: string;
  readonly sleep: Sleep;
  readonly maxRetries: number;
  readonly maxRateLimitDelayMs: number;
}

interface GitHubGraphQlClient {
  readonly request: <T>(query: string, variables: Record<string, unknown>) => Promise<T>;
}

const DOCUMENT_FILES = ["CHANGELOG.md", "CHANGELOG", "UPGRADE.md", "UPGRADING.md", "README.md"];
const WORKFLOW_DIRECTORY = ".github/workflows";
const GITHUB_GRAPHQL_ENDPOINT = "https://api.github.com/graphql";
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_MAX_RATE_LIMIT_DELAY_MS = 30_000;
const LOW_REMAINING_RATE_LIMIT = 10;
const MAX_CANDIDATE_VERSIONS = 80;
const defaultSleep: Sleep = async (milliseconds) => {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
};

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
  readonly sleep?: Sleep;
  readonly maxRetries?: number;
  readonly maxRateLimitDelayMs?: number;
}): Promise<GitHubInspection> {
  const repository = parseGitHubRepository(input.sourceUrl);
  if (!repository) {
    return {
      errors: ["No GitHub repository could be inferred from package source URL."],
      evidence: [],
    };
  }
  const client = createGitHubGraphQlClient({
    githubToken: input.githubToken,
    httpClient: input.httpClient ?? fetch,
    maxRateLimitDelayMs: input.maxRateLimitDelayMs ?? DEFAULT_MAX_RATE_LIMIT_DELAY_MS,
    maxRetries: input.maxRetries ?? DEFAULT_MAX_RETRIES,
    sleep: input.sleep ?? defaultSleep,
  });
  const candidateVersions = input.versions
    .filter(
      (version) =>
        compareVersions(version.normalizedVersion, normalizeVersion(input.currentVersion)) >= 0,
    )
    .slice(0, MAX_CANDIDATE_VERSIONS);
  const evidence: GitHubEvidence[] = [];
  const errors: string[] = [];

  try {
    evidence.push(
      ...(await inspectReleases(repository, candidateVersions, input.targetPhpMinor, client)),
    );
  } catch (error) {
    errors.push(`GitHub GraphQL release inspection failed: ${errorMessage(error)}`);
  }
  try {
    evidence.push(
      ...(await inspectRepositoryFiles(
        repository,
        candidateVersions,
        input.targetPhpMinor,
        client,
      )),
    );
  } catch (error) {
    errors.push(`GitHub GraphQL file inspection failed: ${errorMessage(error)}`);
  }

  return { errors, evidence: evidence.sort(compareEvidence), repository };
}

async function inspectReleases(
  repository: GitHubRepository,
  versions: readonly { version: string; normalizedVersion: string }[],
  targetPhpMinor: string,
  client: GitHubGraphQlClient,
): Promise<GitHubEvidence[]> {
  const payload = await client.request<ReleaseQueryData>(
    `query PackageReleases($owner: String!, $repo: String!) {
      rateLimit { cost remaining resetAt }
      repository(owner: $owner, name: $repo) {
        releases(first: 100, orderBy: { field: CREATED_AT, direction: DESC }) {
          nodes { tagName description url }
        }
      }
    }`,
    { ...repository },
  );
  const releases = payload.repository?.releases.nodes ?? [];
  const matches: GitHubEvidence[] = [];
  for (const version of versions) {
    const release = releases.find(
      (item) => normalizeVersion(item.tagName) === version.normalizedVersion,
    );
    if (
      release &&
      mentionsPhpVersion(`${release.tagName}\n${release.description ?? ""}`, targetPhpMinor)
    ) {
      matches.push({
        confidence: rateLimitAdjustedConfidence(0.72, payload.rateLimit),
        detail: `GitHub GraphQL release text mentions PHP ${targetPhpMinor}.`,
        type: "release",
        url: release.url,
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
  client: GitHubGraphQlClient,
): Promise<GitHubEvidence[]> {
  const matches: GitHubEvidence[] = [];
  for (const version of versions) {
    const reference = version.sourceReference ?? version.version;
    const payload = await inspectReferenceFiles(
      repository,
      reference,
      version.version,
      targetPhpMinor,
      client,
    );
    matches.push(...payload);
    if (
      matches.some((match) => match.type === "ci") &&
      matches.some((match) => match.type === "changelog")
    ) {
      break;
    }
  }
  return matches;
}

async function inspectReferenceFiles(
  repository: GitHubRepository,
  reference: string,
  version: string,
  targetPhpMinor: string,
  client: GitHubGraphQlClient,
): Promise<GitHubEvidence[]> {
  const payload = await client.request<ReferenceFilesQueryData>(referenceFilesQuery(), {
    ...repository,
    reference,
  });
  const repositoryPayload = payload.repository ?? {};
  return [
    ...documentEvidence(
      repository,
      repositoryPayload,
      reference,
      version,
      targetPhpMinor,
      payload.rateLimit,
    ),
    ...workflowEvidence(
      repository,
      repositoryPayload.workflowTree,
      reference,
      version,
      targetPhpMinor,
      payload.rateLimit,
    ),
  ];
}

function documentEvidence(
  repository: GitHubRepository,
  repositoryPayload: Record<string, GitHubBlobNode | GitHubTreeNode | undefined>,
  reference: string,
  version: string,
  targetPhpMinor: string,
  rateLimit: GraphQlRateLimit,
): GitHubEvidence[] {
  return DOCUMENT_FILES.flatMap((file, index) => {
    const blob = repositoryPayload[documentAlias(index)] as GitHubBlobNode | undefined;
    if (!blob?.text || !mentionsPhpVersion(blob.text, targetPhpMinor)) {
      return [];
    }
    return [
      {
        confidence: rateLimitAdjustedConfidence(0.68, rateLimit),
        detail: `${file} at package source reference mentions PHP ${targetPhpMinor}.`,
        type: "changelog" as const,
        url: githubBlobUrl(repository, reference, file),
        version,
      },
    ];
  });
}

function workflowEvidence(
  repository: GitHubRepository,
  workflowTree: GitHubBlobNode | GitHubTreeNode | undefined,
  reference: string,
  version: string,
  targetPhpMinor: string,
  rateLimit: GraphQlRateLimit,
): GitHubEvidence[] {
  if (!workflowTree || !("entries" in workflowTree)) {
    return [];
  }
  return workflowTree.entries
    .filter((entry) => entry.type === "blob")
    .filter((entry) => entry.object?.text && mentionsPhpVersion(entry.object.text, targetPhpMinor))
    .map((entry) => ({
      confidence: rateLimitAdjustedConfidence(0.82, rateLimit),
      detail: `GitHub Actions workflow ${entry.name} at package source reference mentions PHP ${targetPhpMinor}.`,
      type: "ci" as const,
      url: githubBlobUrl(repository, reference, entry.path),
      version,
    }));
}

function referenceFilesQuery(): string {
  const documentFields = DOCUMENT_FILES.map(
    (file, index) =>
      `${documentAlias(index)}: object(expression: $referencePlus${index}) { ... on Blob { text } }`,
  ).join("\n");
  const documentVariables = DOCUMENT_FILES.map(
    (_file, index) => `$referencePlus${index}: String!`,
  ).join(", ");
  return `query ReferenceFiles($owner: String!, $repo: String!, ${documentVariables}, $workflowExpression: String!) {
    rateLimit { cost remaining resetAt }
    repository(owner: $owner, name: $repo) {
      ${documentFields}
      workflowTree: object(expression: $workflowExpression) {
        ... on Tree {
          entries {
            name
            path
            type
            object { ... on Blob { text } }
          }
        }
      }
    }
  }`;
}

function createGitHubGraphQlClient(options: GraphQlClientOptions): GitHubGraphQlClient {
  return {
    request: async <T>(query: string, variables: Record<string, unknown>) => {
      const expandedVariables = expandReferenceVariables(variables);
      for (let attempt = 0; attempt <= options.maxRetries; attempt += 1) {
        const response = await options.httpClient(GITHUB_GRAPHQL_ENDPOINT, {
          body: JSON.stringify({ query, variables: expandedVariables }),
          headers: githubGraphQlHeaders(options.githubToken),
          method: "POST",
        });
        const retryDelay = retryDelayMilliseconds(response, options.maxRateLimitDelayMs);
        if (response.status === 429 || retryDelay !== undefined) {
          if (attempt === options.maxRetries) {
            throw new Error(`GitHub GraphQL rate limit exceeded: HTTP ${response.status}`);
          }
          await options.sleep(retryDelay ?? 1000);
          continue;
        }
        if (!response.ok) {
          throw new Error(`GitHub GraphQL request failed: HTTP ${response.status}`);
        }
        const payload = (await response.json()) as GraphQlResponse<T>;
        if (payload.errors?.some((error) => isRateLimitError(error))) {
          if (attempt === options.maxRetries) {
            throw new Error(formatGraphQlErrors(payload.errors));
          }
          await options.sleep(1000);
          continue;
        }
        if (payload.errors?.length) {
          throw new Error(formatGraphQlErrors(payload.errors));
        }
        if (!payload.data) {
          throw new Error("GitHub GraphQL response did not include data.");
        }
        return payload.data;
      }
      throw new Error("GitHub GraphQL request retry loop exhausted.");
    },
  };
}

function expandReferenceVariables(variables: Record<string, unknown>): Record<string, unknown> {
  if (typeof variables.reference !== "string") {
    return variables;
  }
  const reference = variables.reference;
  return {
    ...variables,
    ...Object.fromEntries(
      DOCUMENT_FILES.map((file, index) => [`referencePlus${index}`, `${reference}:${file}`]),
    ),
    workflowExpression: `${reference}:${WORKFLOW_DIRECTORY}`,
  };
}

function githubGraphQlHeaders(githubToken: string | undefined): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
    "Content-Type": "application/json",
  };
}

function retryDelayMilliseconds(response: Response, maxDelayMs: number): number | undefined {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    return Math.min(Number(retryAfter) * 1000, maxDelayMs);
  }
  const remaining = response.headers.get("x-ratelimit-remaining");
  const reset = response.headers.get("x-ratelimit-reset");
  if ((response.status === 403 || response.status === 429) && remaining === "0" && reset) {
    const resetAt = Number(reset) * 1000;
    return Math.min(Math.max(resetAt - Date.now(), 1000), maxDelayMs);
  }
  return undefined;
}

function rateLimitAdjustedConfidence(confidence: number, rateLimit: GraphQlRateLimit): number {
  if (rateLimit.remaining < LOW_REMAINING_RATE_LIMIT) {
    return Number(Math.max(0, confidence - 0.03).toFixed(2));
  }
  return confidence;
}

function isRateLimitError(error: GraphQlError): boolean {
  return error.type === "RATE_LIMITED" || /rate limit/i.test(error.message);
}

function formatGraphQlErrors(errors: readonly GraphQlError[]): string {
  return errors.map((error) => error.message).join("; ");
}

function documentAlias(index: number): string {
  return `document${index}`;
}

function githubBlobUrl(repository: GitHubRepository, reference: string, path: string): string {
  return `https://github.com/${repository.owner}/${repository.repo}/blob/${encodeURIComponent(reference)}/${path}`;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
