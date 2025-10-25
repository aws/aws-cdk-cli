import { ResourceDifference, PropertyDifference, ResourceImpact } from '@aws-cdk/cloudformation-diff';
import {
  parseResourceFilter,
  matchesResourceType,
  matchesPropertyFilter,
  validateResourceChanges,
  formatViolationMessage,
} from '../../lib/api/resource-filter';

describe('Resource Filter', () => {
  describe('parseResourceFilter', () => {
    test('parses resource type only', () => {
      const filter = parseResourceFilter('AWS::Lambda::Function');
      expect(filter.resourceType).toBe('AWS::Lambda::Function');
      expect(filter.propertyPath).toBeUndefined();
    });

    test('parses resource type with property path', () => {
      const filter = parseResourceFilter('AWS::Lambda::Function.Properties.Code.S3Key');
      expect(filter.resourceType).toBe('AWS::Lambda::Function');
      expect(filter.propertyPath).toBe('Properties.Code.S3Key');
    });

    test('throws error for empty filter', () => {
      expect(() => parseResourceFilter('')).toThrow('Invalid resource filter');
    });
  });

  describe('matchesResourceType', () => {
    test('matches exact resource type', () => {
      expect(matchesResourceType('AWS::Lambda::Function', 'AWS::Lambda::Function')).toBe(true);
      expect(matchesResourceType('AWS::Lambda::Function', 'AWS::S3::Bucket')).toBe(false);
    });

    test('matches wildcard', () => {
      expect(matchesResourceType('AWS::Lambda::Function', '*')).toBe(true);
      expect(matchesResourceType('AWS::S3::Bucket', '*')).toBe(true);
    });

    test('matches prefix wildcard', () => {
      expect(matchesResourceType('AWS::Lambda::Function', 'AWS::Lambda::*')).toBe(true);
      expect(matchesResourceType('AWS::Lambda::Version', 'AWS::Lambda::*')).toBe(true);
      expect(matchesResourceType('AWS::S3::Bucket', 'AWS::Lambda::*')).toBe(false);
    });
  });

  describe('matchesPropertyFilter', () => {
    test('matches resource type without property path', () => {
      const filter = { resourceType: 'AWS::Lambda::Function' };
      expect(matchesPropertyFilter('AWS::Lambda::Function', 'Code', filter)).toBe(true);
      expect(matchesPropertyFilter('AWS::S3::Bucket', 'Code', filter)).toBe(false);
    });

    test('matches specific property path', () => {
      const filter = { resourceType: 'AWS::Lambda::Function', propertyPath: 'Code.S3Key' };
      expect(matchesPropertyFilter('AWS::Lambda::Function', 'Code.S3Key', filter)).toBe(true);
      expect(matchesPropertyFilter('AWS::Lambda::Function', 'Runtime', filter)).toBe(false);
    });
  });

  describe('validateResourceChanges', () => {
    test('allows all changes when no filters specified', () => {
      const changes = {
        MyFunction: createResourceDifference('AWS::Lambda::Function', { isUpdate: true }),
      };
      const result = validateResourceChanges(changes, []);
      expect(result.isValid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    test('allows matching resource type changes', () => {
      const changes = {
        MyFunction: createResourceDifference('AWS::Lambda::Function', { isUpdate: true }),
      };
      const result = validateResourceChanges(changes, ['AWS::Lambda::Function']);
      expect(result.isValid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    test('blocks non-matching resource type changes', () => {
      const changes = {
        MyBucket: createResourceDifference('AWS::S3::Bucket', { isUpdate: true }),
      };
      const result = validateResourceChanges(changes, ['AWS::Lambda::Function']);
      expect(result.isValid).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]).toContain('MyBucket');
    });

    test('allows wildcard patterns', () => {
      const changes = {
        MyFunction: createResourceDifference('AWS::Lambda::Function', { isUpdate: true }),
        MyVersion: createResourceDifference('AWS::Lambda::Version', { isUpdate: true }),
      };
      const result = validateResourceChanges(changes, ['AWS::Lambda::*']);
      expect(result.isValid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
  });

  describe('formatViolationMessage', () => {
    test('formats violation message correctly', () => {
      const violations = ['MyBucket (AWS::S3::Bucket): property \'BucketName\' change not allowed by filters'];
      const filters = ['AWS::Lambda::Function'];
      const message = formatViolationMessage(violations, filters);

      expect(message).toContain('❌ Deployment aborted');
      expect(message).toContain('AWS::Lambda::Function');
      expect(message).toContain('MyBucket');
      expect(message).toContain('Review and remove the unwanted changes');
    });
  });
});

function createResourceDifference(
  resourceType: string,
  options: { isUpdate?: boolean; isAddition?: boolean; isRemoval?: boolean } = {},
): ResourceDifference {
  const oldValue = options.isAddition ? undefined : { Type: resourceType, Properties: {} };
  const newValue = options.isRemoval ? undefined : { Type: resourceType, Properties: {} };

  const diff = new ResourceDifference(oldValue, newValue, {
    resourceType: { oldType: resourceType, newType: resourceType },
    propertyDiffs: options.isUpdate ? {
      SomeProperty: new PropertyDifference('oldValue', 'newValue', { changeImpact: ResourceImpact.WILL_UPDATE }),
    } : {},
    otherDiffs: {},
  });

  return diff;
}
