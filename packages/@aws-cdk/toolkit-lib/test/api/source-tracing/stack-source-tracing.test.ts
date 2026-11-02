import * as fs from 'fs';
import * as path from 'path';
import { ArtifactMetadataEntryType } from '@aws-cdk/cloud-assembly-schema';
import { StackArtifactSourceTracer } from '../../../lib/api/source-tracing/private/stack-source-tracing';
import { testStack } from '../../_helpers/assembly';

describe('StackArtifactSourceTracer', () => {
  describe('traceResource', () => {
    test('finds construct path from template metadata', async () => {
      const stack = testStack({
        stackName: 'MyStack',
        template: {
          Resources: {
            MyBucketD5B70704: {
              Type: 'AWS::S3::Bucket',
              Metadata: {
                'aws:cdk:path': 'MyStack/MyBucket/Resource',
              },
            },
          },
        },
      });

      const tracer = new StackArtifactSourceTracer(stack);
      const result = await tracer.traceResource('arn:stack', [], 'MyBucketD5B70704');

      expect(result).toMatchObject({ constructPath: 'MyStack/MyBucket/Resource' });
    });

    test('finds creation stack trace from artifact metadata', async () => {
      const stack = testStack({
        stackName: 'MyStack',
        template: {
          Resources: {
            MyBucketD5B70704: {
              Type: 'AWS::S3::Bucket',
              Metadata: {
                'aws:cdk:path': 'MyStack/MyBucket/Resource',
              },
            },
          },
        },
        metadata: {
          '/MyStack/MyBucket/Resource': [
            {
              type: ArtifactMetadataEntryType.LOGICAL_ID,
              data: 'MyBucketD5B70704',
              trace: ['at new Bucket (lib/bucket.ts:42)', 'at new MyStack (lib/stack.ts:10)'],
            },
          ],
        },
      });

      const tracer = new StackArtifactSourceTracer(stack);
      const result = await tracer.traceResource('arn:stack', [], 'MyBucketD5B70704');

      expect(result).toMatchObject({
        creationStackTrace: [
          'at new Bucket (lib/bucket.ts:42)',
          'at new MyStack (lib/stack.ts:10)',
        ],
      });
    });

    test('finds creation stack trace from aws:cdk:creationStack metadata', async () => {
      const stack = testStack({
        stackName: 'MyStack',
        template: {
          Resources: {
            MyBucketD5B70704: {
              Type: 'AWS::S3::Bucket',
              Metadata: {
                'aws:cdk:path': 'MyStack/MyBucket/Resource',
              },
            },
          },
        },
        metadata: {
          '/MyStack/MyBucket/Resource': [
            {
              type: 'aws:cdk:creationStack',
              data: ['at new Bucket (lib/bucket.ts:99)', 'at new MyStack (lib/stack.ts:5)'],
            },
          ],
        },
      });

      const tracer = new StackArtifactSourceTracer(stack);
      const result = await tracer.traceResource('arn:stack', [], 'MyBucketD5B70704');

      expect(result).toMatchObject({
        creationStackTrace: [
          'at new Bucket (lib/bucket.ts:99)',
          'at new MyStack (lib/stack.ts:5)',
        ],
      });
    });

    test('returns undefined when resource has no metadata', async () => {
      const stack = testStack({
        stackName: 'MyStack',
        template: {
          Resources: {
            MyBucketD5B70704: {
              Type: 'AWS::S3::Bucket',
            },
          },
        },
      });

      const tracer = new StackArtifactSourceTracer(stack);
      const result = await tracer.traceResource('arn:stack', [], 'MyBucketD5B70704');

      expect(result).toBeUndefined();
    });

    test('returns undefined for non-existent logical ID', async () => {
      const stack = testStack({
        stackName: 'MyStack',
        template: {
          Resources: {
            MyBucketD5B70704: {
              Type: 'AWS::S3::Bucket',
              Metadata: { 'aws:cdk:path': 'MyStack/MyBucket/Resource' },
            },
          },
        },
      });

      const tracer = new StackArtifactSourceTracer(stack);
      const result = await tracer.traceResource('arn:stack', [], 'NonExistent');

      expect(result).toBeUndefined();
    });

    test('traces into nested stacks', async () => {
      const nestedTemplate = {
        Resources: {
          InnerBucket: {
            Type: 'AWS::S3::Bucket',
            Metadata: {
              'aws:cdk:path': 'MyStack/NestedStack/InnerBucket/Resource',
            },
          },
        },
      };

      const stack = testStack({
        stackName: 'MyStack',
        template: {
          Resources: {
            NestedStackResource: {
              Type: 'AWS::CloudFormation::Stack',
              Metadata: {
                'aws:asset:path': 'nested-template.json',
                'aws:cdk:path': 'MyStack/NestedStack.NestedStackResource',
              },
            },
          },
        },
      });

      // Write the nested template to the assembly output directory
      const nestedTemplatePath = path.join(path.dirname(stack.templateFullPath), 'nested-template.json');
      fs.writeFileSync(nestedTemplatePath, JSON.stringify(nestedTemplate));

      const tracer = new StackArtifactSourceTracer(stack);
      const result = await tracer.traceResource('arn:nested-stack', ['NestedStackResource'], 'InnerBucket');

      expect(result).toMatchObject({ constructPath: 'MyStack/NestedStack/InnerBucket/Resource' });
    });

    test('returns undefined when nested stack template cannot be found', async () => {
      const stack = testStack({
        stackName: 'MyStack',
        template: {
          Resources: {
            NestedStackResource: {
              Type: 'AWS::CloudFormation::Stack',
              // No aws:asset:path metadata
            },
          },
        },
      });

      const tracer = new StackArtifactSourceTracer(stack);
      const result = await tracer.traceResource('arn:nested-stack', ['NestedStackResource'], 'InnerBucket');

      expect(result).toBeUndefined();
    });
  });

  describe('traceStack', () => {
    test('returns construct path for root stack', async () => {
      const stack = testStack({
        stackName: 'MyStack',
        template: { Resources: {} },
      });

      const tracer = new StackArtifactSourceTracer(stack);
      const result = await tracer.traceStack('arn:stack', []);

      expect(result).toMatchObject({ constructPath: 'MyStack' });
    });

    test('traces nested stack by popping last logicalId and tracing as resource', async () => {
      const stack = testStack({
        stackName: 'MyStack',
        template: {
          Resources: {
            NestedStackResource: {
              Type: 'AWS::CloudFormation::Stack',
              Metadata: {
                'aws:cdk:path': 'MyStack/NestedStack.NestedStackResource',
              },
            },
          },
        },
      });

      const tracer = new StackArtifactSourceTracer(stack);
      const result = await tracer.traceStack('arn:nested-stack', ['NestedStackResource']);

      expect(result).toMatchObject({ constructPath: 'MyStack/NestedStack.NestedStackResource' });
    });
  });
});
