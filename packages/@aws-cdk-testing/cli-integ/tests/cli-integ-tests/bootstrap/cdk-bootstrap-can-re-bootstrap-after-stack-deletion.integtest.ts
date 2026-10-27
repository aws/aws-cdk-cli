import { integTest, withoutBootstrap } from '../../../lib';

integTest('bootstrap can re-bootstrap after stack deletion', withoutBootstrap(async (fixture) => {
  const bootstrapStackName = fixture.bootstrapStackName;

  // Bootstrap the environment
  await fixture.cdkBootstrapModern({
    toolkitStackName: bootstrapStackName,
    cfnExecutionPolicy: 'arn:aws:iam::aws:policy/AdministratorAccess',
  });

  // Delete the bootstrap stack (resources like the S3 bucket will be retained)
  await fixture.aws.deleteStacks(bootstrapStackName);

  // Re-bootstrap should succeed because importExistingResources is enabled,
  // allowing the change set to import the retained resources back into the stack.
  await fixture.cdkBootstrapModern({
    toolkitStackName: bootstrapStackName,
    cfnExecutionPolicy: 'arn:aws:iam::aws:policy/AdministratorAccess',
  });
}));
