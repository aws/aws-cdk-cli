# AWS CDK CLI Technology Stack

## Build System

The project uses [Projen](https://github.com/projen/projen) for project configuration and build management. Projen generates and maintains project configuration files from a central TypeScript definition (`.projenrc.ts`).

## Tech Stack

- **Language**: TypeScript (version 5.8)
- **Runtime**: Node.js (minimum version 18.0.0)
- **Package Manager**: Yarn with workspaces
- **Monorepo Management**: NX for task orchestration and caching
- **Testing**: Jest for unit tests
- **Linting**: ESLint with custom rules
- **Formatting**: Prettier
- **Documentation**: API Extractor for API documentation

## Key Libraries

- **AWS SDK v3**: Used for AWS service interactions
- **JSII**: For multi-language support
- **Yargs**: Command-line argument parsing
- **Chalk**: Terminal coloring
- **fs-extra**: Enhanced file system operations
- **semver**: Semantic versioning utilities
- **yaml**: YAML parsing and generation

## Common Commands

### Project Management

```bash
# Install dependencies
yarn install

# Build all packages
yarn build

# Run tests
yarn test

# Lint code
yarn eslint
```

### Package-specific Commands

```bash
# Build a specific package
cd packages/aws-cdk && yarn build

# Run tests for a specific package
cd packages/aws-cdk && yarn test

# Watch and rebuild on changes
cd packages/aws-cdk && yarn watch
```

### CDK CLI Usage

```bash
# Deploy a CDK app
./packages/aws-cdk/bin/cdk deploy

# Synthesize CloudFormation templates
./packages/aws-cdk/bin/cdk synth

# Bootstrap CDK resources in an AWS account
./packages/aws-cdk/bin/cdk bootstrap

# Initialize a new CDK project
./packages/aws-cdk/bin/cdk init --language typescript
```

## Release Process

The project uses automated release workflows triggered via GitHub Actions. Version management follows semantic versioning principles.
