# @aws-cdk/tools

Private (unpublished) monorepo package that hosts small, self-contained
utilities that are **bundled into a single file each** and then **cherry-picked**
by consumer packages at build time.

Each subdirectory under `lib/` is a "tool": it has its own `index.ts` source and
gets bundled by `esbuild` into a single `index.js` (with a matching `index.d.ts`).

Consumers declare a `devDependency` on `@aws-cdk/tools` and add a `preCompile`
step (see `.projenrc.ts` → `copyTool()`) that copies the bundled
`lib/<tool>/index.{js,d.ts}` into their own `lib/private/<tool>/`. The consumer
then imports from `./private/<tool>` and ships the bundled file on publish.

## Tools

| Tool    | Exports                   | Description                                             |
| ------- | ------------------------- | ------------------------------------------------------- |
| archive | `zipDirectory`, `zipString` | Deterministic zip helpers (wraps `archiver` + `fast-glob`). |

## Adding a new tool

1. Create `lib/<tool>/index.ts` with the public API.
2. Add the tool name to the `TOOLS` list in `.projenrc.ts` — this wires up the
   per-tool `esbuild --bundle` post-compile step automatically.
3. Add tests under `test/<tool>/`.
4. In the consumer's projen config, call `copyTool(consumer, '<tool>')`.
