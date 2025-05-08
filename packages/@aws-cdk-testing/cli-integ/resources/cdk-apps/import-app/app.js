const cdk = require('aws-cdk-lib/core');
const dynamodb = require('aws-cdk-lib/aws-dynamodb');

const stackPrefix = process.env.STACK_NAME_PREFIX;
if (!stackPrefix) {
  throw new Error(`the STACK_NAME_PREFIX environment variable is required`);
}

class BaseStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    // Create a random table name with prefix
    if (process.env.VERSION == 'v2') {
      new dynamodb.TableV2(this, 'MyGlobalTable', {
        partitionKey: {
          name: 'PK',
          type: dynamodb.AttributeType.STRING,
        },
        tableName: 'integ-test-import-app-base-table-1',
      });
    } else {
      new dynamodb.Table(this, 'MyTable', {
        partitionKey: {
          name: 'PK',
          type: dynamodb.AttributeType.STRING,
        },
        tableName: 'integ-test-import-app-base-table-1',
        removalPolicy: process.env.VERSION == 'v1' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      });
    }
  }
}

const app = new cdk.App();
new BaseStack(app, `${stackPrefix}-base-1`);

app.synth();
