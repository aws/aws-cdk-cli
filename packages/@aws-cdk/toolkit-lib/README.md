# AWS CDK Toolkit Library

The AWS Cloud Development Kit (AWS CDK) Toolkit Library enables you to perform CDK actions requiring programmatic access on AWS. You can use the AWS CDK Toolkit Library to implement actions such as bootstrapping, synthesizing, and deploying through code rather than command-line interface (CLI) commands. With this library, you can create custom tools, build specialized CLI applications, and integrate CDK programmatic access capabilities into your development workflows.

## Get started with the AWS CDK Toolkit Library

### Step 1: Install the CDK Toolkit Library

Add the `@aws-cdk/toolkit-lib` package to your code base:

```console
npm install --save @aws-cdk/toolkit-lib
```

### Step 2: Create and configure a new instance of the CDK Toolkit

You will use the CDK Toolkit instance to define the actions to perform on your CDK app.
The following is an example of creating a new instance of the CDK Toolkit:

```ts
import { Toolkit } from '@aws-cdk/toolkit-lib';

const cdk = new Toolkit({
   // Optional configuration options go here
});
```

You can optionally customize the CDK Toolkit instance during creation.
For instructions, see [Configure your CDK Toolkit instance](#configure-your-cdk-toolkit-instance).

### Step 3: Create a cloud assembly source for your CDK app

A _Cloud Assembly_ represents the AWS CloudFormation templates and deployment artifacts that are produced from a CDK app.
With the CDK, the Cloud Assembly is generated during synthesis and is what gets deployed to provision your infrastructure.
The CDK Toolkit creates a _Cloud Assembly_ from a _Cloud Assembly Source_.

The _Cloud Assembly Source_ is a fundamental CDK Toolkit component that defines instructions for creating a _Cloud Assembly_ from your app.
For example, CDK apps may need to be synthesized multiple times with additional context values before they are ready.
Once created, you can use your _Cloud Assembly Source_ to perform actions  with the CDK Toolkit.

The following is an example of creating a _Cloud Assembly Source_ using the _assembly builder function_:

```ts
import * as core from 'aws-cdk-lib/core';

declare const cdk: Toolkit;

const cx = await cdk.fromAssemblyBuilder(async () => {
  const app = new core.App();

  // Define your stacks here
  new MyStack(app, 'MyStack');

  return app.synth();
});
```

For more details, see [Cloud Assembly Sources](#cloud-assembly-sources).

### Step 4: Define programmatic actions in for your CDK app

Now that you’ve created a CDK Toolkit instance and Cloud Assembly Source, you can start to define programmatic actions.
The following is a basic example that creates a deployment of the `MyStack` stack:

```ts
declare const cdk: Toolkit;
declare const cx: ICloudAssemblySource;

await cdk.deploy(cx, {
  stacks: {
    strategy: StackSelectionStrategy.PATTERN_MUST_MATCH,
    patterns: ["MyStack"],
  },
});
```

### Step 5: Customize the CDK Toolkit further

You can configure and customize the CDK Toolkit further for your needs:

* **Messages and requests** - The CDK Toolkit outputs a structured flow of messages and requests back to the client, such as a human actor or application using the CDK Toolkit. For instructions, see [Messages & interaction](#messages--interaction).
* **Error handling** - The CDK Toolkit uses structured errors to help you identify and handle issues during Toolkit operations. You can integrate error handling into your app or customize them further for your needs. For instructions, see [Error handling](#error-handling).

## Actions

The CDK Toolkit Library provides programmatic interfaces for the following lifecycle actions.
Support for further actions will be extended over time.

### synth

Synthesis is the process of producing AWS CloudFormation templates and deployment artifacts from a CDK app.
For an introduction to synthesis, see [Configure and perform CDK stack synthesis](https://docs.aws.amazon.com/cdk/v2/guide/configure-synth.html).
In the CDK Toolkit Library, you can use synth to produce a reusable snapshot of a _Cloud Assembly Source_.
This is useful if the same source will be used with multiple Toolkit actions,
because the _Cloud Assembly_ does not have to be produced multiple times.

```ts
declare const cdk: Toolkit;
declare const source: ICloudAssemblySource;

// Will run the CDK app defined in the Cloud Assembly Source
// This is an expensive and slow operation
// But its result can be stored and re-used
const cx = await cdk.synth(source, {
  validateStacks: true, // set to `false` to not throw an error if stacks in the assembly contain error annotations
})

// Will use the previously synthesized Cloud Assembly
// This is now a cheap and fast operation
const appDetails = await cdk.list(cx);
```

You can also query information about the synthesized _Cloud Assembly_:

```ts
const cloudAssembly = await cx.produce();
const template = cloudAssembly.getStackByName("my-stack").template;
```

### list

The list operation provides high-level information about the stacks and their dependencies within a CDK application.

```ts
declare const cdk: Toolkit;
declare const cx: ICloudAssemblySource;

const details = await cdk.list(cx, {
  // optionally provide a stack selector to control which stacks are returned
  stacks: {
    strategy: StackSelectionStrategy.PATTERN_MUST_MATCH,
    patterns: ["my-stack"],
  }
});
```

### diff

You can create a diff of your app to gain detailed insights into what will be changing in the next deployment.

```ts
declare const cdk: Toolkit;
declare const cx: ICloudAssemblySource;

const stackDiffs = await cdk.diff(cx, {
  // optionally provide a stack selector to control which stacks you want to create a diff for
  stacks: {
    strategy: StackSelectionStrategy.PATTERN_MUST_MATCH,
    patterns: ["my-stack"],
  }
});
```

### deploy

Deployment is the process of provisioning or updating your infrastructure in AWS using the CloudFormation templates and assets produced during synthesis.
For an introduction to deploying, see [Deploy AWS CDK applications](https://docs.aws.amazon.com/cdk/v2/guide/deploy.html).
With the CDK Toolkit Library, you can programmatically control deployments, including stack selection, rollback behavior, and deployment monitoring.

```ts
declare const cdk: Toolkit;
declare const cx: ICloudAssemblySource;

await cdk.deploy(cx, {
  deploymentMethod: { method: "direct " }, // use direct deployments instead of change-sets
  parameters: StackParameters.exactly({ /* ... */ }), // provide new values for stack parameters
})
```

### rollback

Rollback returns a stack to its last stable state when a deployment fails or needs to be reversed.
The CDK Toolkit Library allows you to programmatically roll back failed deployments.

```ts
declare const cdk: Toolkit;
declare const cx: ICloudAssemblySource;

await cdk.rollback(cx, {
  orphanFailedResources: false, // set to `true` to automatically orphan all failed resources
})
```

### watch

Use the watch feature to continuously monitor your CDK app for local changes and automatically perform deployments or hotswaps.
This will create a file watcher that is terminated once your code exits.

```ts
declare const cdk: Toolkit;
declare const cx: ICloudAssemblySource;

await cdk.watch(cx, {
  include: [], // optionally provide a list of file path patterns to watch
  exclude: [], // or exclude files by file path patterns
})
```

### drift

Drift detection is crucial for maintaining infrastructure reliability.
It identifies when your deployed resources have been modified outside of your CDK code.
This allows you to quickly address unauthorized changes.
Such changes could lead to security vulnerabilities, compliance issues, or unexpected behavior in your cloud environment.

Use the drift operation to detect such drift in your CDK applications:

```ts
declare const cdk: Toolkit;
declare const cx: ICloudAssemblySource;

const stackDrifts = await cdk.drift(cx, {
  // optionally provide a stack selector to control which stacks are checked for drift
  stacks: {
    strategy: StackSelectionStrategy.PATTERN_MUST_MATCH,
    patterns: ["my-stack"],
  }
});
```

### destroy

Use the destroy feature to remove CDK stacks and their associated resources from AWS:

```ts
declare const cdk: Toolkit;
declare const cx: ICloudAssemblySource;

await cdk.destroy(cx, {
  // optionally provide a stack selector to control which stacks are destroyed
  stacks: {
    strategy: StackSelectionStrategy.PATTERN_MUST_MATCH,
    patterns: ["my-stack"],
  }
})
```

## Configure your CDK Toolkit instance

### Messages & interaction

The CDK Toolkit outputs a structured flow of _messages_ and _requests_ back to a client integrating with the Toolkit.

* **Messages** - Informs the client about the progress and state of operations. Does not require a response.
* **Requests** - Special messages that allow the client to respond. If no response is given, the Toolkit will use a default response.

The CDK Toolkit Library outputs messages and requests through an `IoHost`.
Think of the `IoHost` as the blueprint that defines how communication works for the CDK Toolkit.
For each message or request, the Toolkit calls either the `notify` or `requestResponse` method of the `IoHost`.

#### Customizing the IoHost

You can configure a custom `IoHost` to control the flow of information and integrate them into your workflows and automation.
The following is an example implementation that simply logs all message objects to stdout:

```ts
const toolkit = new toolkitLib.Toolkit({
  ioHost: {
    notify: async function (msg) {
      console.log(msg);
    },
    requestResponse: async function (msg) {
      console.log(msg);
      return msg.defaultResponse;
    }
  }
})
```

The CDK Toolkit awaits the completion of each call, allowing clients to perform asynchronous operations like HTTP requests when handling messages or requests.
When you implement an `IoHost` interface, you can either process these communications (for example, logging to CloudWatch or prompting users for input) or return immediately without taking action.
If your implementation doesn’t provide a response to a request, the CDK Toolkit proceeds with a default value.

#### Default `NonInteractiveIoHost`

By default the CDK Toolkit Library will use a `NonInteractiveIoHost ` implementation that mimics the behavior of the AWS CDK Toolkit CLI.
This `NonInteractiveIoHost` is available for you as a base implementation to extend on.

### Configure your AWS profile

The Toolkit internally uses AWS SDK Clients to make necessary API calls to AWS.
Authentication configuration is loaded automatically from the environment, but you can explicitly specify the base credentials to be used:

```ts
import { Toolkit, BaseCredentials } from '@aws-cdk/toolkit-lib';

const cdk = new Toolkit({
  sdkConfig: { 
    baseCredentials: BaseCredentials.awsCliCompatible({ profile: "my-profile" })
  },
});
```

### Configure a proxy for SDK calls

The Toolkit internally uses AWS SDK Clients to make necessary API calls to AWS.
You can specify a Node.js Agent to configure SDK calls.
This allows you to configure third-party packages like [`proxy-agent`](https://www.npmjs.com/package/proxy-agent) to proxy all SDK calls:

```ts
import { ProxyAgent } from 'proxy-agent';
import { Toolkit } from '@aws-cdk/toolkit-lib';

const cdk = new Toolkit({
  sdkConfig: {
    httpOptions: {
      agent: new ProxyAgent(),
    },
  },
});
```

## Configure Toolkit Actions

Every action the CDK Toolkit Library provides has its own options.
However some arguments and options are shared between multiple actions.

## Cloud Assembly Sources

The _Cloud Assembly Source_ is a fundamental CDK Toolkit component that defines instructions for creating a _Cloud Assembly_ from your app.
For example, CDK apps may need to be synthesized multiple times with additional context values before they are ready.
Once created, you can use your _Cloud Assembly Source_ to perform actions  with the CDK Toolkit.

Every _Cloud Assembly Source_ must implement the `ICloudAssemblySource` interface. This allows you to define your own custom sources.

```ts
interface ICloudAssemblySource {
  produce(): Promise<cxapi.CloudAssembly>;
}
```

For convenience the CDK Toolkit Library offers a range of standard sources, which can be instantiated using the `fromXyz()` helper methods on your toolkit instance.

Most existing CDK apps are written as JavaScript apps or in a jsii language.
With the CDK Toolkit Library you can use these CDK apps by providing the `app` string as found in a `cdk.json` file:

```ts
declare const cdk: Toolkit;

// TypeScript
await cdk.fromCdkApp("ts-node app.ts");

// Python
await cdk.fromCdkApp("python app.py");
```

The `AssemblyBuilder` function provides basic Toolkit features like Lookups, but otherwise allows you to implement any custom source.
For example you build an inline CDK app on-the-fly:

```ts
declare const cdk: Toolkit;

const cx = await cdk.fromAssemblyBuilder(async () => {
  const app = new core.App();

  // Define your stacks here
  new MyStack(app, 'MyStack');

  return app.synth();
});
```

> Note that synthesis using the `AssemblyBuilder` is not safe to be performed
> concurrently, since it mutates the globally shared `process.env`. You can set
> `clobberEnv: false` to avoid this, but your builder function will need to do a
> bit more work. See the documentation of `clobberEnv` for an example.

Existing _Cloud Assembly_ directories can be used as source like this:

```ts
declare const cdk: Toolkit;

const cx = await cdk.fromAssemblyDirectory("cdk.out");
```

## Stack selection

Most actions of the CDK Toolkit take a `StackSelector` to configure with stacks should be used for the action.
A `StackSelector` and some optional additional values.

To select all stacks use the `ALL_STACKS` strategy:

```ts
const allStacks = { strategy: StackSelectionStrategy.ALL_STACKS };
```

To select only the top-level stacks from the main assembly, use the `MAIN_ASSEMBLY` strategy:

```ts
const mainStacks = { strategy: StackSelectionStrategy.MAIN_ASSEMBLY };
```

The `ONLY_SINGLE` strategy allows you to ensure a given assembly contains exactly one stack, and select it:

```ts
const mainStacks = { strategy: StackSelectionStrategy.ONLY_SINGLE };
```

To select stacks by IDs, use `PATTERN_MUST_MATCH` with an additional `patterns` property.
If no stacks are matched, this strategy will throw an error.

```ts
const matchStacks = {
  strategy: StackSelectionStrategy.PATTERN_MUST_MATCH,
  patterns: ["MyStack"],
};
```

You can optionally declare that the provided patterns must match exactly one stack by using `PATTERN_MUST_MATCH_SINGLE`,
or can match none at all by using `PATTERN_MATCH`.

## Error handling

The CDK Toolkit uses structured errors to help you identify and handle issues during CDK Toolkit operations.
These errors provide detailed information about what went wrong and why.

Each error includes one of the following sources, which represents where the error originates from:

* toolkit - Error originates from the CDK Toolkit.
* user - Error originates from the user, such as configuration or user input errors.

Each error also includes a specific error type, such as authentication or validation, and a descriptive message. You can catch and handle these errors in your application to provide appropriate responses or fallback behaviors. If the CDK Toolkit throws other exceptions, they are bugs and you should report them by raising an issue.s

### How to handle errors

In the CDK Toolkit Library, all errors are thrown as regular exceptions.

Use helper methods provided by the CDK Toolkit to detect error types.
Even though errors are typed, do not rely on instanceof checks because they can behave unexpectedly when working with multiple copies of the same package.

The following is a basic example:

```ts
declare const cdk: Toolkit;
declare const cx: ICloudAssemblySource;

try {
  // Attempt a CDK Toolkit operation
  const deployment = await cdk.deploy(cx, {
    stacks: ['MyStack']
  });

} catch (error) {
  // Handle user error
  if (ToolkitError.isToolkitError(error) && error.source === 'user') {
    console.error('Hey, something is wrong with your app!', error.message);
  } else {
    throw error;
  }
}
```
