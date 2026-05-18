import { inspectGitHubEvidence } from "../src/github.js";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", ...headers },
    status,
  });
}

const versions = [
  {
    normalizedVersion: "1.0.0",
    sourceReference: "v1.0.0",
    version: "1.0.0",
  },
];

describe(inspectGitHubEvidence, () => {
  it("uses GitHub GraphQL for releases, documents, and workflow evidence", async () => {
    const requests: { url: string; body: { query: string; variables: Record<string, string> } }[] =
      [];
    const report = await inspectGitHubEvidence({
      currentVersion: "1.0.0",
      githubToken: "token",
      httpClient: async (url, init) => {
        const body = typeof init?.body === "string" ? init.body : "{}";
        requests.push({
          body: JSON.parse(body) as {
            query: string;
            variables: Record<string, string>;
          },
          url,
        });
        if (requests.length === 1) {
          return jsonResponse({
            data: {
              rateLimit: { cost: 1, remaining: 4000, resetAt: "2026-05-18T13:00:00Z" },
              repository: {
                releases: {
                  nodes: [
                    {
                      description: "Adds PHP 8.3 support.",
                      tagName: "v1.0.0",
                      url: "https://github.com/vendor/a/releases/tag/v1.0.0",
                    },
                  ],
                },
              },
            },
          });
        }
        return jsonResponse({
          data: {
            rateLimit: { cost: 2, remaining: 3998, resetAt: "2026-05-18T13:00:00Z" },
            repository: {
              document0: { text: "Changelog mentions PHP 8.3." },
              workflowTree: {
                entries: [
                  {
                    name: "ci.yml",
                    object: { text: "php-version: ['8.2', '8.3']" },
                    path: ".github/workflows/ci.yml",
                    type: "blob",
                  },
                ],
              },
            },
          },
        });
      },
      sourceUrl: "https://github.com/vendor/a.git",
      targetPhpMinor: "8.3",
      versions,
    });

    expect(requests.map((request) => request.url)).toEqual([
      "https://api.github.com/graphql",
      "https://api.github.com/graphql",
    ]);
    expect(requests[1]?.body.variables.referencePlus0).toBe("v1.0.0:CHANGELOG.md");
    expect(requests[1]?.body.variables.workflowExpression).toBe("v1.0.0:.github/workflows");
    expect(report.errors).toEqual([]);
    expect(report.evidence.map((item) => item.type).toSorted()).toEqual([
      "changelog",
      "ci",
      "release",
    ]);
  });

  it("retries GitHub GraphQL requests after 429 responses", async () => {
    let attempts = 0;
    const slept: number[] = [];
    const report = await inspectGitHubEvidence({
      currentVersion: "1.0.0",
      httpClient: async () => {
        attempts += 1;
        if (attempts === 1) {
          return jsonResponse({ message: "rate limited" }, 429, { "retry-after": "2" });
        }
        return jsonResponse({
          data: {
            rateLimit: { cost: 1, remaining: 50, resetAt: "2026-05-18T13:00:00Z" },
            repository: { releases: { nodes: [] } },
          },
        });
      },
      maxRateLimitDelayMs: 500,
      sleep: async (milliseconds) => {
        slept.push(milliseconds);
      },
      sourceUrl: "https://github.com/vendor/a.git",
      targetPhpMinor: "8.3",
      versions,
    });

    expect(slept).toEqual([500]);
    expect(attempts).toBeGreaterThan(1);
    expect(report.errors.some((error) => error.includes("HTTP 429"))).toBe(false);
  });
});
