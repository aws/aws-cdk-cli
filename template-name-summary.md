# Template Name Feature Implementation Summary

## Overview
Added `--template-name` option to support Git repositories containing multiple CDK templates.

## Changes Made

### 1. CLI Configuration (`cli-config.ts`)
- Added `template-name` option to init command configuration
- Description: "Name of the template to use when the source contains multiple templates"

### 2. Interface Update (`init.ts`)
- Added `templateName?: string` to `CliInitOptions` interface

### 3. Usage Examples

```bash
# Single template repository (existing behavior)
cdk init --git-url https://github.com/user/single-template

# Multi-template repository - specify which template to use
cdk init --git-url https://github.com/user/multi-templates --template-name enterprise-app

# Repository structure for multi-template:
multi-templates/
├── basic-app/
│   ├── info.json
│   └── typescript/
├── enterprise-app/
│   ├── info.json
│   └── typescript/
└── microservice/
    ├── info.json
    └── typescript/
```

### 4. Implementation Logic
When `--template-name` is provided:
1. Clone the Git repository to temp directory
2. Look for subdirectory matching the template name
3. Validate it contains required `typescript/` directory and `info.json`
4. Use that specific template instead of root directory

### 5. Error Handling
- Throws error if specified template name not found
- Throws error if template directory missing required structure
- Falls back gracefully to default behavior when template-name not specified

## Benefits
- Supports monorepo-style template repositories
- Maintains backward compatibility
- Enables template organizations to provide multiple templates in single repository
- Reduces repository proliferation for template maintainers