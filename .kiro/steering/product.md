# AWS CDK CLI

The AWS Cloud Development Kit (AWS CDK) CLI is a command-line tool for interacting with CDK applications. It's part of the AWS CDK ecosystem, which allows developers to define cloud infrastructure in code and provision it through AWS CloudFormation.

## Core Components

- **aws-cdk**: The main CLI package that provides the `cdk` command
- **toolkit-lib**: A programmatic interface to the CDK Toolkit functionality
- **cloud-assembly-schema**: Schema for the protocol between CDK framework and CLI
- **cloudformation-diff**: Utilities to diff CDK stacks against CloudFormation templates
- **cdk-assets**: CLI component for handling asset uploads

## Purpose

The CDK CLI allows developers to:

- Deploy CDK applications to AWS
- Synthesize CloudFormation templates from CDK code
- Diff between deployed stacks and local changes
- Bootstrap CDK resources in AWS accounts
- Initialize new CDK projects
- Work with CDK assets (files, Docker images)

## Related Projects

This repository contains the CLI components of the CDK ecosystem. The main CDK construct library is maintained in a separate repository: [aws/aws-cdk](https://github.com/aws/aws-cdk).
