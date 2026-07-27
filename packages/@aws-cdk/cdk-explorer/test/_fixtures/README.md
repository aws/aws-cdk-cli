# Test Fixtures

These fixtures back the cdk-explorer unit tests. They come in two kinds.

## Programmatic assemblies (`builders.ts`)

Rather than checking in static `cdk.out/` directories, most tests construct
their cloud assembly in memory with `builders.ts` — helpers that write a
`manifest.json` + `tree.json` describing stacks, constructs, CFN resources,
and validation reports. This keeps each test's intent readable in TypeScript
and reduces the chance of the fixtures going stale as the cloud-assembly format evolves. The
builders only populate the fields `readAssembly` actually consumes, using the
metadata-key constants from `@aws-cdk/cloud-assembly-schema` so the keys stay
correct. `builders.test.ts` sanity-checks each builder against `readAssembly`.

## source-maps/

`sample.ts` + `sample.js` + `sample.js.map` are real `tsc` output, used by
`source-resolver.test.ts` to verify `.js` → `.ts` resolution via
`@jridgewell/trace-mapping`.

To regenerate (if the test starts pointing at the wrong line/col):

```bash
cd packages/@aws-cdk/cdk-explorer
rm test/_fixtures/source-maps/sample.{js,js.map}
npx tsc --target ES2020 --module commonjs --sourceMap \
  --outDir test/_fixtures/source-maps \
  test/_fixtures/source-maps/sample.ts
```

If you edit `sample.ts`, also update the line/column expectations in
`source-resolver.test.ts`.
