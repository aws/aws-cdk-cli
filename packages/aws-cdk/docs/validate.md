# `cdk validate`

> **Status: unstable.** `validate` is gated behind the CLI's unstable-command
> check (`cliRequireUnstable`). Its command name, options, output, and exit-code
> behavior may change without a major version bump.

Synthesize a CDK app and check the resulting CloudFormation templates against
policy rules — **without deploying anything**. `validate` runs synth, collects
every validation signal it can find, prints a unified report, and exits with a
status code that reflects whether any violations were found.

## The mental model: a linter for your synthesized infrastructure

Think of the three main CDK commands as a spectrum:

- `cdk synth` — "Here's the CloudFormation I *would* produce."
- `cdk validate` — "Let me check that CloudFormation against your rules and
  CloudFormation's own opinion, tell you everything that's wrong, and get out of
  the way. **No changes to your AWS account.**"
- `cdk deploy` — "I'm sending it to AWS for real."

`validate` sits in the middle. It's a **linter for the templates your app
generates** — not for your TypeScript/Python source. Because it checks the
*synthesized output*, it sees your resources exactly as they'd be deployed,
regardless of which language or constructs produced them.

The useful part is the exit code: `0` = clean, `1` = violations found. That
makes `validate` a natural gate in CI or a pre-commit check.

## Usage

```shell
cdk validate [STACKS..] [options]
```

`STACKS` is an optional, variadic list of stack names/patterns. When omitted,
all stacks are selected recursively (the same selection behavior as the other
CLI commands).

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--online` | boolean | `true` | Submit each template to CloudFormation for early validation. Requires AWS credentials. Disable with `--no-online`. |
| `--watch` | boolean | `false` | Continuously re-synthesize and re-validate the app when project files change. Never deploys. Reads the `watch` key from `cdk.json` for which paths to observe. |

### Examples

```shell
# Validate every stack in the app (offline + online)
cdk validate

# Validate specific stacks
cdk validate MyStack MyOtherStack

# Offline only — skip the CloudFormation change-set validation (no creds needed)
cdk validate --no-online

# Watch mode: re-validate on file changes, offline only to keep each pass fast
cdk validate --watch --no-online
```

## What it checks

`validate` combines up to three independent sources into one unified report:

| Source | What it checks | AWS credentials? |
|--------|----------------|------------------|
| **Policy validation plugins** | Results of App-level `App.policyValidationBeta1` plugins, read from `validation-report.json` in the cloud assembly (`cdk.out/`). Filtered to the selected stacks. | No |
| **Construct annotations** | Errors and warnings attached to constructs during synthesis. Collected directly from the synthesized stacks. | No |
| **Online (CloudFormation)** | A CloudFormation *validation change set* is created per stack to catch template-level problems early (invalid properties, bad references). Enabled by `--online` (default). | Yes |

If online validation cannot complete for a stack (for example, missing
credentials or a service error), that stack is skipped with a warning
(`CDK_TOOLKIT_W9602`) rather than failing the whole run.

## Policy validation plugins and their rules

This is the most important source to understand, so here it is in depth.

### What a policy plugin is

A **policy validation plugin** is a piece of code you attach to your CDK `App`
that inspects your synthesized CloudFormation templates and flags anything that
breaks your organization's rules. A **rule** is one such check, for example:

- "S3 buckets must be encrypted."
- "No security group open to `0.0.0.0/0`."
- "Every resource must carry a `CostCenter` tag."

You wire plugins into the `App` through a dedicated hook:

```ts
const app = new App({
  policyValidationBeta1: [
    new SomePolicyPlugin(),   // <-- plugins plug in here
  ],
});
```

The `Beta1` suffix signals the API is not yet stable. Each plugin implements a
contract: CDK hands it the synthesized templates, and the plugin returns a
report listing violations — which rule was broken, how severe it is, and which
construct/resource caused it. CDK writes all of that into a
`validation-report.json` file in the cloud assembly.

### Where the rules actually live (and where they don't)

**The rules are not in this repo (`aws-cdk-cli`).** This repo only ever
*consumes* the results. It's worth being precise about the split, because it's a
common source of confusion:

| Thing | Where it lives |
|-------|----------------|
| The rules (the actual pass/fail logic) | In the **plugins**: aws-cdk-lib's built-in plugin, or third-party packages (cdk-nag, CloudFormation Guard), or a custom plugin you write — **all outside this repo** |
| Which rules run for your app | Your app's `App({ policyValidationBeta1: [...] })` array |
| The report file *contract* (its name + JSON schema) | `packages/@aws-cdk/cloud-assembly-schema/` (this repo) |
| The report *readers* | `toolkit-lib`'s `validate` action, and the `cdk-explorer` viewer (this repo) |

So the closest thing to "rules" you'll find in this repo is the **report
format** — the shape of the violations *after* the rules have already run. The
CLI reads `validation-report.json`, filters it to the selected stacks, and shows
it to you. It never authors or evaluates a rule itself.

Common sources of plugins/rules, all shipped separately from this repo:

- **aws-cdk-lib built-in** — `CloudFormationValidatePlugin` (see below).
- **cdk-nag** — large best-practice / compliance rule packs (HIPAA, NIST, PCI,
  AWS Solutions).
- **CloudFormation Guard** — AWS's policy-as-code language; you write rules in a
  `.guard` DSL and a plugin evaluates templates against them.
- **Custom** — any plugin your team writes against the `policyValidationBeta1`
  contract.

> The plugin *interface* (method names, exact report shape a plugin returns)
> lives in the CDK **construct library** (`aws-cdk-lib` / the `aws/aws-cdk`
> repo), not here. This repo defines only the on-disk report contract and the
> consumers.

### The built-in plugin: `CloudFormationValidatePlugin` (and WASM)

As of **aws-cdk-lib 2.262.0**, aws-cdk-lib ships its *own* policy plugin,
`CloudFormationValidatePlugin`, which is **on by default**. It acts as a
built-in CloudFormation template linter: every synth automatically checks your
synthesized template for correctness-type problems, without you wiring anything
up. Think of it as a spell-checker that turned itself on.

**Why WASM matters here.** The plugin's rules are evaluated by a rules engine
compiled to **WebAssembly (WASM)** — a portable, sandboxed binary format that
runs the same across any host with a WASM runtime. The likely motivation is
language-agnostic reuse: write the engine once, compile it to WASM, and run the
identical rules from CDK's TypeScript, Python, Java, etc. without rewriting them
per language. (That's the standard rationale for WASM in a plugin system; the
engine itself lives in aws-cdk-lib, so treat this as the general reason rather
than a line verified in *this* repo.)

The engine is initialized **lazily, on the first synth in a process**. That
first-synth initialization — loading and instantiating the WASM module — is a
one-time cost per process, and it is not cheap (multiple seconds).

**This has a visible consequence in this repo's tests.** Jest often runs each
test file in a separate worker process, and toolkit-lib tests synth constantly.
If every fresh process paid the WASM warm-up on its first synth, tests would
slow down and could even exceed their timeout on small CI runners — failing not
because of a real bug, but because the engine was slow to boot. Since these
tests exercise the toolkit, **not** aws-cdk-lib's template linter, the test
setup deliberately turns the plugin off:

```ts
// packages/@aws-cdk/toolkit-lib/test/_helpers/jest-setup-after-env.ts
process.env.CDK_VALIDATION = 'false';
```

That's purely a speed/stability optimization for the test suite; it has nothing
to do with `validate`'s runtime behavior.

## How it works

`validate` is a thin CLI wrapper over the `toolkit-lib` `validate` action. The
flow, layer by layer:

1. **CLI handler** (`packages/aws-cdk/lib/cli/cli.ts`)
   - Requires the unstable flag (`cliRequireUnstable(configuration, 'validate')`).
   - Sets a context flag before delegating:
     ```ts
     configuration.context.set('@aws-cdk/core:failSynthOnValidationErrors', false);
     ```
     This tells the framework **not** to abort synthesis on the first validation
     problem, so `validate` can synth fully and report *every* violation at once
     — instead of making you fix one, re-run, hit the next, and so on.

2. **CLI wrapper** (`packages/aws-cdk/lib/cli/cdk-toolkit.ts` → `validate()`)
   - Turns on debug mode (richer stack traces).
   - Strips the CLI-only `--watch` flag before crossing into `toolkit-lib`; if
     `--watch` was set, delegates to `toolkit.watchValidate(...)` instead.
   - Calls `toolkit.validate(...)` and maps the result to an exit code:
     `conclusion === 'failure'` → `1`, otherwise `0`.

3. **toolkit-lib action** (`packages/@aws-cdk/toolkit-lib/lib/toolkit/toolkit.ts` → `validate()` / `_validate()`)
   - Synthesizes the app and selects the requested stacks.
   - Offline/plugin validation via `obtainUnifiedValidationReport()`:
     - Reads `validation-report.json` from the cloud assembly (plugin output),
       filtered to the selected stacks.
     - Collects construct annotations as an additional report.
   - Online validation (when `--online`): calls `createValidationChangeSet()`
     per stack to submit the template to CloudFormation.
   - Combines all reports into a single conclusion (`failure` if **any** report
     failed) and notifies the IoHost — either a "no problems" message or a
     formatted violation report.

## Output and exit codes

- **No violations** → prints `Validation did not find any problems.`
  (`CDK_TOOLKIT_I9600`) and exits `0`.
- **Violations found** → prints a formatted report of the offending constructs /
  resources and exits `1`.

### Relevant message codes

| Code | Level | Meaning |
|------|-------|---------|
| `CDK_TOOLKIT_I9600` | info | Validation did not find any problems |
| `CDK_TOOLKIT_E9600` | error | Policy validation failed |
| `CDK_TOOLKIT_I9601` | info | No policy validation report found |
| `CDK_TOOLKIT_W9602` | warn | Online validation could not be completed for a stack |

## Related mechanisms (not the same as `cdk validate`)

- **`CDK_VALIDATION` env var / `cdk synth --validation` / `--no-validation`.**
  This is a **synth-time** toggle, distinct from the `validate` *command*. When
  set to `false` (which backs the CLI's `--no-validation`), it disables
  framework-side validation layers during synthesis — including
  `validateOnSynth` stacks **and** aws-cdk-lib's built-in CloudFormation
  template validation (the WASM plugin described above). See
  `packages/@aws-cdk/toolkit-lib/lib/api/cloud-assembly/source-builder.ts`.
- **Validation on other commands (e.g. `deploy`).** Commands other than
  `validate` consume validation reports through `throwIfValidationFailures()`,
  which **fails hard** on the first failure. `validate` deliberately does the
  opposite: it reports everything and signals pass/fail through the exit code.

## Source references

| Concern | Location |
|---------|----------|
| Command definition (options, args) | `packages/aws-cdk/lib/cli/cli-config.ts` |
| CLI handler / dispatch | `packages/aws-cdk/lib/cli/cli.ts` |
| CLI wrapper (`validate`, `validateWatch`) | `packages/aws-cdk/lib/cli/cdk-toolkit.ts` |
| Toolkit action (`validate`, `_validate`, `validateOnline`) | `packages/@aws-cdk/toolkit-lib/lib/toolkit/toolkit.ts` |
| Unified offline report | `packages/@aws-cdk/toolkit-lib/lib/toolkit/private/validation-report.ts` |
| Report file name + schema + loader | `packages/@aws-cdk/cloud-assembly-schema/lib/manifest.ts`, `.../lib/cloud-assembly/validation-report-schema.ts` |
| `CDK_VALIDATION` / `--no-validation` wiring | `packages/@aws-cdk/toolkit-lib/lib/api/cloud-assembly/source-builder.ts`, `.../environment.ts` |
| Message codes (96xx) | `packages/@aws-cdk/toolkit-lib/lib/api/io/private/messages.ts` |

> **Note on scope.** Everything in this doc about `validate`'s own behavior is
> grounded in this repo. The details of *what* `CloudFormationValidatePlugin` is
> and *how* its WASM engine is built live in aws-cdk-lib (the `aws/aws-cdk`
> repo), which this repo only integrates with via the report file.
