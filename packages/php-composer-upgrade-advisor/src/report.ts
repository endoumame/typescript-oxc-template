import type { PackageAdvisory, UpgradeReport } from "./advisor.js";

export function renderMarkdownReport(report: UpgradeReport): string {
  const lines: string[] = [];
  lines.push(`# PHP Composer Upgrade Advisory`);
  lines.push("");
  lines.push(`- From PHP: ${report.input.fromPhp}`);
  lines.push(`- To PHP: ${report.input.toPhp}`);
  lines.push(`- Root: ${report.input.rootDirectory}`);
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push("");
  for (const project of report.projects) {
    lines.push(`## ${project.rootName} (${project.directory})`);
    lines.push("");
    lines.push(`- composer.json: ${project.composerJsonPath}`);
    lines.push(`- lock: ${project.lockPath ?? "not found"}`);
    lines.push("");
    lines.push("| package | current | status | minimum | update | confidence |");
    lines.push("| --- | ---: | --- | ---: | --- | ---: |");
    for (const pkg of project.packages) {
      lines.push(
        `| ${pkg.packageName}${pkg.dev ? " (dev)" : ""} | ${pkg.currentVersion} | ${pkg.status} | ${pkg.minimumVersion ?? "-"} | ${pkg.updateLevel ?? "-"} | ${pkg.confidenceScore} |`,
      );
    }
    lines.push("");
    for (const pkg of project.packages) {
      lines.push(renderPackageDetails(pkg));
    }
  }
  return `${lines.join("\n")}\n`;
}

function renderPackageDetails(pkg: PackageAdvisory): string {
  const lines: string[] = [];
  lines.push(`### ${pkg.packageName}`);
  lines.push("");
  lines.push(`- Current: ${pkg.currentVersion}`);
  lines.push(`- Current PHP constraint: ${pkg.currentPhpConstraint ?? "<none>"}`);
  lines.push(`- Status: ${pkg.status}`);
  lines.push(`- Minimum version: ${pkg.minimumVersion ?? "not found"}`);
  lines.push(`- Update level: ${pkg.updateLevel ?? "unknown"}`);
  lines.push(`- Confidence: ${pkg.confidenceScore}`);
  lines.push("- Evidence:");
  for (const evidence of pkg.evidence) {
    lines.push(
      `  - [${evidence.source}] ${evidence.detail}${evidence.url ? ` (${evidence.url})` : ""}`,
    );
  }
  if (pkg.errors.length > 0) {
    lines.push("- Errors:");
    for (const error of pkg.errors) {
      lines.push(`  - ${error}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}
