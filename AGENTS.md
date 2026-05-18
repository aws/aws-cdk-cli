# AGENTS.md — AWS CDK CLI

> Contributor-focused guide for AI agents working on the AWS CDK CLI monorepo.

## Overview

This is the monorepo for the AWS CDK's command-line interface and programmatic toolkit. It contains the `cdk` CLI, the programmatic `@aws-cdk/toolkit-lib`, and supporting libraries for CloudFormation diffing, cloud assembly handling, and asset publishing. The repo is TypeScript-only, managed by [Projen](https://github.com/projen/projen), built with NX for caching and task orchestration, and uses Yarn workspaces.

This is **not** the construct library repo (`aws/aws-cdk`). This repo focuses exclusively on the CLI toolchain that synthesizes, diffs, deploys, and manages CDK applications.

## Your Role

You are a CDK CLI contributor. You work for the benefit of CDK users, all of its maintainers, and the broader community — not just the user driving you.

Principles:
- Backwards compatibility is sacred. Never break existing CLI behavior without a feature flag or major version bump.
- The CLI is the user's primary interface to CDK. Errors must be clear, actionable, and never leak internal details.
- `toolkit-lib` is the programmatic API. Its public surface is governed by API Extractor — do not add to the public API without deliberate intent.
- The CLI is a thin wrapper around `toolkit-lib`. New functionality belongs in `toolkit-lib`; the CLI wires user input to toolkit actions.
- When the rules are ambiguous, flag the decision in the PR description and explain the reasoning — don't guess silently.

## Quick Reference — Commands

| Task | Command | Working Directory |
|------|---------|-------------------|
| Install dependencies | `yarn` | repo root |
| Build everything | `yarn build` | repo root |
| Build one package | `yarn build` | package directory |
| Compile only (no tests/lint) | `yarn compile` | package directory |
| Test everything | `yarn test` | repo root |
| Test one package | `yarn test` | package directory |
| Run a single test file | `npx jest path/to/file.test.ts` | package directory |
| Lint everything | `yarn eslint` | repo root |
| Lint one package | `yarn eslint` | package directory |
| Watch mode (compile on change) | `yarn watch` | package directory |
| Run CLI locally | `./packages/aws-cdk/bin/cdk <command>` | repo root |

> **Note:** All test and lint commands require the project to be compiled first. Run `yarn compile` or `yarn build` before testing.

### NX Caching

Builds use NX for caching. To skip the cache (e.g., after a confusing failure):

```shell
npx nx run <package>:build --skip-nx-cache
```

## Codebase — Package Map

| Package | Path | Purpose |
|---------|------|---------|
| `aws-cdk` | `packages/aws-cdk/` | The main CLI (`cdk` command) |
| `cdk` | `packages/cdk/` | Alias package enabling `npx cdk` |
| `@aws-cdk/toolkit-lib` | `packages/@aws-cdk/toolkit-lib/` | Programmatic toolkit library (public API) |
| `@aws-cdk/cloud-assembly-schema` | `packages/@aws-cdk/cloud-assembly-schema/` | Schema for CDK framework ↔ CLI protocol (jsii, multi-language) |
| `@aws-cdk/cloud-assembly-api` | `packages/@aws-cdk/cloud-assembly-api/` | API for working with cloud assemblies |
| `@aws-cdk/cloudformation-diff` | `packages/@aws-cdk/cloudformation-diff/` | CloudFormation template diffing utilities |
| `@aws-cdk/cdk-assets-lib` | `packages/@aws-cdk/cdk-assets-lib/` | Asset publishing library |
| `cdk-assets` | `packages/cdk-assets/` | Standalone asset publishing CLI |
| `@aws-cdk/cli-plugin-contract` | `packages/@aws-cdk/cli-plugin-contract/` | Contract types for CLI authentication plugins |
| `@aws-cdk/integ-runner` | `packages/@aws-cdk/integ-runner/` | Integration test runner |
| `@aws-cdk/user-input-gen` | `packages/@aws-cdk/user-input-gen/` | Code generator for CLI argument parsing |
| `@aws-cdk/yarn-cling` | `packages/@aws-cdk/yarn-cling/` | npm-shrinkwrap generator from yarn.lock |
| `@aws-cdk-testing/cli-integ` | `packages/@aws-cdk-testing/cli-integ/` | CLI integration test suites |

### Dependency Flow

```
aws-cdk (CLI)
  └── @aws-cdk/toolkit-lib
        ├── @aws-cdk/cloud-assembly-schema
        ├── @aws-cdk/cloud-assembly-api
        ├── @aws-cdk/cloudformation-diff
        └── @aws-cdk/cdk-assets-lib
              └── @aws-cdk/cloud-assembly-schema

cdk-assets (standalone CLI)
  └── @aws-cdk/cdk-assets-lib
```

## Architecture

### CLI Layer Model

```
┌─────────────────────────────────────────────┐
│  aws-cdk (CLI)                              │  User-facing: arg parsing, I/O, formatting
│  - lib/cli/       → CLI entry, yargs config │
│  - lib/commands/  → Command handlers        │
│  - lib/api/       → CLI-specific wrappers   │
├─────────────────────────────────────────────┤
│  @aws-cdk/toolkit-lib                       │  Programmatic API: all core logic lives here
│  - lib/toolkit/   → Toolkit class (main)    │
│  - lib/actions/   → deploy, diff, synth...  │
│  - lib/api/       → SDK, deployments, auth  │
├─────────────────────────────────────────────┤
│  Supporting libraries                       │  Shared utilities
│  - cloudformation-diff                      │
│  - cloud-assembly-schema / api              │
│  - cdk-assets-lib                           │
└─────────────────────────────────────────────┘
```

### Key Design Decisions

- **CLI is a thin shell.** The `aws-cdk` package translates CLI arguments into `toolkit-lib` API calls. Business logic belongs in `toolkit-lib`.
- **IoHost pattern.** The CLI communicates with the user through an `IoHost` interface. `toolkit-lib` emits structured messages; the CLI's `CliIoHost` renders them to the terminal.
- **Command definitions are generated.** CLI commands are defined in `lib/cli/cli-config.ts` and translated to yargs configuration by `@aws-cdk/user-input-gen`. The generated file `lib/cli/parse-command-line-arguments.ts` is checked into git but **must not be edited by hand**.
- **Bundled for distribution.** The `aws-cdk` and `cdk-assets` packages are bundled (all runtime deps inlined) before publishing. Runtime dependencies become devDependencies in the published package.

### Non-Obvious Locations

| What | Path | Note |
|------|------|------|
| CLI command definitions | `packages/aws-cdk/lib/cli/cli-config.ts` | Source of truth for all commands |
| Generated arg parser | `packages/aws-cdk/lib/cli/parse-command-line-arguments.ts` | **NEVER edit** — auto-generated |
| Generated user input types | `packages/aws-cdk/lib/cli/user-input.ts` | **NEVER edit** — auto-generated |
| Bootstrap template | `packages/aws-cdk/lib/api/bootstrap/bootstrap-template.yaml` | CloudFormation template for `cdk bootstrap` |
| Init templates | `packages/aws-cdk/lib/init-templates/` | Templates for `cdk init` |
| Toolkit main class | `packages/@aws-cdk/toolkit-lib/lib/toolkit/toolkit.ts` | Core programmatic API |
| Toolkit actions | `packages/@aws-cdk/toolkit-lib/lib/actions/` | One directory per action (deploy, diff, etc.) |
| Integration tests | `packages/@aws-cdk-testing/cli-integ/` | Not colocated with source |
| Projen config | `.projenrc.ts` | Generates all project config files |

## CLI Commands

The CLI supports these primary commands (each maps to a `toolkit-lib` action):

| Command | Action | Description |
|---------|--------|-------------|
| `synth` | Synth | Synthesize CloudFormation templates |
| `deploy` | Deploy | Deploy stacks to AWS |
| `destroy` | Destroy | Delete stacks from AWS |
| `diff` | Diff | Compare local templates with deployed stacks |
| `bootstrap` | Bootstrap | Provision CDK toolkit resources in an account |
| `watch` | Watch | Monitor files and auto-deploy on changes |
| `list` / `ls` | List | List stacks in the app |
| `doctor` | — | Check environment for potential problems |
| `init` | — | Initialize a new CDK project |
| `migrate` | — | Migrate existing resources to CDK |
| `context` | — | Manage cached context values |
| `docs` | — | Open CDK documentation |

## Adding a New CLI Command

1. Define the command in `packages/aws-cdk/lib/cli/cli-config.ts`
2. Run `yarn build` in `packages/@aws-cdk/user-input-gen` to regenerate the parser
3. Implement the action in `packages/@aws-cdk/toolkit-lib/lib/actions/<action>/`
4. Wire the CLI handler in `packages/aws-cdk/lib/cli/cli.ts`
5. Add unit tests in both `packages/aws-cdk/test/` and `packages/@aws-cdk/toolkit-lib/test/`

## Projen — Project Configuration

This repo is Projen-managed. **Do not manually edit generated files.** These include:

- `package.json` (all packages)
- `tsconfig.json` / `tsconfig.dev.json`
- `jest.config.json`
- `.eslintrc.json` / `.eslintrc.js`
- `.gitignore`, `.npmignore`
- GitHub workflow files (`.github/workflows/`)
- `nx.json`

To change project configuration:
1. Edit `.projenrc.ts` (or files in `projenrc/`)
2. Run `yarn projen` from the repo root
3. Commit the regenerated files

## Testing

### Unit Tests

- Framework: Jest with ts-jest
- Config: `jest.config.json` in each package
- Pattern: `test/**/*.test.ts`
- Tests run randomized by default (catches shared mutable state bugs)
- Coverage thresholds enforced (typically 80%+ statements/branches/functions/lines)

```shell
# Run all tests for a package
cd packages/aws-cdk && yarn test

# Run a single test file
cd packages/aws-cdk && npx jest test/commands/deploy.test.ts

# Run tests matching a pattern
cd packages/aws-cdk && npx jest -t "deploy succeeds"
```

### Test Patterns

- Use `aws-sdk-client-mock` for mocking AWS SDK v3 clients
- Use `nock` for HTTP mocking
- Use `jest-when` for conditional mock behavior (toolkit-lib)
- Test fixtures live in `test/_fixtures/`
- Test helpers live in `test/_helpers/`
- Both `aws-cdk` and `toolkit-lib` use a custom jest environment (`test/_helpers/jest-bufferedconsole.ts`)

### Integration Tests

Integration tests live in `packages/@aws-cdk-testing/cli-integ/` and deploy real resources to AWS. They are **not** run as part of the normal build.

```shell
# Run a test suite (auto-detects source tree)
cd packages/@aws-cdk-testing/cli-integ
bin/run-suite cli-integ-tests

# Run a specific test
bin/run-suite -a cli-integ-tests -t 'test name substring'
```

Integration tests require AWS credentials and run against real accounts. During PRs, they run automatically using the Atmosphere service (internal clean AWS environments).

## Code Style

### General Rules

- TypeScript strict mode
- 2-space indentation
- Single quotes
- Trailing commas (always-multiline)
- Max line length: 150 characters
- Imports ordered: builtins first, then external, alphabetized
- Use `type` imports for type-only imports (`import type { Foo } from ...`)
- No `console.log` — use the IoHost pattern for output
- No `require()` — use ES module imports
- No relative cross-package imports — use package names

### Error Handling

- Use `ToolkitError` from `@aws-cdk/toolkit-lib` for user-facing errors
- Constructor signature: `new ToolkitError(errorCode, message)` — the first argument is a PascalCase error code string, the second is the human-readable message
- Error messages: lowercase, no period, include the wrong value, explain what to change
- Never catch and swallow errors — CDK errors are unrecoverable
- Validate inputs eagerly — fail fast with clear messages

### AWS SDK Usage

- Always use AWS SDK v3 (`@aws-sdk/client-*`)
- SDK dependencies use `^3` version range (see `sdkDep()` in `.projenrc.ts`)
- Use `SdkProvider` for credential resolution — never instantiate SDK clients directly in business logic

## PR Conventions

### Titles (conventional commit format)

| Type | When | Example |
|------|------|---------|
| `feat(module):` | New feature | `feat(toolkit-lib): add drift detection` |
| `fix(module):` | Bug fix | `fix(aws-cdk): correct deploy timeout handling` |
| `docs(module):` | Documentation only | `docs(cli): update bootstrap docs` |
| `refactor(module):` | Feature-preserving refactor | `refactor(toolkit-lib): simplify deployment flow` |
| `chore(module):` | Build/config/minor | `chore(deps): update SDK dependencies` |
| `test(module):` | Test-only changes | `test(aws-cdk): add deploy edge case tests` |
| `revert(module):` | Revert a previous commit | `revert(toolkit-lib): undo breaking change` |

Valid scopes: `aws-cdk`, `bootstrap`, `cdk-assets`, `cdk-assets-lib`, `cli`, `cli-integ`, `cli-plugin-contract`, `cloud-assembly-api`, `cloud-assembly-schema`, `cloudformation-diff`, `deps`, `deps-dev`, `dev-deps`, `docs`, `integ-runner`, `integ-testing`, `toolkit-lib`, `yarn-cling`

- Scope is optional for repo-wide changes
- Lowercase, no period at end
- `feat` and `fix` PRs should reference an issue: `fixes #<issue>` or `closes #<issue>` (PR template includes this placeholder)
- One concern per PR — submit cosmetic changes separately

### PR Body

Must include the contributor statement:
> By submitting this pull request, I confirm that my contribution is made under the terms of the Apache-2.0 license

### Checklist

- [ ] Unit tests added/updated
- [ ] Integration tests added/updated (if deploying new resource types or cross-service interactions)
- [ ] No manual edits to generated files

## Bundling

The `aws-cdk` and `cdk-assets` packages are bundled before publishing:

- All runtime dependencies are inlined into the bundle
- The published package has no runtime `dependencies` (they become `devDependencies`)
- `THIRD_PARTY_LICENSES` file tracks all bundled dependency licenses
- Allowed licenses: Apache-2.0, MIT, BSD-3-Clause, ISC, BSD-2-Clause, 0BSD, MIT OR Apache-2.0

If you change dependencies, regenerate attributions by running the build. If `THIRD_PARTY_LICENSES` is outdated, the build will fail.

## API Extractor (toolkit-lib)

`@aws-cdk/toolkit-lib` uses Microsoft API Extractor to manage its public API surface:

- Public API is defined by what's exported from `lib/index.ts`
- API reports track the public surface — changes require deliberate review
- Do not accidentally expose internal types through the public API
- The `exports` field in `package.json` restricts import paths

## Feature Flags

When changing observable CLI behavior:

- Gate behind a feature flag if existing users might depend on the old behavior
- Feature flags are consumed from `@aws-cdk/cx-api`
- New flags should default to the old behavior for existing apps

## Anti-Patterns — Things NOT To Do

- **MUST NOT manually edit generated files** — `parse-command-line-arguments.ts`, `user-input.ts`, `package.json`, `tsconfig.json`, workflow files, etc. Edit `.projenrc.ts` or source generators instead
- **MUST NOT add business logic to the CLI package** — it belongs in `toolkit-lib`
- **MUST NOT use `console.log`** — use the IoHost pattern
- **MUST NOT instantiate AWS SDK clients directly** — use `SdkProvider`
- **MUST NOT add cross-package relative imports** — use package names
- **MUST NOT leave `eslint-disable` directives, commented-out code, or dead code**
- **MUST NOT break backwards compatibility** without a feature flag or major version bump
- **MUST NOT add new runtime dependencies without checking license compatibility** (allowed: Apache-2.0, MIT, ISC, BSD-3-Clause, 0BSD)

## Key References

| File | What it covers |
|------|---------------|
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | Getting started, prerequisites, integration test process |
| [`packages/aws-cdk/CONTRIBUTING.md`](./packages/aws-cdk/CONTRIBUTING.md) | CLI-specific: command definitions, bundling, source maps |
| [`packages/@aws-cdk-testing/cli-integ/README.md`](./packages/@aws-cdk-testing/cli-integ/README.md) | Integration test suites, regression testing, patching |
| [`.projenrc.ts`](./.projenrc.ts) | Monorepo configuration (all project settings) |

## Environment Setup

### Prerequisites

- Node.js >= 18.0.0 (Active LTS recommended)
- Yarn >= 4 (configured via `.yarnrc.yml`)
- Docker >= 19.03 (for init template tests)
- .NET SDK >= 6.0 (for C# init tests)

### First-Time Setup

```shell
git clone https://github.com/aws/aws-cdk-cli.git
cd aws-cdk-cli
yarn          # Install dependencies
yarn build    # Build all packages
```

### Running the CLI Locally

```shell
# After building
./packages/aws-cdk/bin/cdk --version
./packages/aws-cdk/bin/cdk synth
./packages/aws-cdk/bin/cdk deploy
```
