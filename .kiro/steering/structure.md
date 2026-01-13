# AWS CDK CLI Project Structure

## Repository Organization

This repository is organized as a monorepo using Yarn workspaces. The main directories are:

- **packages/**: Contains all the packages that make up the CDK CLI ecosystem
- **projenrc/**: Contains Projen configuration modules
- **.projen/**: Contains generated Projen files
- **.nx/**: Contains NX cache and configuration

## Key Packages

### Main CLI Packages

- **packages/aws-cdk/**: The main CDK CLI package that provides the `cdk` command
- **packages/cdk/**: An alias package for `aws-cdk` to enable `npx cdk` usage
- **packages/cdk-assets/**: CLI component for handling asset uploads

### Core Libraries

- **packages/@aws-cdk/toolkit-lib/**: Programmatic interface to the CDK Toolkit
- **packages/@aws-cdk/cloud-assembly-schema/**: Schema for the protocol between CDK framework and CLI
- **packages/@aws-cdk/cloudformation-diff/**: Utilities to diff CloudFormation templates
- **packages/@aws-cdk/cdk-assets-lib/**: Library for CDK asset publishing

### Support Packages

- **packages/@aws-cdk/cli-plugin-contract/**: TypeScript types for CLI plugins
- **packages/@aws-cdk/cdk-cli-wrapper/**: Deprecated programmatic interface for the CLI
- **packages/@aws-cdk/user-input-gen/**: Build tool for the CLI and toolkit-lib
- **packages/@aws-cdk/yarn-cling/**: Deprecated build tool for the CLI

### Testing Packages

- **packages/@aws-cdk-testing/cli-integ/**: Integration tests for the CLI

## Package Structure

Each package typically follows this structure:

- **lib/**: Source code
- **test/**: Test files
- **bin/**: Executable scripts
- **.eslintrc.js**: ESLint configuration
- **package.json**: Package metadata and dependencies
- **tsconfig.json**: TypeScript configuration
- **jest.config.json**: Jest test configuration

## Dependency Flow

The dependency flow generally follows this pattern:

1. **aws-cdk** (CLI) depends on **toolkit-lib**
2. **toolkit-lib** depends on **cloud-assembly-schema**, **cloudformation-diff**, and **cdk-assets-lib**
3. **cdk-assets** depends on **cdk-assets-lib**
4. **cdk-assets-lib** depends on **cloud-assembly-schema**

## Build Artifacts

- **dist/**: Contains compiled JavaScript code
- **coverage/**: Contains test coverage reports
- **.jsii**: JSII metadata for packages that support multiple languages
