# Test Fixtures

Most tests build their `cdk.out/` programmatically via `builders.ts` —
keeps test intent in TypeScript and avoids drift when aws-cdk-lib or the
cloud-assembly schema upgrades. `builders.test.ts` sanity-checks each
builder against `readAssembly`.

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
