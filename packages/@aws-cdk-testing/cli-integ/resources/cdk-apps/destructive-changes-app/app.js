const cdk = require('aws-cdk-lib/core');
const sqs = require('aws-cdk-lib/aws-sqs');

const stackPrefix = process.env.STACK_NAME_PREFIX;
if (!stackPrefix) {
  throw new Error(`the STACK_NAME_PREFIX environment variable is required`);
}

/**
 * Used to test `cdk diff --fail-on=destructive`.
 *
 * Environment variables switch each queue between a change that is applied in place,
 * a change that replaces the resource, and removing the resource.
 */
class DestructiveChangesStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);
    // Mutable property: changing it updates the queue in place
    const visibilityTimeout = process.env.DESTRUCTIVE_CHANGES_VISIBILITY_TIMEOUT;
    new sqs.Queue(this, 'UpdatedQueue', {
      visibilityTimeout: visibilityTimeout ? cdk.Duration.seconds(Number(visibilityTimeout)) : undefined,
    });
    // Immutable property: setting it replaces the queue
    new sqs.Queue(this, 'ReplacedQueue', {
      queueName: process.env.DESTRUCTIVE_CHANGES_QUEUE_NAME,
    });
    if (process.env.DESTRUCTIVE_CHANGES_REMOVE_QUEUE !== 'true') {
      new sqs.Queue(this, 'RemovedQueue');
    }
  }
}

const app = new cdk.App();
new DestructiveChangesStack(app, `${stackPrefix}-destructive-changes`);

app.synth();
