# @aws-cdk/tools

Private (unpublished) monorepo package that hosts small, self-contained
utilities that consumer packages **cherry-pick as source** at build time.

Each subdirectory under `lib/` is a "tool" with its own `index.ts` source.
A consumer vendors a tool by copying its source into its own tree, where it is
compiled as part of the consuming package — there is no separate bundling step.

Consumers opt in via `useTools: [tools.<name>]` on their `CdkTypeScriptWorkspace`
(typed references; see `.projenrc.ts`). At pre-compile time this:

- copies the tool's `*.ts` source into the consumer's `lib/private/tools/<name>/`
  (the consumer imports from `./private/tools/<name>`), and
- adds the tool's declared runtime dependencies to the consuming package.

The copied `.ts` is tracked as vendored source; the `.js`/`.d.ts` the consumer
compiles from it are normal (gitignored) build output. Declaring the deps means
the third-party packages (e.g. `archiver`, `fast-glob`) resolve to a single
shared copy when a consumer (e.g. the CLI) is bundled.

## Tools

| Tool | Exports                     | Dependencies            | Description                |
| ---- | --------------------------- | ----------------------- | -------------------------- |
| zip  | `zipDirectory`, `zipString` | `archiver`, `fast-glob` | Deterministic zip helpers. |

## Adding a new tool

1. Create `lib/<tool>/index.ts` with the public API. Tools are auto-discovered
   from the filesystem — there is no list to update.
2. Declare the tool's third-party runtime dependencies in `toolDeps` on the
   `ToolsWorkspace` in `.projenrc.ts` (use an empty array if it has none).
3. Add tests under `test/<tool>/`.
4. In each consuming package's projen config, add `useTools: [tools.<tool>]`.
