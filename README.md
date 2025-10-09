# AWS Cloud Development Kit (AWS CDK) Toolkit

[![NPM version](https://badge.fury.io/js/aws-cdk.svg)](https://badge.fury.io/js/aws-cdk)

The **AWS Cloud Development Kit (AWS CDK)** is an open-source software
development framework to define cloud infrastructure in code and provision it
through AWS CloudFormation.

The AWS CDK consists of two main components:

- a [class library](https://github.com/aws/aws-cdk), that you use to
  to model your infrastructure in code; and
- a *toolkit*, consisting of a CLI or a programmatic library, to act on those
  models.

This repository contains the code for the toolkit components. The [class library
repository](https://github.com/aws/aws-cdk) is the main repository for the CDK
project.

## Getting Help

The best way to interact with our team is through GitHub, on the [aws-cdk
repository](https://github.com/aws/aws-cdk). You can open an
[issue](https://github.com/aws/aws-cdk/issues/new/choose) and choose from one of
our templates for bug reports, feature requests, documentation issues, or
guidance.

If you have a support plan with AWS Support, you can also create a new [support case](https://console.aws.amazon.com/support/home#/).

You may also find help on these community resources:

- Look through the [API Reference](https://docs.aws.amazon.com/cdk/api/latest/docs/aws-construct-library.html) or [Developer Guide](https://docs.aws.amazon.com/cdk/latest/guide)
- The #aws-cdk Slack channel in [cdk.dev](https://cdk.dev)
- Ask a question on [Stack Overflow](https://stackoverflow.com/questions/tagged/aws-cdk)
  and tag it with `aws-cdk`

## Contributing

We welcome community contributions and pull requests. See
[CONTRIBUTING.md](./CONTRIBUTING.md) for information on how to set up a development
environment and submit code.

## Structure of this repository

Here are the packages in this repository. See the README of each package for more information about it:

| Package                                                                       | Description                                                                                                                                                | Published? | Maintained? |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------- |
| [aws-cdk](./packages/aws-cdk/)                                                | The CDK Toolkit CLI, main CLI interface to CDK projects.                                                                                                   | Yes        | Yes         |
| [@aws-cdk/toolkit-lib](./packages/@aws-cdk/toolkit-lib/)                      | A programmatic interface for the CDK Toolkit.                                                                                                              | Yes        | Yes         |
| [cdk](./packages/cdk/)                                                        | An alias for `aws-cdk` so you can run `npx cdk` even if it's not installed.                                                                                | Yes        | Yes         |
| [cdk-assets v3](./packages/cdk-assets/)                                       | CLI component handling asset uploads, also used as a CLI in [CDK Pipelines](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.pipelines-readme.html) | Yes        | Yes         |
| [@aws-cdk/cloud-assembly-schema](./packages/@aws-cdk//cloud-assembly-schema/) | The contract between the CDK construct library and the CDK toolkit                                                                                         | Yes        | Yes         |
| [@aws-cdk/cloudformation-diff](./packages/@aws-cdk/cloudformation-diff/)      | CLI component for diffing CloudFormation templates                                                                                                         | Yes        | Yes         |
| [@aws-cdk/cli-plugin-contract](./packages/@aws-cdk/cli-plugin-contract/)      | TypeScript types for CLI plugins.                                                                                                                          | Yes        | Yes         |
| [@aws-cdk/cdk-cli-wrapper](./packages/@aws-cdk/cdk-cli-wrapper/)              | A deprecated attempt at building a programmatic interface for the CLI                                                                                      | No         | No          |
| [@aws-cdk/node-bundle](./packages/@aws-cdk/node-bundle/)                      | A tool to build CLI bundles that include license attributions.                                                                                             | No         | Yes         |
| [@aws-cdk/user-input-gen](./packages/@aws-cdk/user-input-gen/)                | A build tool for the CLI and toolkit-lib.                                                                                                                  | No         | Yes         |
| [@aws-cdk/yarn-cling](./packages/@aws-cdk/yarn-cling/)                        | A deprecated build tool for the CLI.                                                                                                                       | No         | No          |

Every package comes with its own unit tests. There is a companion repository to this one containing the integration tests. You can find it here: <https://github.com/aws/aws-cdk-cli-testing>

See the [contributing guide](./CONTRIBUTING.md) for more information on this repository.

## Compatibility

The CLI is always able to process CDK apps using a version of the Construct Library
released before it. We recommend you always keep the CLI version up-to-date to get the
latest features.

For more details on the compatibility model and specific versions that work together,
see [COMPATIBILITY.md](COMPATIBILITY.md).
