# PHP Composer Upgrade Advisor

A Node.js and TypeScript CLI for PHP version upgrade planning.
It estimates minimum Composer package versions for a target PHP minor version.

The implementation is evidence-oriented:

1. It recursively discovers `composer.json` files.
2. It reads adjacent `composer.lock` or `composer.lock.json` files.
3. It keeps the Composer root folder name for multi-app repositories.
4. It reads locked package versions and locked `require.php` constraints.
5. It queries Packagist metadata.
6. It selects the lowest stable version at or above the locked version.
7. The selected version must allow the target PHP minor through `require.php`.
8. It infers GitHub repositories from package source metadata when possible.
9. It uses GitHub GraphQL for release and repository file inspection.
10. It retries 429 responses with bounded wait time.
11. It inspects releases and repository documentation files.
12. It also inspects GitHub Actions workflows.
13. It emits confidence scores and per-package evidence.

Package status values are:

- `no-update-needed`
- `update-needed`
- `unsupported`
- `unknown`

## Usage

```bash
pnpm --filter @my-app/php-composer-upgrade-advisor build
node packages/php-composer-upgrade-advisor/dist/cli.js \
  --root /path/to/php/repo \
  --from-php 8.1 \
  --to-php 8.3 \
  --format markdown
```

Options:

- `--root <dir>`: repository root to scan recursively.
- `--from-php <major.minor>`: current production PHP minor version.
- `--to-php <major.minor>`: target PHP minor version.
- `--format json|markdown`: report format. Defaults to `markdown`.
- `--output <file>`: write the report to a file instead of stdout.
- `--include-dev`: include `packages-dev` from lock files.
- `--no-github`: skip GitHub release, changelog, and workflow inspection.
- `--github-token <token>`: GitHub GraphQL API token. Defaults to `GITHUB_TOKEN`.

## Determinism model

Packagist `require.php` metadata is the strongest signal.
It is the same metadata Composer uses for dependency solving.
GitHub release, changelog, and CI workflow mentions are supporting evidence.
They improve explainability, but do not override Packagist constraints.
GitHub evidence uses the GraphQL API to reduce request count.
Use `--github-token` or `GITHUB_TOKEN` for GraphQL inspection.
Use `--no-github` when a token is unavailable.

The tool does not rewrite `composer.json` or `composer.lock`.
Use its output as an evidence-backed upgrade plan.
Then run Composer in the target PHP environment to validate the full graph.
