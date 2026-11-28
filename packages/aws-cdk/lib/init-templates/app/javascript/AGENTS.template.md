# AGENTS.md

This is an AWS CDK app written in JavaScript. The app entry point is the file in
`bin/` that creates the `App`; the stack is defined in `lib/` (the `*-stack.js`
file). `cdk.json` tells the CDK Toolkit how to run the app.

## Read the construct library docs before writing code

AWS CDK service documentation ships inside the aws-cdk-lib package. After you
install dependencies with `npm install` (so `node_modules/aws-cdk-lib` exists)
and before you write your CDK constructs, find the service READMEs once:

```
find node_modules/aws-cdk-lib -name README.md
```

For each AWS service you use in this app, read that service's module README (for
example, `node_modules/aws-cdk-lib/aws-s3/README.md`) first and follow its
documented construct usage and patterns. Not every service has a README; a
missing one is not an error. Read the relevant READMEs before writing the
constructs for each service.

Before reading a service README, list its section headings with
`grep -n '^#' node_modules/aws-cdk-lib/<module>/README.md`, then read only the
sections for the constructs you use, for example with
`sed -n '<start>,<end>p' node_modules/aws-cdk-lib/<module>/README.md`. Do not
read a whole README into context or re-read a section you have already read.

## Check your work

- `%pm-cmd% test` — run the jest unit tests. A build step is not needed for JavaScript.
- `npx cdk synth` — synthesize the CloudFormation template.
- `npx cdk diff` — compare against the deployed stack.
- `npx cdk deploy` changes a real AWS account. Ask the user first.

## More resources

- [AWS CDK Reference](https://docs.aws.amazon.com/cdk/api/)
