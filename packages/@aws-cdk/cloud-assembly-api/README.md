# Cloud Assembly API

This module is part of the [AWS Cloud Development Kit](https://github.com/aws/aws-cdk) project.

It provides routines to save and load Cloud Assembly manifests, as defined in
the `@aws-cdk/cloud-assembly-schema` package.

A lot of this code used to live in the `@aws-cdk/cx-api` package, but has been
extracted from it to its own package. That original package used to define the
`Cloud Executable <--> CDK CLI` contract in both directions, but this
responsibility has now been split:

```
┌────────────────────────┐  @/cloud-assembly-api   ┌────────────────┐
│                        │────────────────────────▶│                │
│    Cloud Executable    │                         │    CDK CLI     │
│                        │◀────────────────────────│                │
└────────────────────────┘         @/cx-api        └────────────────┘
```

## Property mutation sites

`AssemblyIndex` joins construct-tree data with assembly metadata. When an app is
synthesized in debug mode (`CDK_DEBUG=true`), recorded property assignment and
mutation traces are available on each indexed node:

```ts
import { AssemblyIndex, CloudAssembly } from '@aws-cdk/cloud-assembly-api';

async function tagMutationStacks(assemblyDirectory: string): Promise<string[][]> {
  const index = await AssemblyIndex.fromAssembly(new CloudAssembly(assemblyDirectory));
  const resource = index.byPath('MyStack/MyBucket/Resource');
  return resource?.propertyMutationStacks?.Tags ?? [];
}
```

The map uses CloudFormation property names and contains every recorded stack
trace for each property, in metadata order. The same data is available on nodes
returned by `byTemplateLocation()`, including resources in nested stacks and
nested assemblies. `propertyMutationStacks` is absent when no mutation metadata
was emitted. A construct's creation trace remains available as `creationStack`.
