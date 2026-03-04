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
