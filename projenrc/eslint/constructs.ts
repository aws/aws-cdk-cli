// CDK Construct rules
export default {
  '@cdklabs/no-core-construct': ['error'], // Forbid the use of Construct and IConstruct from the "@aws-cdk/core" module.
  '@cdklabs/invalid-cfn-imports': ['error'], // Ensures that imports of Cfn<Resource> L1 resources come from the stable aws-cdk-lib package and not the alpha packages
  '@cdklabs/no-literal-partition': ['error'], //  Forbids the use of literal partitions (usually aws)
};
