# Welcome to your CDK TypeScript project

This is a blank project for CDK development with TypeScript.

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Run the app with Nub

Install the pinned Nub runner without changing the project's package manager:

```console
npm install --save-dev --save-exact @nubjs/nub@0.8.3
```

Then replace the `tsx` portion of the `app` command in `cdk.json`. Keep the type-check step:

```json
{
  "app": "npx tsc && npx nub bin/my-project.ts"
}
```

This changes only how the CDK app runs. Lambda bundling and dependency installation remain unchanged.

## Useful commands

* `%pm-cmd% build`   type-check the project
* `%pm-cmd% watch`   watch for changes and type-check
* `%pm-cmd% test`    perform the jest unit tests
* `npx cdk deploy`  deploy this stack to your default AWS account/region
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk synth`   emits the synthesized CloudFormation template
