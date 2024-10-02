# Moving instructions

We're moving house! Pack your stuff into boxes and unpack it in the new place.

## Setup

Create a directory with the following repos in it:

```
aws-cdk                  git@github.com:aws/aws-cdk.git
aws-cdk-cli              git@github.com:aws/aws-cdk-cli.git
aws-cdk-cli-testing      git@github.com:aws/aws-cdk-cli-testing.git
cdk-assets               git@github.com:cdklabs/cdk-assets.git
cloud-assembly-schema    git@github.com:cdklabs/cloud-assembly-schema.git
```

In `aws-cdk-cli`, run the following command:

```
aws-cdk-cli$ ./move.sh && npx projen && yarn build

# or
aws-cdk-cli$ ./move.sh --quick && npx projen && yarn build
```

To iterate, you must fix any build problems in the upstream repositories (submit a PR etc,
but you can test from your local branch), then re-run the command to retry the build:

```
aws-cdk-cli$ ./move.sh --quick && npx projen && yarn build
```
