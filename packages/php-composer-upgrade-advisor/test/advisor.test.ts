import { resolve } from "node:path";
import { analyzePhpComposerUpgrade } from "../src/advisor.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

const packagistPayloads: Record<string, unknown> = {
  "https://repo.packagist.org/p2/vendor%2Fa.json": {
    packages: {
      "vendor/a": [
        {
          name: "vendor/a",
          require: { php: ">=8.1 <8.3" },
          source: { url: "https://github.com/vendor/a.git", reference: "aaa" },
          version: "1.0.0",
        },
        {
          name: "vendor/a",
          require: { php: "^8.1 || ^8.3" },
          source: { url: "https://github.com/vendor/a.git", reference: "a110" },
          version: "1.1.0",
        },
        {
          name: "vendor/a",
          require: { php: "^8.3" },
          source: { url: "https://github.com/vendor/a.git", reference: "a200" },
          version: "2.0.0",
        },
      ],
    },
  },
  "https://repo.packagist.org/p2/vendor%2Fb.json": {
    packages: {
      "vendor/b": [
        {
          name: "vendor/b",
          require: { php: "^8.1 || ^8.3" },
          source: { url: "https://github.com/vendor/b.git", reference: "bbb" },
          version: "2.4.0",
        },
      ],
    },
  },
  "https://repo.packagist.org/p2/vendor%2Fc.json": {
    packages: {
      "vendor/c": [
        {
          name: "vendor/c",
          require: { php: ">=8.0 <8.4" },
          source: { url: "https://github.com/vendor/c.git", reference: "ccc" },
          version: "1.2.3",
        },
      ],
    },
  },
};

describe(analyzePhpComposerUpgrade, () => {
  it("reports minimum package updates from Packagist metadata", async () => {
    const root = resolve(import.meta.dirname, "fixtures/sample-php-project");
    const report = await analyzePhpComposerUpgrade({
      fromPhp: "8.1",
      httpClient: async (url) => jsonResponse(packagistPayloads[url]),
      inspectGitHub: false,
      rootDirectory: root,
      toPhp: "8.3",
    });

    const app = report.projects.find((project) => project.rootName === "app");
    const packageA = app?.packages.find((pkg) => pkg.packageName === "vendor/a");
    const packageB = app?.packages.find((pkg) => pkg.packageName === "vendor/b");

    expect(packageA?.status).toBe("update-needed");
    expect(packageA?.minimumVersion).toBe("1.1.0");
    expect(packageA?.updateLevel).toBe("minor");
    expect(packageB?.status).toBe("no-update-needed");
    expect(packageB?.minimumVersion).toBe("2.4.0");
    expect(app?.packages.some((pkg) => pkg.packageName === "vendor/dev")).toBe(false);
    expect(
      report.projects.find((project) => project.rootName === "worker")?.packages[0]?.status,
    ).toBe("no-update-needed");
  });
});
