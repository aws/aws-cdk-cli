# Test Fixtures

These fixtures back the cdk-explorer unit tests. They come in two kinds.

## Programmatic assemblies (`../_helpers/assembly.ts`)

Rather than checking in static `cdk.out/` directories, most tests construct
their cloud assembly on disk with `AssemblyFixture` — a helper that writes a
`manifest.json` + `tree.json` + templates describing stacks, constructs, CFN
resources, and validation reports, then indexes it through the production
`AssemblyIndex` path. This keeps each test's intent readable in TypeScript and
reduces the chance of the fixtures going stale as the cloud-assembly format
evolves.

The helper deliberately models only flat stacks. Nested stacks, Stages, and
assembly-relative template resolution belong to `AssemblyIndex` and are covered
in the `@aws-cdk/cloud-assembly-api` suite; duplicating them here would test
somebody else's code.

## source-maps/

`sample.ts` + `sample.js` + `sample.js.map` are real `tsc` output, used by
`source-resolver.test.ts` to verify `.js` → `.ts` resolution via
`@jridgewell/trace-mapping`.
