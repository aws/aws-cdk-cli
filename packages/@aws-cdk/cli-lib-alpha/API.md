# API Reference <a name="API Reference" id="api-reference"></a>


## Structs <a name="Structs" id="Structs"></a>

### BootstrapOptions <a name="BootstrapOptions" id="@aws-cdk/cli-lib-alpha.BootstrapOptions"></a>

Options to use with cdk bootstrap.

#### Initializer <a name="Initializer" id="@aws-cdk/cli-lib-alpha.BootstrapOptions.Initializer"></a>

```typescript
import { BootstrapOptions } from '@aws-cdk/cli-lib-alpha'

const bootstrapOptions: BootstrapOptions = { ... }
```

#### Properties <a name="Properties" id="Properties"></a>

| **Name** | **Type** | **Description** |
| --- | --- | --- |
| <code><a href="#@aws-cdk/cli-lib-alpha.BootstrapOptions.property.assetMetadata">assetMetadata</a></code> | <code>boolean</code> | Include "aws:asset:*" CloudFormation metadata for resources that use assets. |
| <code><a href="#@aws-cdk/cli-lib-alpha.BootstrapOptions.property.caBundlePath">caBundlePath</a></code> | <code>string</code> | Path to CA certificate to use when validating HTTPS requests. |
| <code><a href="#@aws-cdk/cli-lib-alpha.BootstrapOptions.property.color">color</a></code> | <code>boolean</code> | Show colors and other style from console output. |
| <code><a href="#@aws-cdk/cli-lib-alpha.BootstrapOptions.property.context">context</a></code> | <code>{[ key: string ]: string}</code> | Additional context. |
| <code><a href="#@aws-cdk/cli-lib-alpha.BootstrapOptions.property.debug">debug</a></code> | <code>boolean</code> | enable emission of additional debugging information, such as creation stack traces of tokens. |
| <code><a href="#@aws-cdk/cli-lib-alpha.BootstrapOptions.property.ec2Creds">ec2Creds</a></code> | <code>boolean</code> | Force trying to fetch EC2 instance credentials. |
| <code><a href="#@aws-cdk/cli-lib-alpha.BootstrapOptions.property.ignoreErrors">ignoreErrors</a></code> | <code>boolean</code> | Ignores synthesis errors, which will likely produce an invalid output. |
| <code><a href="#@aws-cdk/cli-lib-alpha.BootstrapOptions.property.json">json</a></code> | <code>boolean</code> | Use JSON output instead of YAML when templates are printed to STDOUT. |
| <code><a href="#@aws-cdk/cli-lib-alpha.BootstrapOptions.property.lookups">lookups</a></code> | <code>boolean</code> | Perform context lookups. |
| <code><a href="#@aws-cdk/cli-lib-alpha.BootstrapOptions.property.notices">notices</a></code> | <code>boolean</code> | Show relevant notices. |
| <code><a href="#@aws-cdk/cli-lib-alpha.BootstrapOptions.property.pathMetadata">pathMetadata</a></code> | <code>boolean</code> | Include "aws:cdk:path" CloudFormation metadata for each resource. |
| <code><a href="#@aws-cdk/cli-lib-alpha.BootstrapOptions.property.profile">profile</a></code> | <code>string</code> | Use the indicated AWS profile as the default environment. |
| <code><a href="#@aws-cdk/cli-lib-alpha.BootstrapOptions.property.proxy">proxy</a></code> | <code>string</code> | Use the indicated proxy. |
| <code><a href="#@aws-cdk/cli-lib-alpha.BootstrapOptions.property.roleArn">roleArn</a></code> | <code>string</code> | Role to pass to CloudFormation for deployment. |
| <code><a href="#@aws-cdk/cli-lib-alpha.BootstrapOptions.property.stacks">stacks</a></code> | <code>string[]</code> | List of stacks to deploy. |
| <code><a href="#@aws-cdk/cli-lib-alpha.BootstrapOptions.property.staging">staging</a></code> | <code>boolean</code> | Copy assets to the output directory. |
| <code><a href="#@aws-cdk/cli-lib-alpha.BootstrapOptions.property.strict">strict</a></code> | <code>boolean</code> | Do not construct stacks with warnings. |
| <code><a href="#@aws-cdk/cli-lib-alpha.BootstrapOptions.property.trace">trace</a></code> | <code>boolean</code> | Print trace for stack warnings. |
| <code><a href="#@aws-cdk/cli-lib-alpha.BootstrapOptions.property.verbose">verbose</a></code> | <code>boolean</code> | show debug logs. |
| <code><a href="#@aws-cdk/cli-lib-alpha.BootstrapOptions.property.versionReporting">versionReporting</a></code> | <code>boolean</code> | Include "AWS::CDK::Metadata" resource in synthesized templates. |
| <code><a href="#@aws-cdk/cli-lib-alpha.BootstrapOptions.property.bootstrapBucketName">bootstrapBucketName</a></code> | <code>string</code> | The name of the CDK toolkit bucket; |
| <code><a href="#@aws-cdk/cli-lib-alpha.BootstrapOptions.property.bootstrapCustomerKey">bootstrapCustomerKey</a></code> | <code>string</code> | Create a Customer Master Key (CMK) for the bootstrap bucket (you will be charged but can customize permissions, modern bootstrapping only). |
| <code><a href="#@aws-cdk/cli-lib-alpha.BootstrapOptions.property.bootstrapKmsKeyId">bootstrapKmsKeyId</a></code> | <code>string</code> | AWS KMS master key ID used for the SSE-KMS encryption. |
| <code><a href="#@aws-cdk/cli-lib-alpha.BootstrapOptions.property.cfnExecutionPolicy">cfnExecutionPolicy</a></code> | <code>string</code> | The Managed Policy ARNs that should be attached to the role performing deployments into this environment (may be repeated, modern bootstrapping only). |
| <code><a href="#@aws-cdk/cli-lib-alpha.BootstrapOptions.property.customPermissionsBoundary">customPermissionsBoundary</a></code> | <code>string</code> | Use the permissions boundary specified by name. |
| <code><a href="#@aws-cdk/cli-lib-alpha.BootstrapOptions.property.environments">environments</a></code> | <code>string[]</code> | The target AWS environments to deploy the bootstrap stack to. |
| <code><a href="#@aws-cdk/cli-lib-alpha.BootstrapOptions.property.examplePermissionsBoundary">examplePermissionsBoundary</a></code> | <code>boolean</code> | Use the example permissions boundary. |
| <code><a href="#@aws-cdk/cli-lib-alpha.BootstrapOptions.property.execute">execute</a></code> | <code>boolean</code> | Whether to execute ChangeSet (--no-execute will NOT execute the ChangeSet). |
| <code><a href="#@aws-cdk/cli-lib-alpha.BootstrapOptions.property.force">force</a></code> | <code>boolean</code> | Always bootstrap even if it would downgrade template version. |
| <code><a href="#@aws-cdk/cli-lib-alpha.BootstrapOptions.property.publicAccessBlockConfiguration">publicAccessBlockConfiguration</a></code> | <code>string</code> | Block public access configuration on CDK toolkit bucket (enabled by default). |
| <code><a href="#@aws-cdk/cli-lib-alpha.BootstrapOptions.property.qualifier">qualifier</a></code> | <code>string</code> | String which must be unique for each bootstrap stack. |
| <code><a href="#@aws-cdk/cli-lib-alpha.BootstrapOptions.property.showTemplate">showTemplate</a></code> | <code>boolean</code> | Instead of actual bootstrapping, print the current CLI\'s bootstrapping template to stdout for customization. |
| <code><a href="#@aws-cdk/cli-lib-alpha.BootstrapOptions.property.template">template</a></code> | <code>string</code> | Use the template from the given file instead of the built-in one (use --show-template to obtain an example). |
| <code><a href="#@aws-cdk/cli-lib-alpha.BootstrapOptions.property.terminationProtection">terminationProtection</a></code> | <code>boolean</code> | Toggle CloudFormation termination protection on the bootstrap stacks. |
| <code><a href="#@aws-cdk/cli-lib-alpha.BootstrapOptions.property.toolkitStackName">toolkitStackName</a></code> | <code>string</code> | The name of the CDK toolkit stack to create. |
| <code><a href="#@aws-cdk/cli-lib-alpha.BootstrapOptions.property.trust">trust</a></code> | <code>string</code> | The AWS account IDs that should be trusted to perform deployments into this environment (may be repeated, modern bootstrapping only). |
| <code><a href="#@aws-cdk/cli-lib-alpha.BootstrapOptions.property.trustForLookup">trustForLookup</a></code> | <code>string</code> | The AWS account IDs that should be trusted to look up values in this environment (may be repeated, modern bootstrapping only). |
| <code><a href="#@aws-cdk/cli-lib-alpha.BootstrapOptions.property.usePreviousParameters">usePreviousParameters</a></code> | <code>boolean</code> | Use previous values for existing parameters (you must specify all parameters on every deployment if this is disabled). |

---

##### `assetMetadata`<sup>Optional</sup> <a name="assetMetadata" id="@aws-cdk/cli-lib-alpha.BootstrapOptions.property.assetMetadata"></a>

```typescript
public readonly assetMetadata: boolean;
```

- *Type:* boolean
- *Default:* true

Include "aws:asset:*" CloudFormation metadata for resources that use assets.

---

##### `caBundlePath`<sup>Optional</sup> <a name="caBundlePath" id="@aws-cdk/cli-lib-alpha.BootstrapOptions.property.caBundlePath"></a>

```typescript
public readonly caBundlePath: string;
```

- *Type:* string
- *Default:* read from AWS_CA_BUNDLE environment variable

Path to CA certificate to use when validating HTTPS requests.

---

##### `color`<sup>Optional</sup> <a name="color" id="@aws-cdk/cli-lib-alpha.BootstrapOptions.property.color"></a>

```typescript
public readonly color: boolean;
```

- *Type:* boolean
- *Default:* `true` unless the environment variable `NO_COLOR` is set

Show colors and other style from console output.

---

##### `context`<sup>Optional</sup> <a name="context" id="@aws-cdk/cli-lib-alpha.BootstrapOptions.property.context"></a>

```typescript
public readonly context: {[ key: string ]: string};
```

- *Type:* {[ key: string ]: string}
- *Default:* no additional context

Additional context.

---

##### `debug`<sup>Optional</sup> <a name="debug" id="@aws-cdk/cli-lib-alpha.BootstrapOptions.property.debug"></a>

```typescript
public readonly debug: boolean;
```

- *Type:* boolean
- *Default:* false

enable emission of additional debugging information, such as creation stack traces of tokens.

---

##### `ec2Creds`<sup>Optional</sup> <a name="ec2Creds" id="@aws-cdk/cli-lib-alpha.BootstrapOptions.property.ec2Creds"></a>

```typescript
public readonly ec2Creds: boolean;
```

- *Type:* boolean
- *Default:* guess EC2 instance status

Force trying to fetch EC2 instance credentials.

---

##### `ignoreErrors`<sup>Optional</sup> <a name="ignoreErrors" id="@aws-cdk/cli-lib-alpha.BootstrapOptions.property.ignoreErrors"></a>

```typescript
public readonly ignoreErrors: boolean;
```

- *Type:* boolean
- *Default:* false

Ignores synthesis errors, which will likely produce an invalid output.

---

##### `json`<sup>Optional</sup> <a name="json" id="@aws-cdk/cli-lib-alpha.BootstrapOptions.property.json"></a>

```typescript
public readonly json: boolean;
```

- *Type:* boolean
- *Default:* false

Use JSON output instead of YAML when templates are printed to STDOUT.

---

##### `lookups`<sup>Optional</sup> <a name="lookups" id="@aws-cdk/cli-lib-alpha.BootstrapOptions.property.lookups"></a>

```typescript
public readonly lookups: boolean;
```

- *Type:* boolean
- *Default:* true

Perform context lookups.

Synthesis fails if this is disabled and context lookups need
to be performed

---

##### `notices`<sup>Optional</sup> <a name="notices" id="@aws-cdk/cli-lib-alpha.BootstrapOptions.property.notices"></a>

```typescript
public readonly notices: boolean;
```

- *Type:* boolean
- *Default:* true

Show relevant notices.

---

##### `pathMetadata`<sup>Optional</sup> <a name="pathMetadata" id="@aws-cdk/cli-lib-alpha.BootstrapOptions.property.pathMetadata"></a>

```typescript
public readonly pathMetadata: boolean;
```

- *Type:* boolean
- *Default:* true

Include "aws:cdk:path" CloudFormation metadata for each resource.

---

##### `profile`<sup>Optional</sup> <a name="profile" id="@aws-cdk/cli-lib-alpha.BootstrapOptions.property.profile"></a>

```typescript
public readonly profile: string;
```

- *Type:* string
- *Default:* no profile is used

Use the indicated AWS profile as the default environment.

---

##### `proxy`<sup>Optional</sup> <a name="proxy" id="@aws-cdk/cli-lib-alpha.BootstrapOptions.property.proxy"></a>

```typescript
public readonly proxy: string;
```

- *Type:* string
- *Default:* no proxy

Use the indicated proxy.

Will read from
HTTPS_PROXY environment if specified

---

##### `roleArn`<sup>Optional</sup> <a name="roleArn" id="@aws-cdk/cli-lib-alpha.BootstrapOptions.property.roleArn"></a>

```typescript
public readonly roleArn: string;
```

- *Type:* string
- *Default:* use the bootstrap cfn-exec role

Role to pass to CloudFormation for deployment.

---

##### `stacks`<sup>Optional</sup> <a name="stacks" id="@aws-cdk/cli-lib-alpha.BootstrapOptions.property.stacks"></a>

```typescript
public readonly stacks: string[];
```

- *Type:* string[]
- *Default:* all stacks

List of stacks to deploy.

---

##### `staging`<sup>Optional</sup> <a name="staging" id="@aws-cdk/cli-lib-alpha.BootstrapOptions.property.staging"></a>

```typescript
public readonly staging: boolean;
```

- *Type:* boolean
- *Default:* false

Copy assets to the output directory.

Needed for local debugging the source files with SAM CLI

---

##### `strict`<sup>Optional</sup> <a name="strict" id="@aws-cdk/cli-lib-alpha.BootstrapOptions.property.strict"></a>

```typescript
public readonly strict: boolean;
```

- *Type:* boolean
- *Default:* false

Do not construct stacks with warnings.

---

##### `trace`<sup>Optional</sup> <a name="trace" id="@aws-cdk/cli-lib-alpha.BootstrapOptions.property.trace"></a>

```typescript
public readonly trace: boolean;
```

- *Type:* boolean
- *Default:* false

Print trace for stack warnings.

---

##### `verbose`<sup>Optional</sup> <a name="verbose" id="@aws-cdk/cli-lib-alpha.BootstrapOptions.property.verbose"></a>

```typescript
public readonly verbose: boolean;
```

- *Type:* boolean
- *Default:* false

show debug logs.

---

##### `versionReporting`<sup>Optional</sup> <a name="versionReporting" id="@aws-cdk/cli-lib-alpha.BootstrapOptions.property.versionReporting"></a>

```typescript
public readonly versionReporting: boolean;
```

- *Type:* boolean
- *Default:* true

Include "AWS::CDK::Metadata" resource in synthesized templates.

---

##### `bootstrapBucketName`<sup>Optional</sup> <a name="bootstrapBucketName" id="@aws-cdk/cli-lib-alpha.BootstrapOptions.property.bootstrapBucketName"></a>

```typescript
public readonly bootstrapBucketName: string;
```

- *Type:* string
- *Default:* auto-generated CloudFormation name

The name of the CDK toolkit bucket;

bucket will be created and
must not exist

---

##### `bootstrapCustomerKey`<sup>Optional</sup> <a name="bootstrapCustomerKey" id="@aws-cdk/cli-lib-alpha.BootstrapOptions.property.bootstrapCustomerKey"></a>

```typescript
public readonly bootstrapCustomerKey: string;
```

- *Type:* string
- *Default:* undefined

Create a Customer Master Key (CMK) for the bootstrap bucket (you will be charged but can customize permissions, modern bootstrapping only).

---

##### `bootstrapKmsKeyId`<sup>Optional</sup> <a name="bootstrapKmsKeyId" id="@aws-cdk/cli-lib-alpha.BootstrapOptions.property.bootstrapKmsKeyId"></a>

```typescript
public readonly bootstrapKmsKeyId: string;
```

- *Type:* string
- *Default:* undefined

AWS KMS master key ID used for the SSE-KMS encryption.

---

##### `cfnExecutionPolicy`<sup>Optional</sup> <a name="cfnExecutionPolicy" id="@aws-cdk/cli-lib-alpha.BootstrapOptions.property.cfnExecutionPolicy"></a>

```typescript
public readonly cfnExecutionPolicy: string;
```

- *Type:* string
- *Default:* none

The Managed Policy ARNs that should be attached to the role performing deployments into this environment (may be repeated, modern bootstrapping only).

---

##### `customPermissionsBoundary`<sup>Optional</sup> <a name="customPermissionsBoundary" id="@aws-cdk/cli-lib-alpha.BootstrapOptions.property.customPermissionsBoundary"></a>

```typescript
public readonly customPermissionsBoundary: string;
```

- *Type:* string
- *Default:* undefined

Use the permissions boundary specified by name.

---

##### `environments`<sup>Optional</sup> <a name="environments" id="@aws-cdk/cli-lib-alpha.BootstrapOptions.property.environments"></a>

```typescript
public readonly environments: string[];
```

- *Type:* string[]
- *Default:* Bootstrap all environments referenced in the CDK app or determine an environment from local configuration.

The target AWS environments to deploy the bootstrap stack to.

Uses the following format: `aws://<account-id>/<region>`

---

*Example*

```typescript
"aws://123456789012/us-east-1"
```


##### `examplePermissionsBoundary`<sup>Optional</sup> <a name="examplePermissionsBoundary" id="@aws-cdk/cli-lib-alpha.BootstrapOptions.property.examplePermissionsBoundary"></a>

```typescript
public readonly examplePermissionsBoundary: boolean;
```

- *Type:* boolean
- *Default:* undefined

Use the example permissions boundary.

---

##### `execute`<sup>Optional</sup> <a name="execute" id="@aws-cdk/cli-lib-alpha.BootstrapOptions.property.execute"></a>

```typescript
public readonly execute: boolean;
```

- *Type:* boolean
- *Default:* true

Whether to execute ChangeSet (--no-execute will NOT execute the ChangeSet).

---

##### `force`<sup>Optional</sup> <a name="force" id="@aws-cdk/cli-lib-alpha.BootstrapOptions.property.force"></a>

```typescript
public readonly force: boolean;
```

- *Type:* boolean
- *Default:* false

Always bootstrap even if it would downgrade template version.

---

##### `publicAccessBlockConfiguration`<sup>Optional</sup> <a name="publicAccessBlockConfiguration" id="@aws-cdk/cli-lib-alpha.BootstrapOptions.property.publicAccessBlockConfiguration"></a>

```typescript
public readonly publicAccessBlockConfiguration: string;
```

- *Type:* string
- *Default:* undefined

Block public access configuration on CDK toolkit bucket (enabled by default).

---

##### `qualifier`<sup>Optional</sup> <a name="qualifier" id="@aws-cdk/cli-lib-alpha.BootstrapOptions.property.qualifier"></a>

```typescript
public readonly qualifier: string;
```

- *Type:* string
- *Default:* undefined

String which must be unique for each bootstrap stack.

You
must configure it on your CDK app if you change this
from the default.

---

##### `showTemplate`<sup>Optional</sup> <a name="showTemplate" id="@aws-cdk/cli-lib-alpha.BootstrapOptions.property.showTemplate"></a>

```typescript
public readonly showTemplate: boolean;
```

- *Type:* boolean
- *Default:* false

Instead of actual bootstrapping, print the current CLI\'s bootstrapping template to stdout for customization.

---

##### `template`<sup>Optional</sup> <a name="template" id="@aws-cdk/cli-lib-alpha.BootstrapOptions.property.template"></a>

```typescript
public readonly template: string;
```

- *Type:* string

Use the template from the given file instead of the built-in one (use --show-template to obtain an example).

---

##### `terminationProtection`<sup>Optional</sup> <a name="terminationProtection" id="@aws-cdk/cli-lib-alpha.BootstrapOptions.property.terminationProtection"></a>

```typescript
public readonly terminationProtection: boolean;
```

- *Type:* boolean
- *Default:* false

Toggle CloudFormation termination protection on the bootstrap stacks.

---

##### `toolkitStackName`<sup>Optional</sup> <a name="toolkitStackName" id="@aws-cdk/cli-lib-alpha.BootstrapOptions.property.toolkitStackName"></a>

```typescript
public readonly toolkitStackName: string;
```

- *Type:* string

The name of the CDK toolkit stack to create.

---

##### `trust`<sup>Optional</sup> <a name="trust" id="@aws-cdk/cli-lib-alpha.BootstrapOptions.property.trust"></a>

```typescript
public readonly trust: string;
```

- *Type:* string
- *Default:* undefined

The AWS account IDs that should be trusted to perform deployments into this environment (may be repeated, modern bootstrapping only).

---

##### `trustForLookup`<sup>Optional</sup> <a name="trustForLookup" id="@aws-cdk/cli-lib-alpha.BootstrapOptions.property.trustForLookup"></a>

```typescript
public readonly trustForLookup: string;
```

- *Type:* string
- *Default:* undefined

The AWS account IDs that should be trusted to look up values in this environment (may be repeated, modern bootstrapping only).

---

##### `usePreviousParameters`<sup>Optional</sup> <a name="usePreviousParameters" id="@aws-cdk/cli-lib-alpha.BootstrapOptions.property.usePreviousParameters"></a>

```typescript
public readonly usePreviousParameters: boolean;
```

- *Type:* boolean
- *Default:* true

Use previous values for existing parameters (you must specify all parameters on every deployment if this is disabled).

---

### CdkAppDirectoryProps <a name="CdkAppDirectoryProps" id="@aws-cdk/cli-lib-alpha.CdkAppDirectoryProps"></a>

Configuration for creating a CLI from an AWS CDK App directory.

#### Initializer <a name="Initializer" id="@aws-cdk/cli-lib-alpha.CdkAppDirectoryProps.Initializer"></a>

```typescript
import { CdkAppDirectoryProps } from '@aws-cdk/cli-lib-alpha'

const cdkAppDirectoryProps: CdkAppDirectoryProps = { ... }
```

#### Properties <a name="Properties" id="Properties"></a>

| **Name** | **Type** | **Description** |
| --- | --- | --- |
| <code><a href="#@aws-cdk/cli-lib-alpha.CdkAppDirectoryProps.property.app">app</a></code> | <code>string</code> | Command-line for executing your app or a cloud assembly directory e.g. "node bin/my-app.js" or "cdk.out". |
| <code><a href="#@aws-cdk/cli-lib-alpha.CdkAppDirectoryProps.property.output">output</a></code> | <code>string</code> | Emits the synthesized cloud assembly into a directory. |

---

##### `app`<sup>Optional</sup> <a name="app" id="@aws-cdk/cli-lib-alpha.CdkAppDirectoryProps.property.app"></a>

```typescript
public readonly app: string;
```

- *Type:* string
- *Default:* read from cdk.json

Command-line for executing your app or a cloud assembly directory e.g. "node bin/my-app.js" or "cdk.out".

---

##### `output`<sup>Optional</sup> <a name="output" id="@aws-cdk/cli-lib-alpha.CdkAppDirectoryProps.property.output"></a>

```typescript
public readonly output: string;
```

- *Type:* string
- *Default:* cdk.out

Emits the synthesized cloud assembly into a directory.

---

### DeployOptions <a name="DeployOptions" id="@aws-cdk/cli-lib-alpha.DeployOptions"></a>

Options to use with cdk deploy.

#### Initializer <a name="Initializer" id="@aws-cdk/cli-lib-alpha.DeployOptions.Initializer"></a>

```typescript
import { DeployOptions } from '@aws-cdk/cli-lib-alpha'

const deployOptions: DeployOptions = { ... }
```

#### Properties <a name="Properties" id="Properties"></a>

| **Name** | **Type** | **Description** |
| --- | --- | --- |
| <code><a href="#@aws-cdk/cli-lib-alpha.DeployOptions.property.assetMetadata">assetMetadata</a></code> | <code>boolean</code> | Include "aws:asset:*" CloudFormation metadata for resources that use assets. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DeployOptions.property.caBundlePath">caBundlePath</a></code> | <code>string</code> | Path to CA certificate to use when validating HTTPS requests. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DeployOptions.property.color">color</a></code> | <code>boolean</code> | Show colors and other style from console output. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DeployOptions.property.context">context</a></code> | <code>{[ key: string ]: string}</code> | Additional context. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DeployOptions.property.debug">debug</a></code> | <code>boolean</code> | enable emission of additional debugging information, such as creation stack traces of tokens. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DeployOptions.property.ec2Creds">ec2Creds</a></code> | <code>boolean</code> | Force trying to fetch EC2 instance credentials. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DeployOptions.property.ignoreErrors">ignoreErrors</a></code> | <code>boolean</code> | Ignores synthesis errors, which will likely produce an invalid output. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DeployOptions.property.json">json</a></code> | <code>boolean</code> | Use JSON output instead of YAML when templates are printed to STDOUT. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DeployOptions.property.lookups">lookups</a></code> | <code>boolean</code> | Perform context lookups. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DeployOptions.property.notices">notices</a></code> | <code>boolean</code> | Show relevant notices. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DeployOptions.property.pathMetadata">pathMetadata</a></code> | <code>boolean</code> | Include "aws:cdk:path" CloudFormation metadata for each resource. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DeployOptions.property.profile">profile</a></code> | <code>string</code> | Use the indicated AWS profile as the default environment. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DeployOptions.property.proxy">proxy</a></code> | <code>string</code> | Use the indicated proxy. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DeployOptions.property.roleArn">roleArn</a></code> | <code>string</code> | Role to pass to CloudFormation for deployment. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DeployOptions.property.stacks">stacks</a></code> | <code>string[]</code> | List of stacks to deploy. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DeployOptions.property.staging">staging</a></code> | <code>boolean</code> | Copy assets to the output directory. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DeployOptions.property.strict">strict</a></code> | <code>boolean</code> | Do not construct stacks with warnings. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DeployOptions.property.trace">trace</a></code> | <code>boolean</code> | Print trace for stack warnings. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DeployOptions.property.verbose">verbose</a></code> | <code>boolean</code> | show debug logs. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DeployOptions.property.versionReporting">versionReporting</a></code> | <code>boolean</code> | Include "AWS::CDK::Metadata" resource in synthesized templates. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DeployOptions.property.assetParallelism">assetParallelism</a></code> | <code>boolean</code> | Whether to build/publish assets in parallel. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DeployOptions.property.assetPrebuild">assetPrebuild</a></code> | <code>boolean</code> | Whether to build all assets before deploying the first stack (useful for failing Docker builds). |
| <code><a href="#@aws-cdk/cli-lib-alpha.DeployOptions.property.changeSetName">changeSetName</a></code> | <code>string</code> | Optional name to use for the CloudFormation change set. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DeployOptions.property.ci">ci</a></code> | <code>boolean</code> | Whether we are on a CI system. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DeployOptions.property.concurrency">concurrency</a></code> | <code>number</code> | Maximum number of simultaneous deployments (dependency permitting) to execute. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DeployOptions.property.exclusively">exclusively</a></code> | <code>boolean</code> | Only perform action on the given stack. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DeployOptions.property.execute">execute</a></code> | <code>boolean</code> | Whether to execute the ChangeSet Not providing `execute` parameter will result in execution of ChangeSet. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DeployOptions.property.force">force</a></code> | <code>boolean</code> | Always deploy, even if templates are identical. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DeployOptions.property.hotswap">hotswap</a></code> | <code><a href="#@aws-cdk/cli-lib-alpha.HotswapMode">HotswapMode</a></code> | *No description.* |
| <code><a href="#@aws-cdk/cli-lib-alpha.DeployOptions.property.notificationArns">notificationArns</a></code> | <code>string[]</code> | ARNs of SNS topics that CloudFormation will notify with stack related events. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DeployOptions.property.outputsFile">outputsFile</a></code> | <code>string</code> | Path to file where stack outputs will be written after a successful deploy as JSON. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DeployOptions.property.parameters">parameters</a></code> | <code>{[ key: string ]: string}</code> | Additional parameters for CloudFormation at deploy time. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DeployOptions.property.progress">progress</a></code> | <code><a href="#@aws-cdk/cli-lib-alpha.StackActivityProgress">StackActivityProgress</a></code> | Display mode for stack activity events. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DeployOptions.property.requireApproval">requireApproval</a></code> | <code><a href="#@aws-cdk/cli-lib-alpha.RequireApproval">RequireApproval</a></code> | What kind of security changes require approval. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DeployOptions.property.reuseAssets">reuseAssets</a></code> | <code>string[]</code> | Reuse the assets with the given asset IDs. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DeployOptions.property.rollback">rollback</a></code> | <code>boolean</code> | Rollback failed deployments. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DeployOptions.property.toolkitStackName">toolkitStackName</a></code> | <code>string</code> | Name of the toolkit stack to use/deploy. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DeployOptions.property.usePreviousParameters">usePreviousParameters</a></code> | <code>boolean</code> | Use previous values for unspecified parameters. |

---

##### `assetMetadata`<sup>Optional</sup> <a name="assetMetadata" id="@aws-cdk/cli-lib-alpha.DeployOptions.property.assetMetadata"></a>

```typescript
public readonly assetMetadata: boolean;
```

- *Type:* boolean
- *Default:* true

Include "aws:asset:*" CloudFormation metadata for resources that use assets.

---

##### `caBundlePath`<sup>Optional</sup> <a name="caBundlePath" id="@aws-cdk/cli-lib-alpha.DeployOptions.property.caBundlePath"></a>

```typescript
public readonly caBundlePath: string;
```

- *Type:* string
- *Default:* read from AWS_CA_BUNDLE environment variable

Path to CA certificate to use when validating HTTPS requests.

---

##### `color`<sup>Optional</sup> <a name="color" id="@aws-cdk/cli-lib-alpha.DeployOptions.property.color"></a>

```typescript
public readonly color: boolean;
```

- *Type:* boolean
- *Default:* `true` unless the environment variable `NO_COLOR` is set

Show colors and other style from console output.

---

##### `context`<sup>Optional</sup> <a name="context" id="@aws-cdk/cli-lib-alpha.DeployOptions.property.context"></a>

```typescript
public readonly context: {[ key: string ]: string};
```

- *Type:* {[ key: string ]: string}
- *Default:* no additional context

Additional context.

---

##### `debug`<sup>Optional</sup> <a name="debug" id="@aws-cdk/cli-lib-alpha.DeployOptions.property.debug"></a>

```typescript
public readonly debug: boolean;
```

- *Type:* boolean
- *Default:* false

enable emission of additional debugging information, such as creation stack traces of tokens.

---

##### `ec2Creds`<sup>Optional</sup> <a name="ec2Creds" id="@aws-cdk/cli-lib-alpha.DeployOptions.property.ec2Creds"></a>

```typescript
public readonly ec2Creds: boolean;
```

- *Type:* boolean
- *Default:* guess EC2 instance status

Force trying to fetch EC2 instance credentials.

---

##### `ignoreErrors`<sup>Optional</sup> <a name="ignoreErrors" id="@aws-cdk/cli-lib-alpha.DeployOptions.property.ignoreErrors"></a>

```typescript
public readonly ignoreErrors: boolean;
```

- *Type:* boolean
- *Default:* false

Ignores synthesis errors, which will likely produce an invalid output.

---

##### `json`<sup>Optional</sup> <a name="json" id="@aws-cdk/cli-lib-alpha.DeployOptions.property.json"></a>

```typescript
public readonly json: boolean;
```

- *Type:* boolean
- *Default:* false

Use JSON output instead of YAML when templates are printed to STDOUT.

---

##### `lookups`<sup>Optional</sup> <a name="lookups" id="@aws-cdk/cli-lib-alpha.DeployOptions.property.lookups"></a>

```typescript
public readonly lookups: boolean;
```

- *Type:* boolean
- *Default:* true

Perform context lookups.

Synthesis fails if this is disabled and context lookups need
to be performed

---

##### `notices`<sup>Optional</sup> <a name="notices" id="@aws-cdk/cli-lib-alpha.DeployOptions.property.notices"></a>

```typescript
public readonly notices: boolean;
```

- *Type:* boolean
- *Default:* true

Show relevant notices.

---

##### `pathMetadata`<sup>Optional</sup> <a name="pathMetadata" id="@aws-cdk/cli-lib-alpha.DeployOptions.property.pathMetadata"></a>

```typescript
public readonly pathMetadata: boolean;
```

- *Type:* boolean
- *Default:* true

Include "aws:cdk:path" CloudFormation metadata for each resource.

---

##### `profile`<sup>Optional</sup> <a name="profile" id="@aws-cdk/cli-lib-alpha.DeployOptions.property.profile"></a>

```typescript
public readonly profile: string;
```

- *Type:* string
- *Default:* no profile is used

Use the indicated AWS profile as the default environment.

---

##### `proxy`<sup>Optional</sup> <a name="proxy" id="@aws-cdk/cli-lib-alpha.DeployOptions.property.proxy"></a>

```typescript
public readonly proxy: string;
```

- *Type:* string
- *Default:* no proxy

Use the indicated proxy.

Will read from
HTTPS_PROXY environment if specified

---

##### `roleArn`<sup>Optional</sup> <a name="roleArn" id="@aws-cdk/cli-lib-alpha.DeployOptions.property.roleArn"></a>

```typescript
public readonly roleArn: string;
```

- *Type:* string
- *Default:* use the bootstrap cfn-exec role

Role to pass to CloudFormation for deployment.

---

##### `stacks`<sup>Optional</sup> <a name="stacks" id="@aws-cdk/cli-lib-alpha.DeployOptions.property.stacks"></a>

```typescript
public readonly stacks: string[];
```

- *Type:* string[]
- *Default:* all stacks

List of stacks to deploy.

---

##### `staging`<sup>Optional</sup> <a name="staging" id="@aws-cdk/cli-lib-alpha.DeployOptions.property.staging"></a>

```typescript
public readonly staging: boolean;
```

- *Type:* boolean
- *Default:* false

Copy assets to the output directory.

Needed for local debugging the source files with SAM CLI

---

##### `strict`<sup>Optional</sup> <a name="strict" id="@aws-cdk/cli-lib-alpha.DeployOptions.property.strict"></a>

```typescript
public readonly strict: boolean;
```

- *Type:* boolean
- *Default:* false

Do not construct stacks with warnings.

---

##### `trace`<sup>Optional</sup> <a name="trace" id="@aws-cdk/cli-lib-alpha.DeployOptions.property.trace"></a>

```typescript
public readonly trace: boolean;
```

- *Type:* boolean
- *Default:* false

Print trace for stack warnings.

---

##### `verbose`<sup>Optional</sup> <a name="verbose" id="@aws-cdk/cli-lib-alpha.DeployOptions.property.verbose"></a>

```typescript
public readonly verbose: boolean;
```

- *Type:* boolean
- *Default:* false

show debug logs.

---

##### `versionReporting`<sup>Optional</sup> <a name="versionReporting" id="@aws-cdk/cli-lib-alpha.DeployOptions.property.versionReporting"></a>

```typescript
public readonly versionReporting: boolean;
```

- *Type:* boolean
- *Default:* true

Include "AWS::CDK::Metadata" resource in synthesized templates.

---

##### `assetParallelism`<sup>Optional</sup> <a name="assetParallelism" id="@aws-cdk/cli-lib-alpha.DeployOptions.property.assetParallelism"></a>

```typescript
public readonly assetParallelism: boolean;
```

- *Type:* boolean
- *Default:* false

Whether to build/publish assets in parallel.

---

##### `assetPrebuild`<sup>Optional</sup> <a name="assetPrebuild" id="@aws-cdk/cli-lib-alpha.DeployOptions.property.assetPrebuild"></a>

```typescript
public readonly assetPrebuild: boolean;
```

- *Type:* boolean
- *Default:* true

Whether to build all assets before deploying the first stack (useful for failing Docker builds).

---

##### `changeSetName`<sup>Optional</sup> <a name="changeSetName" id="@aws-cdk/cli-lib-alpha.DeployOptions.property.changeSetName"></a>

```typescript
public readonly changeSetName: string;
```

- *Type:* string
- *Default:* auto generate a name

Optional name to use for the CloudFormation change set.

If not provided, a name will be generated automatically.

---

##### `ci`<sup>Optional</sup> <a name="ci" id="@aws-cdk/cli-lib-alpha.DeployOptions.property.ci"></a>

```typescript
public readonly ci: boolean;
```

- *Type:* boolean
- *Default:* `false` unless the environment variable `CI` is set

Whether we are on a CI system.

---

##### `concurrency`<sup>Optional</sup> <a name="concurrency" id="@aws-cdk/cli-lib-alpha.DeployOptions.property.concurrency"></a>

```typescript
public readonly concurrency: number;
```

- *Type:* number
- *Default:* 1

Maximum number of simultaneous deployments (dependency permitting) to execute.

---

##### `exclusively`<sup>Optional</sup> <a name="exclusively" id="@aws-cdk/cli-lib-alpha.DeployOptions.property.exclusively"></a>

```typescript
public readonly exclusively: boolean;
```

- *Type:* boolean
- *Default:* false

Only perform action on the given stack.

---

##### `execute`<sup>Optional</sup> <a name="execute" id="@aws-cdk/cli-lib-alpha.DeployOptions.property.execute"></a>

```typescript
public readonly execute: boolean;
```

- *Type:* boolean
- *Default:* true

Whether to execute the ChangeSet Not providing `execute` parameter will result in execution of ChangeSet.

---

##### `force`<sup>Optional</sup> <a name="force" id="@aws-cdk/cli-lib-alpha.DeployOptions.property.force"></a>

```typescript
public readonly force: boolean;
```

- *Type:* boolean
- *Default:* false

Always deploy, even if templates are identical.

---

##### `hotswap`<sup>Optional</sup> <a name="hotswap" id="@aws-cdk/cli-lib-alpha.DeployOptions.property.hotswap"></a>

```typescript
public readonly hotswap: HotswapMode;
```

- *Type:* <a href="#@aws-cdk/cli-lib-alpha.HotswapMode">HotswapMode</a>

---

##### `notificationArns`<sup>Optional</sup> <a name="notificationArns" id="@aws-cdk/cli-lib-alpha.DeployOptions.property.notificationArns"></a>

```typescript
public readonly notificationArns: string[];
```

- *Type:* string[]
- *Default:* no notifications

ARNs of SNS topics that CloudFormation will notify with stack related events.

---

##### `outputsFile`<sup>Optional</sup> <a name="outputsFile" id="@aws-cdk/cli-lib-alpha.DeployOptions.property.outputsFile"></a>

```typescript
public readonly outputsFile: string;
```

- *Type:* string
- *Default:* Outputs are not written to any file

Path to file where stack outputs will be written after a successful deploy as JSON.

---

##### `parameters`<sup>Optional</sup> <a name="parameters" id="@aws-cdk/cli-lib-alpha.DeployOptions.property.parameters"></a>

```typescript
public readonly parameters: {[ key: string ]: string};
```

- *Type:* {[ key: string ]: string}
- *Default:* {}

Additional parameters for CloudFormation at deploy time.

---

##### `progress`<sup>Optional</sup> <a name="progress" id="@aws-cdk/cli-lib-alpha.DeployOptions.property.progress"></a>

```typescript
public readonly progress: StackActivityProgress;
```

- *Type:* <a href="#@aws-cdk/cli-lib-alpha.StackActivityProgress">StackActivityProgress</a>
- *Default:* StackActivityProgress.EVENTS

Display mode for stack activity events.

The default in the CLI is StackActivityProgress.BAR. But since this is an API
it makes more sense to set the default to StackActivityProgress.EVENTS

---

##### `requireApproval`<sup>Optional</sup> <a name="requireApproval" id="@aws-cdk/cli-lib-alpha.DeployOptions.property.requireApproval"></a>

```typescript
public readonly requireApproval: RequireApproval;
```

- *Type:* <a href="#@aws-cdk/cli-lib-alpha.RequireApproval">RequireApproval</a>
- *Default:* RequireApproval.Never

What kind of security changes require approval.

---

##### `reuseAssets`<sup>Optional</sup> <a name="reuseAssets" id="@aws-cdk/cli-lib-alpha.DeployOptions.property.reuseAssets"></a>

```typescript
public readonly reuseAssets: string[];
```

- *Type:* string[]
- *Default:* do not reuse assets

Reuse the assets with the given asset IDs.

---

##### `rollback`<sup>Optional</sup> <a name="rollback" id="@aws-cdk/cli-lib-alpha.DeployOptions.property.rollback"></a>

```typescript
public readonly rollback: boolean;
```

- *Type:* boolean
- *Default:* true

Rollback failed deployments.

---

##### `toolkitStackName`<sup>Optional</sup> <a name="toolkitStackName" id="@aws-cdk/cli-lib-alpha.DeployOptions.property.toolkitStackName"></a>

```typescript
public readonly toolkitStackName: string;
```

- *Type:* string
- *Default:* CDKToolkit

Name of the toolkit stack to use/deploy.

---

##### `usePreviousParameters`<sup>Optional</sup> <a name="usePreviousParameters" id="@aws-cdk/cli-lib-alpha.DeployOptions.property.usePreviousParameters"></a>

```typescript
public readonly usePreviousParameters: boolean;
```

- *Type:* boolean
- *Default:* true

Use previous values for unspecified parameters.

If not set, all parameters must be specified for every deployment.

---

### DestroyOptions <a name="DestroyOptions" id="@aws-cdk/cli-lib-alpha.DestroyOptions"></a>

Options to use with cdk destroy.

#### Initializer <a name="Initializer" id="@aws-cdk/cli-lib-alpha.DestroyOptions.Initializer"></a>

```typescript
import { DestroyOptions } from '@aws-cdk/cli-lib-alpha'

const destroyOptions: DestroyOptions = { ... }
```

#### Properties <a name="Properties" id="Properties"></a>

| **Name** | **Type** | **Description** |
| --- | --- | --- |
| <code><a href="#@aws-cdk/cli-lib-alpha.DestroyOptions.property.assetMetadata">assetMetadata</a></code> | <code>boolean</code> | Include "aws:asset:*" CloudFormation metadata for resources that use assets. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DestroyOptions.property.caBundlePath">caBundlePath</a></code> | <code>string</code> | Path to CA certificate to use when validating HTTPS requests. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DestroyOptions.property.color">color</a></code> | <code>boolean</code> | Show colors and other style from console output. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DestroyOptions.property.context">context</a></code> | <code>{[ key: string ]: string}</code> | Additional context. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DestroyOptions.property.debug">debug</a></code> | <code>boolean</code> | enable emission of additional debugging information, such as creation stack traces of tokens. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DestroyOptions.property.ec2Creds">ec2Creds</a></code> | <code>boolean</code> | Force trying to fetch EC2 instance credentials. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DestroyOptions.property.ignoreErrors">ignoreErrors</a></code> | <code>boolean</code> | Ignores synthesis errors, which will likely produce an invalid output. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DestroyOptions.property.json">json</a></code> | <code>boolean</code> | Use JSON output instead of YAML when templates are printed to STDOUT. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DestroyOptions.property.lookups">lookups</a></code> | <code>boolean</code> | Perform context lookups. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DestroyOptions.property.notices">notices</a></code> | <code>boolean</code> | Show relevant notices. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DestroyOptions.property.pathMetadata">pathMetadata</a></code> | <code>boolean</code> | Include "aws:cdk:path" CloudFormation metadata for each resource. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DestroyOptions.property.profile">profile</a></code> | <code>string</code> | Use the indicated AWS profile as the default environment. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DestroyOptions.property.proxy">proxy</a></code> | <code>string</code> | Use the indicated proxy. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DestroyOptions.property.roleArn">roleArn</a></code> | <code>string</code> | Role to pass to CloudFormation for deployment. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DestroyOptions.property.stacks">stacks</a></code> | <code>string[]</code> | List of stacks to deploy. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DestroyOptions.property.staging">staging</a></code> | <code>boolean</code> | Copy assets to the output directory. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DestroyOptions.property.strict">strict</a></code> | <code>boolean</code> | Do not construct stacks with warnings. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DestroyOptions.property.trace">trace</a></code> | <code>boolean</code> | Print trace for stack warnings. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DestroyOptions.property.verbose">verbose</a></code> | <code>boolean</code> | show debug logs. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DestroyOptions.property.versionReporting">versionReporting</a></code> | <code>boolean</code> | Include "AWS::CDK::Metadata" resource in synthesized templates. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DestroyOptions.property.exclusively">exclusively</a></code> | <code>boolean</code> | Only destroy the given stack. |
| <code><a href="#@aws-cdk/cli-lib-alpha.DestroyOptions.property.requireApproval">requireApproval</a></code> | <code>boolean</code> | Should the script prompt for approval before destroying stacks. |

---

##### `assetMetadata`<sup>Optional</sup> <a name="assetMetadata" id="@aws-cdk/cli-lib-alpha.DestroyOptions.property.assetMetadata"></a>

```typescript
public readonly assetMetadata: boolean;
```

- *Type:* boolean
- *Default:* true

Include "aws:asset:*" CloudFormation metadata for resources that use assets.

---

##### `caBundlePath`<sup>Optional</sup> <a name="caBundlePath" id="@aws-cdk/cli-lib-alpha.DestroyOptions.property.caBundlePath"></a>

```typescript
public readonly caBundlePath: string;
```

- *Type:* string
- *Default:* read from AWS_CA_BUNDLE environment variable

Path to CA certificate to use when validating HTTPS requests.

---

##### `color`<sup>Optional</sup> <a name="color" id="@aws-cdk/cli-lib-alpha.DestroyOptions.property.color"></a>

```typescript
public readonly color: boolean;
```

- *Type:* boolean
- *Default:* `true` unless the environment variable `NO_COLOR` is set

Show colors and other style from console output.

---

##### `context`<sup>Optional</sup> <a name="context" id="@aws-cdk/cli-lib-alpha.DestroyOptions.property.context"></a>

```typescript
public readonly context: {[ key: string ]: string};
```

- *Type:* {[ key: string ]: string}
- *Default:* no additional context

Additional context.

---

##### `debug`<sup>Optional</sup> <a name="debug" id="@aws-cdk/cli-lib-alpha.DestroyOptions.property.debug"></a>

```typescript
public readonly debug: boolean;
```

- *Type:* boolean
- *Default:* false

enable emission of additional debugging information, such as creation stack traces of tokens.

---

##### `ec2Creds`<sup>Optional</sup> <a name="ec2Creds" id="@aws-cdk/cli-lib-alpha.DestroyOptions.property.ec2Creds"></a>

```typescript
public readonly ec2Creds: boolean;
```

- *Type:* boolean
- *Default:* guess EC2 instance status

Force trying to fetch EC2 instance credentials.

---

##### `ignoreErrors`<sup>Optional</sup> <a name="ignoreErrors" id="@aws-cdk/cli-lib-alpha.DestroyOptions.property.ignoreErrors"></a>

```typescript
public readonly ignoreErrors: boolean;
```

- *Type:* boolean
- *Default:* false

Ignores synthesis errors, which will likely produce an invalid output.

---

##### `json`<sup>Optional</sup> <a name="json" id="@aws-cdk/cli-lib-alpha.DestroyOptions.property.json"></a>

```typescript
public readonly json: boolean;
```

- *Type:* boolean
- *Default:* false

Use JSON output instead of YAML when templates are printed to STDOUT.

---

##### `lookups`<sup>Optional</sup> <a name="lookups" id="@aws-cdk/cli-lib-alpha.DestroyOptions.property.lookups"></a>

```typescript
public readonly lookups: boolean;
```

- *Type:* boolean
- *Default:* true

Perform context lookups.

Synthesis fails if this is disabled and context lookups need
to be performed

---

##### `notices`<sup>Optional</sup> <a name="notices" id="@aws-cdk/cli-lib-alpha.DestroyOptions.property.notices"></a>

```typescript
public readonly notices: boolean;
```

- *Type:* boolean
- *Default:* true

Show relevant notices.

---

##### `pathMetadata`<sup>Optional</sup> <a name="pathMetadata" id="@aws-cdk/cli-lib-alpha.DestroyOptions.property.pathMetadata"></a>

```typescript
public readonly pathMetadata: boolean;
```

- *Type:* boolean
- *Default:* true

Include "aws:cdk:path" CloudFormation metadata for each resource.

---

##### `profile`<sup>Optional</sup> <a name="profile" id="@aws-cdk/cli-lib-alpha.DestroyOptions.property.profile"></a>

```typescript
public readonly profile: string;
```

- *Type:* string
- *Default:* no profile is used

Use the indicated AWS profile as the default environment.

---

##### `proxy`<sup>Optional</sup> <a name="proxy" id="@aws-cdk/cli-lib-alpha.DestroyOptions.property.proxy"></a>

```typescript
public readonly proxy: string;
```

- *Type:* string
- *Default:* no proxy

Use the indicated proxy.

Will read from
HTTPS_PROXY environment if specified

---

##### `roleArn`<sup>Optional</sup> <a name="roleArn" id="@aws-cdk/cli-lib-alpha.DestroyOptions.property.roleArn"></a>

```typescript
public readonly roleArn: string;
```

- *Type:* string
- *Default:* use the bootstrap cfn-exec role

Role to pass to CloudFormation for deployment.

---

##### `stacks`<sup>Optional</sup> <a name="stacks" id="@aws-cdk/cli-lib-alpha.DestroyOptions.property.stacks"></a>

```typescript
public readonly stacks: string[];
```

- *Type:* string[]
- *Default:* all stacks

List of stacks to deploy.

---

##### `staging`<sup>Optional</sup> <a name="staging" id="@aws-cdk/cli-lib-alpha.DestroyOptions.property.staging"></a>

```typescript
public readonly staging: boolean;
```

- *Type:* boolean
- *Default:* false

Copy assets to the output directory.

Needed for local debugging the source files with SAM CLI

---

##### `strict`<sup>Optional</sup> <a name="strict" id="@aws-cdk/cli-lib-alpha.DestroyOptions.property.strict"></a>

```typescript
public readonly strict: boolean;
```

- *Type:* boolean
- *Default:* false

Do not construct stacks with warnings.

---

##### `trace`<sup>Optional</sup> <a name="trace" id="@aws-cdk/cli-lib-alpha.DestroyOptions.property.trace"></a>

```typescript
public readonly trace: boolean;
```

- *Type:* boolean
- *Default:* false

Print trace for stack warnings.

---

##### `verbose`<sup>Optional</sup> <a name="verbose" id="@aws-cdk/cli-lib-alpha.DestroyOptions.property.verbose"></a>

```typescript
public readonly verbose: boolean;
```

- *Type:* boolean
- *Default:* false

show debug logs.

---

##### `versionReporting`<sup>Optional</sup> <a name="versionReporting" id="@aws-cdk/cli-lib-alpha.DestroyOptions.property.versionReporting"></a>

```typescript
public readonly versionReporting: boolean;
```

- *Type:* boolean
- *Default:* true

Include "AWS::CDK::Metadata" resource in synthesized templates.

---

##### `exclusively`<sup>Optional</sup> <a name="exclusively" id="@aws-cdk/cli-lib-alpha.DestroyOptions.property.exclusively"></a>

```typescript
public readonly exclusively: boolean;
```

- *Type:* boolean
- *Default:* false

Only destroy the given stack.

---

##### `requireApproval`<sup>Optional</sup> <a name="requireApproval" id="@aws-cdk/cli-lib-alpha.DestroyOptions.property.requireApproval"></a>

```typescript
public readonly requireApproval: boolean;
```

- *Type:* boolean
- *Default:* false

Should the script prompt for approval before destroying stacks.

---

### ListOptions <a name="ListOptions" id="@aws-cdk/cli-lib-alpha.ListOptions"></a>

Options for cdk list.

#### Initializer <a name="Initializer" id="@aws-cdk/cli-lib-alpha.ListOptions.Initializer"></a>

```typescript
import { ListOptions } from '@aws-cdk/cli-lib-alpha'

const listOptions: ListOptions = { ... }
```

#### Properties <a name="Properties" id="Properties"></a>

| **Name** | **Type** | **Description** |
| --- | --- | --- |
| <code><a href="#@aws-cdk/cli-lib-alpha.ListOptions.property.assetMetadata">assetMetadata</a></code> | <code>boolean</code> | Include "aws:asset:*" CloudFormation metadata for resources that use assets. |
| <code><a href="#@aws-cdk/cli-lib-alpha.ListOptions.property.caBundlePath">caBundlePath</a></code> | <code>string</code> | Path to CA certificate to use when validating HTTPS requests. |
| <code><a href="#@aws-cdk/cli-lib-alpha.ListOptions.property.color">color</a></code> | <code>boolean</code> | Show colors and other style from console output. |
| <code><a href="#@aws-cdk/cli-lib-alpha.ListOptions.property.context">context</a></code> | <code>{[ key: string ]: string}</code> | Additional context. |
| <code><a href="#@aws-cdk/cli-lib-alpha.ListOptions.property.debug">debug</a></code> | <code>boolean</code> | enable emission of additional debugging information, such as creation stack traces of tokens. |
| <code><a href="#@aws-cdk/cli-lib-alpha.ListOptions.property.ec2Creds">ec2Creds</a></code> | <code>boolean</code> | Force trying to fetch EC2 instance credentials. |
| <code><a href="#@aws-cdk/cli-lib-alpha.ListOptions.property.ignoreErrors">ignoreErrors</a></code> | <code>boolean</code> | Ignores synthesis errors, which will likely produce an invalid output. |
| <code><a href="#@aws-cdk/cli-lib-alpha.ListOptions.property.json">json</a></code> | <code>boolean</code> | Use JSON output instead of YAML when templates are printed to STDOUT. |
| <code><a href="#@aws-cdk/cli-lib-alpha.ListOptions.property.lookups">lookups</a></code> | <code>boolean</code> | Perform context lookups. |
| <code><a href="#@aws-cdk/cli-lib-alpha.ListOptions.property.notices">notices</a></code> | <code>boolean</code> | Show relevant notices. |
| <code><a href="#@aws-cdk/cli-lib-alpha.ListOptions.property.pathMetadata">pathMetadata</a></code> | <code>boolean</code> | Include "aws:cdk:path" CloudFormation metadata for each resource. |
| <code><a href="#@aws-cdk/cli-lib-alpha.ListOptions.property.profile">profile</a></code> | <code>string</code> | Use the indicated AWS profile as the default environment. |
| <code><a href="#@aws-cdk/cli-lib-alpha.ListOptions.property.proxy">proxy</a></code> | <code>string</code> | Use the indicated proxy. |
| <code><a href="#@aws-cdk/cli-lib-alpha.ListOptions.property.roleArn">roleArn</a></code> | <code>string</code> | Role to pass to CloudFormation for deployment. |
| <code><a href="#@aws-cdk/cli-lib-alpha.ListOptions.property.stacks">stacks</a></code> | <code>string[]</code> | List of stacks to deploy. |
| <code><a href="#@aws-cdk/cli-lib-alpha.ListOptions.property.staging">staging</a></code> | <code>boolean</code> | Copy assets to the output directory. |
| <code><a href="#@aws-cdk/cli-lib-alpha.ListOptions.property.strict">strict</a></code> | <code>boolean</code> | Do not construct stacks with warnings. |
| <code><a href="#@aws-cdk/cli-lib-alpha.ListOptions.property.trace">trace</a></code> | <code>boolean</code> | Print trace for stack warnings. |
| <code><a href="#@aws-cdk/cli-lib-alpha.ListOptions.property.verbose">verbose</a></code> | <code>boolean</code> | show debug logs. |
| <code><a href="#@aws-cdk/cli-lib-alpha.ListOptions.property.versionReporting">versionReporting</a></code> | <code>boolean</code> | Include "AWS::CDK::Metadata" resource in synthesized templates. |
| <code><a href="#@aws-cdk/cli-lib-alpha.ListOptions.property.long">long</a></code> | <code>boolean</code> | Display environment information for each stack. |

---

##### `assetMetadata`<sup>Optional</sup> <a name="assetMetadata" id="@aws-cdk/cli-lib-alpha.ListOptions.property.assetMetadata"></a>

```typescript
public readonly assetMetadata: boolean;
```

- *Type:* boolean
- *Default:* true

Include "aws:asset:*" CloudFormation metadata for resources that use assets.

---

##### `caBundlePath`<sup>Optional</sup> <a name="caBundlePath" id="@aws-cdk/cli-lib-alpha.ListOptions.property.caBundlePath"></a>

```typescript
public readonly caBundlePath: string;
```

- *Type:* string
- *Default:* read from AWS_CA_BUNDLE environment variable

Path to CA certificate to use when validating HTTPS requests.

---

##### `color`<sup>Optional</sup> <a name="color" id="@aws-cdk/cli-lib-alpha.ListOptions.property.color"></a>

```typescript
public readonly color: boolean;
```

- *Type:* boolean
- *Default:* `true` unless the environment variable `NO_COLOR` is set

Show colors and other style from console output.

---

##### `context`<sup>Optional</sup> <a name="context" id="@aws-cdk/cli-lib-alpha.ListOptions.property.context"></a>

```typescript
public readonly context: {[ key: string ]: string};
```

- *Type:* {[ key: string ]: string}
- *Default:* no additional context

Additional context.

---

##### `debug`<sup>Optional</sup> <a name="debug" id="@aws-cdk/cli-lib-alpha.ListOptions.property.debug"></a>

```typescript
public readonly debug: boolean;
```

- *Type:* boolean
- *Default:* false

enable emission of additional debugging information, such as creation stack traces of tokens.

---

##### `ec2Creds`<sup>Optional</sup> <a name="ec2Creds" id="@aws-cdk/cli-lib-alpha.ListOptions.property.ec2Creds"></a>

```typescript
public readonly ec2Creds: boolean;
```

- *Type:* boolean
- *Default:* guess EC2 instance status

Force trying to fetch EC2 instance credentials.

---

##### `ignoreErrors`<sup>Optional</sup> <a name="ignoreErrors" id="@aws-cdk/cli-lib-alpha.ListOptions.property.ignoreErrors"></a>

```typescript
public readonly ignoreErrors: boolean;
```

- *Type:* boolean
- *Default:* false

Ignores synthesis errors, which will likely produce an invalid output.

---

##### `json`<sup>Optional</sup> <a name="json" id="@aws-cdk/cli-lib-alpha.ListOptions.property.json"></a>

```typescript
public readonly json: boolean;
```

- *Type:* boolean
- *Default:* false

Use JSON output instead of YAML when templates are printed to STDOUT.

---

##### `lookups`<sup>Optional</sup> <a name="lookups" id="@aws-cdk/cli-lib-alpha.ListOptions.property.lookups"></a>

```typescript
public readonly lookups: boolean;
```

- *Type:* boolean
- *Default:* true

Perform context lookups.

Synthesis fails if this is disabled and context lookups need
to be performed

---

##### `notices`<sup>Optional</sup> <a name="notices" id="@aws-cdk/cli-lib-alpha.ListOptions.property.notices"></a>

```typescript
public readonly notices: boolean;
```

- *Type:* boolean
- *Default:* true

Show relevant notices.

---

##### `pathMetadata`<sup>Optional</sup> <a name="pathMetadata" id="@aws-cdk/cli-lib-alpha.ListOptions.property.pathMetadata"></a>

```typescript
public readonly pathMetadata: boolean;
```

- *Type:* boolean
- *Default:* true

Include "aws:cdk:path" CloudFormation metadata for each resource.

---

##### `profile`<sup>Optional</sup> <a name="profile" id="@aws-cdk/cli-lib-alpha.ListOptions.property.profile"></a>

```typescript
public readonly profile: string;
```

- *Type:* string
- *Default:* no profile is used

Use the indicated AWS profile as the default environment.

---

##### `proxy`<sup>Optional</sup> <a name="proxy" id="@aws-cdk/cli-lib-alpha.ListOptions.property.proxy"></a>

```typescript
public readonly proxy: string;
```

- *Type:* string
- *Default:* no proxy

Use the indicated proxy.

Will read from
HTTPS_PROXY environment if specified

---

##### `roleArn`<sup>Optional</sup> <a name="roleArn" id="@aws-cdk/cli-lib-alpha.ListOptions.property.roleArn"></a>

```typescript
public readonly roleArn: string;
```

- *Type:* string
- *Default:* use the bootstrap cfn-exec role

Role to pass to CloudFormation for deployment.

---

##### `stacks`<sup>Optional</sup> <a name="stacks" id="@aws-cdk/cli-lib-alpha.ListOptions.property.stacks"></a>

```typescript
public readonly stacks: string[];
```

- *Type:* string[]
- *Default:* all stacks

List of stacks to deploy.

---

##### `staging`<sup>Optional</sup> <a name="staging" id="@aws-cdk/cli-lib-alpha.ListOptions.property.staging"></a>

```typescript
public readonly staging: boolean;
```

- *Type:* boolean
- *Default:* false

Copy assets to the output directory.

Needed for local debugging the source files with SAM CLI

---

##### `strict`<sup>Optional</sup> <a name="strict" id="@aws-cdk/cli-lib-alpha.ListOptions.property.strict"></a>

```typescript
public readonly strict: boolean;
```

- *Type:* boolean
- *Default:* false

Do not construct stacks with warnings.

---

##### `trace`<sup>Optional</sup> <a name="trace" id="@aws-cdk/cli-lib-alpha.ListOptions.property.trace"></a>

```typescript
public readonly trace: boolean;
```

- *Type:* boolean
- *Default:* false

Print trace for stack warnings.

---

##### `verbose`<sup>Optional</sup> <a name="verbose" id="@aws-cdk/cli-lib-alpha.ListOptions.property.verbose"></a>

```typescript
public readonly verbose: boolean;
```

- *Type:* boolean
- *Default:* false

show debug logs.

---

##### `versionReporting`<sup>Optional</sup> <a name="versionReporting" id="@aws-cdk/cli-lib-alpha.ListOptions.property.versionReporting"></a>

```typescript
public readonly versionReporting: boolean;
```

- *Type:* boolean
- *Default:* true

Include "AWS::CDK::Metadata" resource in synthesized templates.

---

##### `long`<sup>Optional</sup> <a name="long" id="@aws-cdk/cli-lib-alpha.ListOptions.property.long"></a>

```typescript
public readonly long: boolean;
```

- *Type:* boolean
- *Default:* false

Display environment information for each stack.

---

### SharedOptions <a name="SharedOptions" id="@aws-cdk/cli-lib-alpha.SharedOptions"></a>

AWS CDK CLI options that apply to all commands.

#### Initializer <a name="Initializer" id="@aws-cdk/cli-lib-alpha.SharedOptions.Initializer"></a>

```typescript
import { SharedOptions } from '@aws-cdk/cli-lib-alpha'

const sharedOptions: SharedOptions = { ... }
```

#### Properties <a name="Properties" id="Properties"></a>

| **Name** | **Type** | **Description** |
| --- | --- | --- |
| <code><a href="#@aws-cdk/cli-lib-alpha.SharedOptions.property.assetMetadata">assetMetadata</a></code> | <code>boolean</code> | Include "aws:asset:*" CloudFormation metadata for resources that use assets. |
| <code><a href="#@aws-cdk/cli-lib-alpha.SharedOptions.property.caBundlePath">caBundlePath</a></code> | <code>string</code> | Path to CA certificate to use when validating HTTPS requests. |
| <code><a href="#@aws-cdk/cli-lib-alpha.SharedOptions.property.color">color</a></code> | <code>boolean</code> | Show colors and other style from console output. |
| <code><a href="#@aws-cdk/cli-lib-alpha.SharedOptions.property.context">context</a></code> | <code>{[ key: string ]: string}</code> | Additional context. |
| <code><a href="#@aws-cdk/cli-lib-alpha.SharedOptions.property.debug">debug</a></code> | <code>boolean</code> | enable emission of additional debugging information, such as creation stack traces of tokens. |
| <code><a href="#@aws-cdk/cli-lib-alpha.SharedOptions.property.ec2Creds">ec2Creds</a></code> | <code>boolean</code> | Force trying to fetch EC2 instance credentials. |
| <code><a href="#@aws-cdk/cli-lib-alpha.SharedOptions.property.ignoreErrors">ignoreErrors</a></code> | <code>boolean</code> | Ignores synthesis errors, which will likely produce an invalid output. |
| <code><a href="#@aws-cdk/cli-lib-alpha.SharedOptions.property.json">json</a></code> | <code>boolean</code> | Use JSON output instead of YAML when templates are printed to STDOUT. |
| <code><a href="#@aws-cdk/cli-lib-alpha.SharedOptions.property.lookups">lookups</a></code> | <code>boolean</code> | Perform context lookups. |
| <code><a href="#@aws-cdk/cli-lib-alpha.SharedOptions.property.notices">notices</a></code> | <code>boolean</code> | Show relevant notices. |
| <code><a href="#@aws-cdk/cli-lib-alpha.SharedOptions.property.pathMetadata">pathMetadata</a></code> | <code>boolean</code> | Include "aws:cdk:path" CloudFormation metadata for each resource. |
| <code><a href="#@aws-cdk/cli-lib-alpha.SharedOptions.property.profile">profile</a></code> | <code>string</code> | Use the indicated AWS profile as the default environment. |
| <code><a href="#@aws-cdk/cli-lib-alpha.SharedOptions.property.proxy">proxy</a></code> | <code>string</code> | Use the indicated proxy. |
| <code><a href="#@aws-cdk/cli-lib-alpha.SharedOptions.property.roleArn">roleArn</a></code> | <code>string</code> | Role to pass to CloudFormation for deployment. |
| <code><a href="#@aws-cdk/cli-lib-alpha.SharedOptions.property.stacks">stacks</a></code> | <code>string[]</code> | List of stacks to deploy. |
| <code><a href="#@aws-cdk/cli-lib-alpha.SharedOptions.property.staging">staging</a></code> | <code>boolean</code> | Copy assets to the output directory. |
| <code><a href="#@aws-cdk/cli-lib-alpha.SharedOptions.property.strict">strict</a></code> | <code>boolean</code> | Do not construct stacks with warnings. |
| <code><a href="#@aws-cdk/cli-lib-alpha.SharedOptions.property.trace">trace</a></code> | <code>boolean</code> | Print trace for stack warnings. |
| <code><a href="#@aws-cdk/cli-lib-alpha.SharedOptions.property.verbose">verbose</a></code> | <code>boolean</code> | show debug logs. |
| <code><a href="#@aws-cdk/cli-lib-alpha.SharedOptions.property.versionReporting">versionReporting</a></code> | <code>boolean</code> | Include "AWS::CDK::Metadata" resource in synthesized templates. |

---

##### `assetMetadata`<sup>Optional</sup> <a name="assetMetadata" id="@aws-cdk/cli-lib-alpha.SharedOptions.property.assetMetadata"></a>

```typescript
public readonly assetMetadata: boolean;
```

- *Type:* boolean
- *Default:* true

Include "aws:asset:*" CloudFormation metadata for resources that use assets.

---

##### `caBundlePath`<sup>Optional</sup> <a name="caBundlePath" id="@aws-cdk/cli-lib-alpha.SharedOptions.property.caBundlePath"></a>

```typescript
public readonly caBundlePath: string;
```

- *Type:* string
- *Default:* read from AWS_CA_BUNDLE environment variable

Path to CA certificate to use when validating HTTPS requests.

---

##### `color`<sup>Optional</sup> <a name="color" id="@aws-cdk/cli-lib-alpha.SharedOptions.property.color"></a>

```typescript
public readonly color: boolean;
```

- *Type:* boolean
- *Default:* `true` unless the environment variable `NO_COLOR` is set

Show colors and other style from console output.

---

##### `context`<sup>Optional</sup> <a name="context" id="@aws-cdk/cli-lib-alpha.SharedOptions.property.context"></a>

```typescript
public readonly context: {[ key: string ]: string};
```

- *Type:* {[ key: string ]: string}
- *Default:* no additional context

Additional context.

---

##### `debug`<sup>Optional</sup> <a name="debug" id="@aws-cdk/cli-lib-alpha.SharedOptions.property.debug"></a>

```typescript
public readonly debug: boolean;
```

- *Type:* boolean
- *Default:* false

enable emission of additional debugging information, such as creation stack traces of tokens.

---

##### `ec2Creds`<sup>Optional</sup> <a name="ec2Creds" id="@aws-cdk/cli-lib-alpha.SharedOptions.property.ec2Creds"></a>

```typescript
public readonly ec2Creds: boolean;
```

- *Type:* boolean
- *Default:* guess EC2 instance status

Force trying to fetch EC2 instance credentials.

---

##### `ignoreErrors`<sup>Optional</sup> <a name="ignoreErrors" id="@aws-cdk/cli-lib-alpha.SharedOptions.property.ignoreErrors"></a>

```typescript
public readonly ignoreErrors: boolean;
```

- *Type:* boolean
- *Default:* false

Ignores synthesis errors, which will likely produce an invalid output.

---

##### `json`<sup>Optional</sup> <a name="json" id="@aws-cdk/cli-lib-alpha.SharedOptions.property.json"></a>

```typescript
public readonly json: boolean;
```

- *Type:* boolean
- *Default:* false

Use JSON output instead of YAML when templates are printed to STDOUT.

---

##### `lookups`<sup>Optional</sup> <a name="lookups" id="@aws-cdk/cli-lib-alpha.SharedOptions.property.lookups"></a>

```typescript
public readonly lookups: boolean;
```

- *Type:* boolean
- *Default:* true

Perform context lookups.

Synthesis fails if this is disabled and context lookups need
to be performed

---

##### `notices`<sup>Optional</sup> <a name="notices" id="@aws-cdk/cli-lib-alpha.SharedOptions.property.notices"></a>

```typescript
public readonly notices: boolean;
```

- *Type:* boolean
- *Default:* true

Show relevant notices.

---

##### `pathMetadata`<sup>Optional</sup> <a name="pathMetadata" id="@aws-cdk/cli-lib-alpha.SharedOptions.property.pathMetadata"></a>

```typescript
public readonly pathMetadata: boolean;
```

- *Type:* boolean
- *Default:* true

Include "aws:cdk:path" CloudFormation metadata for each resource.

---

##### `profile`<sup>Optional</sup> <a name="profile" id="@aws-cdk/cli-lib-alpha.SharedOptions.property.profile"></a>

```typescript
public readonly profile: string;
```

- *Type:* string
- *Default:* no profile is used

Use the indicated AWS profile as the default environment.

---

##### `proxy`<sup>Optional</sup> <a name="proxy" id="@aws-cdk/cli-lib-alpha.SharedOptions.property.proxy"></a>

```typescript
public readonly proxy: string;
```

- *Type:* string
- *Default:* no proxy

Use the indicated proxy.

Will read from
HTTPS_PROXY environment if specified

---

##### `roleArn`<sup>Optional</sup> <a name="roleArn" id="@aws-cdk/cli-lib-alpha.SharedOptions.property.roleArn"></a>

```typescript
public readonly roleArn: string;
```

- *Type:* string
- *Default:* use the bootstrap cfn-exec role

Role to pass to CloudFormation for deployment.

---

##### `stacks`<sup>Optional</sup> <a name="stacks" id="@aws-cdk/cli-lib-alpha.SharedOptions.property.stacks"></a>

```typescript
public readonly stacks: string[];
```

- *Type:* string[]
- *Default:* all stacks

List of stacks to deploy.

---

##### `staging`<sup>Optional</sup> <a name="staging" id="@aws-cdk/cli-lib-alpha.SharedOptions.property.staging"></a>

```typescript
public readonly staging: boolean;
```

- *Type:* boolean
- *Default:* false

Copy assets to the output directory.

Needed for local debugging the source files with SAM CLI

---

##### `strict`<sup>Optional</sup> <a name="strict" id="@aws-cdk/cli-lib-alpha.SharedOptions.property.strict"></a>

```typescript
public readonly strict: boolean;
```

- *Type:* boolean
- *Default:* false

Do not construct stacks with warnings.

---

##### `trace`<sup>Optional</sup> <a name="trace" id="@aws-cdk/cli-lib-alpha.SharedOptions.property.trace"></a>

```typescript
public readonly trace: boolean;
```

- *Type:* boolean
- *Default:* false

Print trace for stack warnings.

---

##### `verbose`<sup>Optional</sup> <a name="verbose" id="@aws-cdk/cli-lib-alpha.SharedOptions.property.verbose"></a>

```typescript
public readonly verbose: boolean;
```

- *Type:* boolean
- *Default:* false

show debug logs.

---

##### `versionReporting`<sup>Optional</sup> <a name="versionReporting" id="@aws-cdk/cli-lib-alpha.SharedOptions.property.versionReporting"></a>

```typescript
public readonly versionReporting: boolean;
```

- *Type:* boolean
- *Default:* true

Include "AWS::CDK::Metadata" resource in synthesized templates.

---

### SynthOptions <a name="SynthOptions" id="@aws-cdk/cli-lib-alpha.SynthOptions"></a>

Options to use with cdk synth.

#### Initializer <a name="Initializer" id="@aws-cdk/cli-lib-alpha.SynthOptions.Initializer"></a>

```typescript
import { SynthOptions } from '@aws-cdk/cli-lib-alpha'

const synthOptions: SynthOptions = { ... }
```

#### Properties <a name="Properties" id="Properties"></a>

| **Name** | **Type** | **Description** |
| --- | --- | --- |
| <code><a href="#@aws-cdk/cli-lib-alpha.SynthOptions.property.assetMetadata">assetMetadata</a></code> | <code>boolean</code> | Include "aws:asset:*" CloudFormation metadata for resources that use assets. |
| <code><a href="#@aws-cdk/cli-lib-alpha.SynthOptions.property.caBundlePath">caBundlePath</a></code> | <code>string</code> | Path to CA certificate to use when validating HTTPS requests. |
| <code><a href="#@aws-cdk/cli-lib-alpha.SynthOptions.property.color">color</a></code> | <code>boolean</code> | Show colors and other style from console output. |
| <code><a href="#@aws-cdk/cli-lib-alpha.SynthOptions.property.context">context</a></code> | <code>{[ key: string ]: string}</code> | Additional context. |
| <code><a href="#@aws-cdk/cli-lib-alpha.SynthOptions.property.debug">debug</a></code> | <code>boolean</code> | enable emission of additional debugging information, such as creation stack traces of tokens. |
| <code><a href="#@aws-cdk/cli-lib-alpha.SynthOptions.property.ec2Creds">ec2Creds</a></code> | <code>boolean</code> | Force trying to fetch EC2 instance credentials. |
| <code><a href="#@aws-cdk/cli-lib-alpha.SynthOptions.property.ignoreErrors">ignoreErrors</a></code> | <code>boolean</code> | Ignores synthesis errors, which will likely produce an invalid output. |
| <code><a href="#@aws-cdk/cli-lib-alpha.SynthOptions.property.json">json</a></code> | <code>boolean</code> | Use JSON output instead of YAML when templates are printed to STDOUT. |
| <code><a href="#@aws-cdk/cli-lib-alpha.SynthOptions.property.lookups">lookups</a></code> | <code>boolean</code> | Perform context lookups. |
| <code><a href="#@aws-cdk/cli-lib-alpha.SynthOptions.property.notices">notices</a></code> | <code>boolean</code> | Show relevant notices. |
| <code><a href="#@aws-cdk/cli-lib-alpha.SynthOptions.property.pathMetadata">pathMetadata</a></code> | <code>boolean</code> | Include "aws:cdk:path" CloudFormation metadata for each resource. |
| <code><a href="#@aws-cdk/cli-lib-alpha.SynthOptions.property.profile">profile</a></code> | <code>string</code> | Use the indicated AWS profile as the default environment. |
| <code><a href="#@aws-cdk/cli-lib-alpha.SynthOptions.property.proxy">proxy</a></code> | <code>string</code> | Use the indicated proxy. |
| <code><a href="#@aws-cdk/cli-lib-alpha.SynthOptions.property.roleArn">roleArn</a></code> | <code>string</code> | Role to pass to CloudFormation for deployment. |
| <code><a href="#@aws-cdk/cli-lib-alpha.SynthOptions.property.stacks">stacks</a></code> | <code>string[]</code> | List of stacks to deploy. |
| <code><a href="#@aws-cdk/cli-lib-alpha.SynthOptions.property.staging">staging</a></code> | <code>boolean</code> | Copy assets to the output directory. |
| <code><a href="#@aws-cdk/cli-lib-alpha.SynthOptions.property.strict">strict</a></code> | <code>boolean</code> | Do not construct stacks with warnings. |
| <code><a href="#@aws-cdk/cli-lib-alpha.SynthOptions.property.trace">trace</a></code> | <code>boolean</code> | Print trace for stack warnings. |
| <code><a href="#@aws-cdk/cli-lib-alpha.SynthOptions.property.verbose">verbose</a></code> | <code>boolean</code> | show debug logs. |
| <code><a href="#@aws-cdk/cli-lib-alpha.SynthOptions.property.versionReporting">versionReporting</a></code> | <code>boolean</code> | Include "AWS::CDK::Metadata" resource in synthesized templates. |
| <code><a href="#@aws-cdk/cli-lib-alpha.SynthOptions.property.exclusively">exclusively</a></code> | <code>boolean</code> | Only synthesize the given stack. |
| <code><a href="#@aws-cdk/cli-lib-alpha.SynthOptions.property.quiet">quiet</a></code> | <code>boolean</code> | Do not output CloudFormation Template to stdout. |
| <code><a href="#@aws-cdk/cli-lib-alpha.SynthOptions.property.validation">validation</a></code> | <code>boolean</code> | After synthesis, validate stacks with the "validateOnSynth" attribute set (can also be controlled with CDK_VALIDATION). |

---

##### `assetMetadata`<sup>Optional</sup> <a name="assetMetadata" id="@aws-cdk/cli-lib-alpha.SynthOptions.property.assetMetadata"></a>

```typescript
public readonly assetMetadata: boolean;
```

- *Type:* boolean
- *Default:* true

Include "aws:asset:*" CloudFormation metadata for resources that use assets.

---

##### `caBundlePath`<sup>Optional</sup> <a name="caBundlePath" id="@aws-cdk/cli-lib-alpha.SynthOptions.property.caBundlePath"></a>

```typescript
public readonly caBundlePath: string;
```

- *Type:* string
- *Default:* read from AWS_CA_BUNDLE environment variable

Path to CA certificate to use when validating HTTPS requests.

---

##### `color`<sup>Optional</sup> <a name="color" id="@aws-cdk/cli-lib-alpha.SynthOptions.property.color"></a>

```typescript
public readonly color: boolean;
```

- *Type:* boolean
- *Default:* `true` unless the environment variable `NO_COLOR` is set

Show colors and other style from console output.

---

##### `context`<sup>Optional</sup> <a name="context" id="@aws-cdk/cli-lib-alpha.SynthOptions.property.context"></a>

```typescript
public readonly context: {[ key: string ]: string};
```

- *Type:* {[ key: string ]: string}
- *Default:* no additional context

Additional context.

---

##### `debug`<sup>Optional</sup> <a name="debug" id="@aws-cdk/cli-lib-alpha.SynthOptions.property.debug"></a>

```typescript
public readonly debug: boolean;
```

- *Type:* boolean
- *Default:* false

enable emission of additional debugging information, such as creation stack traces of tokens.

---

##### `ec2Creds`<sup>Optional</sup> <a name="ec2Creds" id="@aws-cdk/cli-lib-alpha.SynthOptions.property.ec2Creds"></a>

```typescript
public readonly ec2Creds: boolean;
```

- *Type:* boolean
- *Default:* guess EC2 instance status

Force trying to fetch EC2 instance credentials.

---

##### `ignoreErrors`<sup>Optional</sup> <a name="ignoreErrors" id="@aws-cdk/cli-lib-alpha.SynthOptions.property.ignoreErrors"></a>

```typescript
public readonly ignoreErrors: boolean;
```

- *Type:* boolean
- *Default:* false

Ignores synthesis errors, which will likely produce an invalid output.

---

##### `json`<sup>Optional</sup> <a name="json" id="@aws-cdk/cli-lib-alpha.SynthOptions.property.json"></a>

```typescript
public readonly json: boolean;
```

- *Type:* boolean
- *Default:* false

Use JSON output instead of YAML when templates are printed to STDOUT.

---

##### `lookups`<sup>Optional</sup> <a name="lookups" id="@aws-cdk/cli-lib-alpha.SynthOptions.property.lookups"></a>

```typescript
public readonly lookups: boolean;
```

- *Type:* boolean
- *Default:* true

Perform context lookups.

Synthesis fails if this is disabled and context lookups need
to be performed

---

##### `notices`<sup>Optional</sup> <a name="notices" id="@aws-cdk/cli-lib-alpha.SynthOptions.property.notices"></a>

```typescript
public readonly notices: boolean;
```

- *Type:* boolean
- *Default:* true

Show relevant notices.

---

##### `pathMetadata`<sup>Optional</sup> <a name="pathMetadata" id="@aws-cdk/cli-lib-alpha.SynthOptions.property.pathMetadata"></a>

```typescript
public readonly pathMetadata: boolean;
```

- *Type:* boolean
- *Default:* true

Include "aws:cdk:path" CloudFormation metadata for each resource.

---

##### `profile`<sup>Optional</sup> <a name="profile" id="@aws-cdk/cli-lib-alpha.SynthOptions.property.profile"></a>

```typescript
public readonly profile: string;
```

- *Type:* string
- *Default:* no profile is used

Use the indicated AWS profile as the default environment.

---

##### `proxy`<sup>Optional</sup> <a name="proxy" id="@aws-cdk/cli-lib-alpha.SynthOptions.property.proxy"></a>

```typescript
public readonly proxy: string;
```

- *Type:* string
- *Default:* no proxy

Use the indicated proxy.

Will read from
HTTPS_PROXY environment if specified

---

##### `roleArn`<sup>Optional</sup> <a name="roleArn" id="@aws-cdk/cli-lib-alpha.SynthOptions.property.roleArn"></a>

```typescript
public readonly roleArn: string;
```

- *Type:* string
- *Default:* use the bootstrap cfn-exec role

Role to pass to CloudFormation for deployment.

---

##### `stacks`<sup>Optional</sup> <a name="stacks" id="@aws-cdk/cli-lib-alpha.SynthOptions.property.stacks"></a>

```typescript
public readonly stacks: string[];
```

- *Type:* string[]
- *Default:* all stacks

List of stacks to deploy.

---

##### `staging`<sup>Optional</sup> <a name="staging" id="@aws-cdk/cli-lib-alpha.SynthOptions.property.staging"></a>

```typescript
public readonly staging: boolean;
```

- *Type:* boolean
- *Default:* false

Copy assets to the output directory.

Needed for local debugging the source files with SAM CLI

---

##### `strict`<sup>Optional</sup> <a name="strict" id="@aws-cdk/cli-lib-alpha.SynthOptions.property.strict"></a>

```typescript
public readonly strict: boolean;
```

- *Type:* boolean
- *Default:* false

Do not construct stacks with warnings.

---

##### `trace`<sup>Optional</sup> <a name="trace" id="@aws-cdk/cli-lib-alpha.SynthOptions.property.trace"></a>

```typescript
public readonly trace: boolean;
```

- *Type:* boolean
- *Default:* false

Print trace for stack warnings.

---

##### `verbose`<sup>Optional</sup> <a name="verbose" id="@aws-cdk/cli-lib-alpha.SynthOptions.property.verbose"></a>

```typescript
public readonly verbose: boolean;
```

- *Type:* boolean
- *Default:* false

show debug logs.

---

##### `versionReporting`<sup>Optional</sup> <a name="versionReporting" id="@aws-cdk/cli-lib-alpha.SynthOptions.property.versionReporting"></a>

```typescript
public readonly versionReporting: boolean;
```

- *Type:* boolean
- *Default:* true

Include "AWS::CDK::Metadata" resource in synthesized templates.

---

##### `exclusively`<sup>Optional</sup> <a name="exclusively" id="@aws-cdk/cli-lib-alpha.SynthOptions.property.exclusively"></a>

```typescript
public readonly exclusively: boolean;
```

- *Type:* boolean
- *Default:* false

Only synthesize the given stack.

---

##### `quiet`<sup>Optional</sup> <a name="quiet" id="@aws-cdk/cli-lib-alpha.SynthOptions.property.quiet"></a>

```typescript
public readonly quiet: boolean;
```

- *Type:* boolean
- *Default:* false;

Do not output CloudFormation Template to stdout.

---

##### `validation`<sup>Optional</sup> <a name="validation" id="@aws-cdk/cli-lib-alpha.SynthOptions.property.validation"></a>

```typescript
public readonly validation: boolean;
```

- *Type:* boolean
- *Default:* true;

After synthesis, validate stacks with the "validateOnSynth" attribute set (can also be controlled with CDK_VALIDATION).

---

## Classes <a name="Classes" id="Classes"></a>

### AwsCdkCli <a name="AwsCdkCli" id="@aws-cdk/cli-lib-alpha.AwsCdkCli"></a>

- *Implements:* <a href="#@aws-cdk/cli-lib-alpha.IAwsCdkCli">IAwsCdkCli</a>

Provides a programmatic interface for interacting with the AWS CDK CLI.

#### Methods <a name="Methods" id="Methods"></a>

| **Name** | **Description** |
| --- | --- |
| <code><a href="#@aws-cdk/cli-lib-alpha.AwsCdkCli.bootstrap">bootstrap</a></code> | cdk bootstrap. |
| <code><a href="#@aws-cdk/cli-lib-alpha.AwsCdkCli.deploy">deploy</a></code> | cdk deploy. |
| <code><a href="#@aws-cdk/cli-lib-alpha.AwsCdkCli.destroy">destroy</a></code> | cdk destroy. |
| <code><a href="#@aws-cdk/cli-lib-alpha.AwsCdkCli.list">list</a></code> | cdk list. |
| <code><a href="#@aws-cdk/cli-lib-alpha.AwsCdkCli.synth">synth</a></code> | cdk synth. |

---

##### `bootstrap` <a name="bootstrap" id="@aws-cdk/cli-lib-alpha.AwsCdkCli.bootstrap"></a>

```typescript
public bootstrap(options?: BootstrapOptions): void
```

cdk bootstrap.

###### `options`<sup>Optional</sup> <a name="options" id="@aws-cdk/cli-lib-alpha.AwsCdkCli.bootstrap.parameter.options"></a>

- *Type:* <a href="#@aws-cdk/cli-lib-alpha.BootstrapOptions">BootstrapOptions</a>

---

##### `deploy` <a name="deploy" id="@aws-cdk/cli-lib-alpha.AwsCdkCli.deploy"></a>

```typescript
public deploy(options?: DeployOptions): void
```

cdk deploy.

###### `options`<sup>Optional</sup> <a name="options" id="@aws-cdk/cli-lib-alpha.AwsCdkCli.deploy.parameter.options"></a>

- *Type:* <a href="#@aws-cdk/cli-lib-alpha.DeployOptions">DeployOptions</a>

---

##### `destroy` <a name="destroy" id="@aws-cdk/cli-lib-alpha.AwsCdkCli.destroy"></a>

```typescript
public destroy(options?: DestroyOptions): void
```

cdk destroy.

###### `options`<sup>Optional</sup> <a name="options" id="@aws-cdk/cli-lib-alpha.AwsCdkCli.destroy.parameter.options"></a>

- *Type:* <a href="#@aws-cdk/cli-lib-alpha.DestroyOptions">DestroyOptions</a>

---

##### `list` <a name="list" id="@aws-cdk/cli-lib-alpha.AwsCdkCli.list"></a>

```typescript
public list(options?: ListOptions): void
```

cdk list.

###### `options`<sup>Optional</sup> <a name="options" id="@aws-cdk/cli-lib-alpha.AwsCdkCli.list.parameter.options"></a>

- *Type:* <a href="#@aws-cdk/cli-lib-alpha.ListOptions">ListOptions</a>

---

##### `synth` <a name="synth" id="@aws-cdk/cli-lib-alpha.AwsCdkCli.synth"></a>

```typescript
public synth(options?: SynthOptions): void
```

cdk synth.

###### `options`<sup>Optional</sup> <a name="options" id="@aws-cdk/cli-lib-alpha.AwsCdkCli.synth.parameter.options"></a>

- *Type:* <a href="#@aws-cdk/cli-lib-alpha.SynthOptions">SynthOptions</a>

---

#### Static Functions <a name="Static Functions" id="Static Functions"></a>

| **Name** | **Description** |
| --- | --- |
| <code><a href="#@aws-cdk/cli-lib-alpha.AwsCdkCli.fromCdkAppDirectory">fromCdkAppDirectory</a></code> | Create the CLI from a directory containing an AWS CDK app. |
| <code><a href="#@aws-cdk/cli-lib-alpha.AwsCdkCli.fromCloudAssemblyDirectoryProducer">fromCloudAssemblyDirectoryProducer</a></code> | Create the CLI from a CloudAssemblyDirectoryProducer. |

---

##### `fromCdkAppDirectory` <a name="fromCdkAppDirectory" id="@aws-cdk/cli-lib-alpha.AwsCdkCli.fromCdkAppDirectory"></a>

```typescript
import { AwsCdkCli } from '@aws-cdk/cli-lib-alpha'

AwsCdkCli.fromCdkAppDirectory(directory?: string, props?: CdkAppDirectoryProps)
```

Create the CLI from a directory containing an AWS CDK app.

###### `directory`<sup>Optional</sup> <a name="directory" id="@aws-cdk/cli-lib-alpha.AwsCdkCli.fromCdkAppDirectory.parameter.directory"></a>

- *Type:* string

the directory of the AWS CDK app.

Defaults to the current working directory.

---

###### `props`<sup>Optional</sup> <a name="props" id="@aws-cdk/cli-lib-alpha.AwsCdkCli.fromCdkAppDirectory.parameter.props"></a>

- *Type:* <a href="#@aws-cdk/cli-lib-alpha.CdkAppDirectoryProps">CdkAppDirectoryProps</a>

additional configuration properties.

---

##### `fromCloudAssemblyDirectoryProducer` <a name="fromCloudAssemblyDirectoryProducer" id="@aws-cdk/cli-lib-alpha.AwsCdkCli.fromCloudAssemblyDirectoryProducer"></a>

```typescript
import { AwsCdkCli } from '@aws-cdk/cli-lib-alpha'

AwsCdkCli.fromCloudAssemblyDirectoryProducer(producer: ICloudAssemblyDirectoryProducer)
```

Create the CLI from a CloudAssemblyDirectoryProducer.

###### `producer`<sup>Required</sup> <a name="producer" id="@aws-cdk/cli-lib-alpha.AwsCdkCli.fromCloudAssemblyDirectoryProducer.parameter.producer"></a>

- *Type:* <a href="#@aws-cdk/cli-lib-alpha.ICloudAssemblyDirectoryProducer">ICloudAssemblyDirectoryProducer</a>

---



## Protocols <a name="Protocols" id="Protocols"></a>

### IAwsCdkCli <a name="IAwsCdkCli" id="@aws-cdk/cli-lib-alpha.IAwsCdkCli"></a>

- *Implemented By:* <a href="#@aws-cdk/cli-lib-alpha.AwsCdkCli">AwsCdkCli</a>, <a href="#@aws-cdk/cli-lib-alpha.IAwsCdkCli">IAwsCdkCli</a>

AWS CDK CLI operations.

#### Methods <a name="Methods" id="Methods"></a>

| **Name** | **Description** |
| --- | --- |
| <code><a href="#@aws-cdk/cli-lib-alpha.IAwsCdkCli.bootstrap">bootstrap</a></code> | cdk bootstrap. |
| <code><a href="#@aws-cdk/cli-lib-alpha.IAwsCdkCli.deploy">deploy</a></code> | cdk deploy. |
| <code><a href="#@aws-cdk/cli-lib-alpha.IAwsCdkCli.destroy">destroy</a></code> | cdk destroy. |
| <code><a href="#@aws-cdk/cli-lib-alpha.IAwsCdkCli.list">list</a></code> | cdk list. |
| <code><a href="#@aws-cdk/cli-lib-alpha.IAwsCdkCli.synth">synth</a></code> | cdk synth. |

---

##### `bootstrap` <a name="bootstrap" id="@aws-cdk/cli-lib-alpha.IAwsCdkCli.bootstrap"></a>

```typescript
public bootstrap(options?: BootstrapOptions): void
```

cdk bootstrap.

###### `options`<sup>Optional</sup> <a name="options" id="@aws-cdk/cli-lib-alpha.IAwsCdkCli.bootstrap.parameter.options"></a>

- *Type:* <a href="#@aws-cdk/cli-lib-alpha.BootstrapOptions">BootstrapOptions</a>

---

##### `deploy` <a name="deploy" id="@aws-cdk/cli-lib-alpha.IAwsCdkCli.deploy"></a>

```typescript
public deploy(options?: DeployOptions): void
```

cdk deploy.

###### `options`<sup>Optional</sup> <a name="options" id="@aws-cdk/cli-lib-alpha.IAwsCdkCli.deploy.parameter.options"></a>

- *Type:* <a href="#@aws-cdk/cli-lib-alpha.DeployOptions">DeployOptions</a>

---

##### `destroy` <a name="destroy" id="@aws-cdk/cli-lib-alpha.IAwsCdkCli.destroy"></a>

```typescript
public destroy(options?: DestroyOptions): void
```

cdk destroy.

###### `options`<sup>Optional</sup> <a name="options" id="@aws-cdk/cli-lib-alpha.IAwsCdkCli.destroy.parameter.options"></a>

- *Type:* <a href="#@aws-cdk/cli-lib-alpha.DestroyOptions">DestroyOptions</a>

---

##### `list` <a name="list" id="@aws-cdk/cli-lib-alpha.IAwsCdkCli.list"></a>

```typescript
public list(options?: ListOptions): void
```

cdk list.

###### `options`<sup>Optional</sup> <a name="options" id="@aws-cdk/cli-lib-alpha.IAwsCdkCli.list.parameter.options"></a>

- *Type:* <a href="#@aws-cdk/cli-lib-alpha.ListOptions">ListOptions</a>

---

##### `synth` <a name="synth" id="@aws-cdk/cli-lib-alpha.IAwsCdkCli.synth"></a>

```typescript
public synth(options?: SynthOptions): void
```

cdk synth.

###### `options`<sup>Optional</sup> <a name="options" id="@aws-cdk/cli-lib-alpha.IAwsCdkCli.synth.parameter.options"></a>

- *Type:* <a href="#@aws-cdk/cli-lib-alpha.SynthOptions">SynthOptions</a>

---


### ICloudAssemblyDirectoryProducer <a name="ICloudAssemblyDirectoryProducer" id="@aws-cdk/cli-lib-alpha.ICloudAssemblyDirectoryProducer"></a>

- *Implemented By:* <a href="#@aws-cdk/cli-lib-alpha.ICloudAssemblyDirectoryProducer">ICloudAssemblyDirectoryProducer</a>

A class returning the path to a Cloud Assembly Directory when its `produce` method is invoked with the current context  AWS CDK apps might need to be synthesized multiple times with additional context values before they are ready.

When running the CLI from inside a directory, this is implemented by invoking the app multiple times.
Here the `produce()` method provides this multi-pass ability.

#### Methods <a name="Methods" id="Methods"></a>

| **Name** | **Description** |
| --- | --- |
| <code><a href="#@aws-cdk/cli-lib-alpha.ICloudAssemblyDirectoryProducer.produce">produce</a></code> | Synthesize a Cloud Assembly directory for a given context. |

---

##### `produce` <a name="produce" id="@aws-cdk/cli-lib-alpha.ICloudAssemblyDirectoryProducer.produce"></a>

```typescript
public produce(context: {[ key: string ]: any}): string
```

Synthesize a Cloud Assembly directory for a given context.

For all features to work correctly, `cdk.App()` must be instantiated with the received context values in the method body.
Usually obtained similar to this:
```ts fixture=imports
class MyProducer implements ICloudAssemblyDirectoryProducer {
  async produce(context: Record<string, any>) {
    const app = new cdk.App({ context });
    // create stacks here
    return app.synth().directory;
  }
}
```

###### `context`<sup>Required</sup> <a name="context" id="@aws-cdk/cli-lib-alpha.ICloudAssemblyDirectoryProducer.produce.parameter.context"></a>

- *Type:* {[ key: string ]: any}

---

#### Properties <a name="Properties" id="Properties"></a>

| **Name** | **Type** | **Description** |
| --- | --- | --- |
| <code><a href="#@aws-cdk/cli-lib-alpha.ICloudAssemblyDirectoryProducer.property.workingDirectory">workingDirectory</a></code> | <code>string</code> | The working directory used to run the Cloud Assembly from. |

---

##### `workingDirectory`<sup>Optional</sup> <a name="workingDirectory" id="@aws-cdk/cli-lib-alpha.ICloudAssemblyDirectoryProducer.property.workingDirectory"></a>

```typescript
public readonly workingDirectory: string;
```

- *Type:* string
- *Default:* current working directory

The working directory used to run the Cloud Assembly from.

This is were a `cdk.context.json` files will be written.

---

## Enums <a name="Enums" id="Enums"></a>

### HotswapMode <a name="HotswapMode" id="@aws-cdk/cli-lib-alpha.HotswapMode"></a>

#### Members <a name="Members" id="Members"></a>

| **Name** | **Description** |
| --- | --- |
| <code><a href="#@aws-cdk/cli-lib-alpha.HotswapMode.FALL_BACK">FALL_BACK</a></code> | Will fall back to CloudFormation when a non-hotswappable change is detected. |
| <code><a href="#@aws-cdk/cli-lib-alpha.HotswapMode.HOTSWAP_ONLY">HOTSWAP_ONLY</a></code> | Will not fall back to CloudFormation when a non-hotswappable change is detected. |
| <code><a href="#@aws-cdk/cli-lib-alpha.HotswapMode.FULL_DEPLOYMENT">FULL_DEPLOYMENT</a></code> | Will not attempt to hotswap anything and instead go straight to CloudFormation. |

---

##### `FALL_BACK` <a name="FALL_BACK" id="@aws-cdk/cli-lib-alpha.HotswapMode.FALL_BACK"></a>

Will fall back to CloudFormation when a non-hotswappable change is detected.

---


##### `HOTSWAP_ONLY` <a name="HOTSWAP_ONLY" id="@aws-cdk/cli-lib-alpha.HotswapMode.HOTSWAP_ONLY"></a>

Will not fall back to CloudFormation when a non-hotswappable change is detected.

---


##### `FULL_DEPLOYMENT` <a name="FULL_DEPLOYMENT" id="@aws-cdk/cli-lib-alpha.HotswapMode.FULL_DEPLOYMENT"></a>

Will not attempt to hotswap anything and instead go straight to CloudFormation.

---


### RequireApproval <a name="RequireApproval" id="@aws-cdk/cli-lib-alpha.RequireApproval"></a>

In what scenarios should the CLI ask for approval.

#### Members <a name="Members" id="Members"></a>

| **Name** | **Description** |
| --- | --- |
| <code><a href="#@aws-cdk/cli-lib-alpha.RequireApproval.NEVER">NEVER</a></code> | Never ask for approval. |
| <code><a href="#@aws-cdk/cli-lib-alpha.RequireApproval.ANYCHANGE">ANYCHANGE</a></code> | Prompt for approval for any type  of change to the stack. |
| <code><a href="#@aws-cdk/cli-lib-alpha.RequireApproval.BROADENING">BROADENING</a></code> | Only prompt for approval if there are security related changes. |

---

##### `NEVER` <a name="NEVER" id="@aws-cdk/cli-lib-alpha.RequireApproval.NEVER"></a>

Never ask for approval.

---


##### `ANYCHANGE` <a name="ANYCHANGE" id="@aws-cdk/cli-lib-alpha.RequireApproval.ANYCHANGE"></a>

Prompt for approval for any type  of change to the stack.

---


##### `BROADENING` <a name="BROADENING" id="@aws-cdk/cli-lib-alpha.RequireApproval.BROADENING"></a>

Only prompt for approval if there are security related changes.

---


### StackActivityProgress <a name="StackActivityProgress" id="@aws-cdk/cli-lib-alpha.StackActivityProgress"></a>

Supported display modes for stack deployment activity.

#### Members <a name="Members" id="Members"></a>

| **Name** | **Description** |
| --- | --- |
| <code><a href="#@aws-cdk/cli-lib-alpha.StackActivityProgress.BAR">BAR</a></code> | Displays a progress bar with only the events for the resource currently being deployed. |
| <code><a href="#@aws-cdk/cli-lib-alpha.StackActivityProgress.EVENTS">EVENTS</a></code> | Displays complete history with all CloudFormation stack events. |

---

##### `BAR` <a name="BAR" id="@aws-cdk/cli-lib-alpha.StackActivityProgress.BAR"></a>

Displays a progress bar with only the events for the resource currently being deployed.

---


##### `EVENTS` <a name="EVENTS" id="@aws-cdk/cli-lib-alpha.StackActivityProgress.EVENTS"></a>

Displays complete history with all CloudFormation stack events.

---

