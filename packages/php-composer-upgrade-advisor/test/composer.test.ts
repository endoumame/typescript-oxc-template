import { resolve } from "node:path";
import { discoverComposerProjects } from "../src/composer.js";

describe(discoverComposerProjects, () => {
  it("finds composer.json files recursively and supports composer.lock.json", async () => {
    const root = resolve(import.meta.dirname, "fixtures/sample-php-project");
    const projects = await discoverComposerProjects(root);

    expect(projects.map((project) => project.directory)).toEqual(["app", "worker"]);
    expect(projects[0]?.rootName).toBe("app");
    expect(projects[0]?.lockPath).toBe("app/composer.lock");
    expect(projects[0]?.lockedPackages.map((pkg) => pkg.name)).toEqual([
      "vendor/a",
      "vendor/b",
      "vendor/dev",
    ]);
    expect(projects[1]?.lockPath).toBe("worker/composer.lock.json");
  });
});
