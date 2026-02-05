# Contributing to the AWS Cloud Development Kit Toolkit

The AWS Cloud Development Kit (AWS CDK) is an open-source software development
framework that you can contribute to. We value community contributions which
significantly impact the development of the AWS CDK. This document will guide
you through learning about contributions, getting started with creating
contributions, and understanding what is required to ensure that your efforts
are impactful and your contribution process goes smoothly.

Thank you for your interest in contributing to the AWS CDK! We look forward to
working with you to improve the AWS CDK for everyone. ❤️

The AWS CDK is released under the [Apache license](http://aws.amazon.com/apache2.0/).
Any code that you submit will be released under that license.

## Contribution process

The process of the [aws-cdk Contributing
Guide](https://github.com/aws/aws-cdk/blob/main/CONTRIBUTING.md) around finding
items to work and submitting Pull Requests also applies to this repository. This
contributing guide will focus on technical aspects.

## Prerequisites

- [Node.js >= 20.17.0](https://nodejs.org/download/release/latest-v20.x/)
  - We recommend using a version in [Active LTS](https://nodejs.org/en/about/releases/)
- [Yarn >= 1.19.1, < 2](https://yarnpkg.com/lang/en/docs/install)
- [Docker >= 19.03](https://docs.docker.com/get-docker/)
  - the Docker daemon must also be running
- [.NET SDK >= 6.0](https://dotnet.microsoft.com/en-us/download)
  - required for initializing or building CDK apps in C# (.csproj)

We recommend that you use [Visual Studio Code](https://code.visualstudio.com/)
to work on the CDK.  We use `ESLint` to keep our code consistent in terms of
style and reducing defects. We recommend installing the [ESLint
extension](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint)
as well.

## Getting started

This is a [projen](https://github.com/projen/projen)-managed repository. After checkout, run the following:

```shell
$ yarn
$ yarn build
```

This will build and unit test all packages.

## Integration tests

See [CDK CLI integration test](./packages/@aws-cdk-testing/cli-integ/README.md)

### Submitting a PR that involves changes to integration tests

When you make a change to both the CLI and the integration tests, you must submit 2 PRs to
the two repositories, and follow the following process:

0. Initially the integ tests on the `aws-cdk-cli-testing` repository will fail because
   the currently published CLI version won't support the new feature yet.
1. Test the changes locally
2. Merge the CLI PR first.
3. Release the CLI.
4. Merge the `aws-cdk-cli-testing` PR.
5. Release the testing PR.

We will build automation to make this process smoother as soon as possible, but
this is what it is for now.
