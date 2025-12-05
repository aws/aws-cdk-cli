# CDK Garbage Collection - Skip Unauthorized Native CloudFormation Stacks

This document describes the `--unauth-native-cfn-stacks-to-skip` option that allows users to provide patterns to automatically skip unauthorized native CloudFormation stacks.

## Overview

When CDK Garbage Collection scans CloudFormation stacks to determine which assets are still in use, it may encounter stacks that it cannot access due to insufficient permissions. 

**Without skip patterns configured:**
1. **Prompt the user** asking whether to skip the unauthorized stacks
2. **Default to 'no'** - the operation will be cancelled unless the user explicitly chooses to skip
3. **List the unauthorized stacks** that were found

**With skip patterns configured:**
- Stacks matching the patterns are automatically skipped without prompting
- Only non-matching unauthorized stacks will prompt the user

The user needs to ensure that the stacks they intend to skip are native CloudFormation stacks (not CDK-managed). The option does NOT check this. Attempting to skip CDK stacks during gc can be hazardous

Example prompt:
```
Found 3 unauthorized stack(s): Legacy-App-Stack,
Legacy-DB-Stack,
ThirdParty-Service
Do you want to skip all these stacks? Default is 'no' [y]es/[n]o
```

## Skip Patterns Configuration

Users can provide glob patterns to automatically skip unauthorized stacks using the `--unauth-native-cfn-stacks-to-skip` option:

```bash
cdk gc --unstable=gc --unauth-native-cfn-stacks-to-skip "Legacy-*" "ThirdParty-*"
```

**How it works:**
- Patterns are checked against unauthorized stack names
- Matching stacks are automatically skipped
- Non-matching unauthorized stacks still prompt the user with default 'no'

### Pattern Matching

- Supports glob patterns (`*`, `**`)
- Extracts stack names from ARNs automatically
- Case-sensitive matching

Examples:
- `Legacy-*` matches `Legacy-App-Stack`, `Legacy-DB-Stack`
- `*-Prod` matches `MyApp-Prod`, `Database-Prod`
- `ThirdParty-*` matches `ThirdParty-Service`, `ThirdParty-API`

## Security Considerations

The default behavior of requiring explicit user confirmation to skip stacks helps prevent:

- Accidentally skipping important stacks
- Missing assets that might be referenced by inaccessible stacks
- Unintended deletion of assets in shared environments

## CI/CD Environments

In CI/CD environments where user interaction is not possible:

- The default 'no' response will cause the operation to fail
- Consider implementing proper IAM permissions instead of skipping stacks


## Implementation Details

The skip patterns feature is implemented in `stack-refresh.ts`:

1. Attempt to access each stack template
2. Catch `AccessDenied` errors
3. Check if stack name matches any user-provided skip patterns
4. **If pattern matches:** automatically skip without prompting
5. **If no pattern matches:** prompt user whether to skip (defaults to 'no')

This ensures that only stacks matching user-specified patterns are skipped automatically, maintaining security by default.