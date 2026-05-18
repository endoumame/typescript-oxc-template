#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { analyzePhpComposerUpgrade } from "./advisor.js";
import { renderMarkdownReport } from "./report.js";

interface CliOptions {
  readonly rootDirectory: string;
  readonly fromPhp: string;
  readonly toPhp: string;
  readonly format: "json" | "markdown";
  readonly output?: string;
  readonly includeDev: boolean;
  readonly inspectGitHub: boolean;
  readonly githubToken?: string;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const report = await analyzePhpComposerUpgrade({
    fromPhp: options.fromPhp,
    githubToken: options.githubToken,
    includeDev: options.includeDev,
    inspectGitHub: options.inspectGitHub,
    rootDirectory: options.rootDirectory,
    toPhp: options.toPhp,
  });
  const output =
    options.format === "json"
      ? `${JSON.stringify(report, null, 2)}\n`
      : renderMarkdownReport(report);
  if (options.output) {
    await writeFile(options.output, output, "utf8");
    return;
  }
  process.stdout.write(output);
}

function parseArgs(args: readonly string[]): CliOptions {
  let rootDirectory = process.cwd();
  let fromPhp: string | undefined;
  let toPhp: string | undefined;
  let format: "json" | "markdown" = "markdown";
  let output: string | undefined;
  let includeDev = false;
  let inspectGitHub = true;
  let githubToken = process.env.GITHUB_TOKEN;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--root": {
        rootDirectory = resolve(requiredValue(args, ++index, arg));
        break;
      }
      case "--from-php": {
        fromPhp = requiredValue(args, ++index, arg);
        break;
      }
      case "--to-php": {
        toPhp = requiredValue(args, ++index, arg);
        break;
      }
      case "--format": {
        const value = requiredValue(args, ++index, arg);
        if (value !== "json" && value !== "markdown") {
          throw new Error("--format must be json or markdown");
        }
        format = value;
        break;
      }
      case "--output": {
        output = resolve(requiredValue(args, ++index, arg));
        break;
      }
      case "--include-dev": {
        includeDev = true;
        break;
      }
      case "--no-github": {
        inspectGitHub = false;
        break;
      }
      case "--github-token": {
        githubToken = requiredValue(args, ++index, arg);
        break;
      }
      case "--help":
      case "-h": {
        process.stdout.write(helpText());
        process.exit(0);
        break;
      }
      default: {
        throw new Error(`Unknown argument: ${arg}\n${helpText()}`);
      }
    }
  }

  if (!fromPhp || !toPhp) {
    throw new Error(`--from-php and --to-php are required.\n${helpText()}`);
  }
  return { format, fromPhp, githubToken, includeDev, inspectGitHub, output, rootDirectory, toPhp };
}

function requiredValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function helpText(): string {
  return `Usage: php-composer-upgrade-advisor --from-php 8.1 --to-php 8.3 [options]\n\nOptions:\n  --root <dir>          Repository root to scan recursively. Defaults to cwd.\n  --format <kind>      markdown or json. Defaults to markdown.\n  --output <file>      Write report to a file instead of stdout.\n  --include-dev        Include packages from packages-dev.\n  --no-github          Skip GitHub release/changelog/workflow inspection.\n  --github-token <tok> Use a GitHub API token. Defaults to GITHUB_TOKEN.\n`;
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exit(1);
});
