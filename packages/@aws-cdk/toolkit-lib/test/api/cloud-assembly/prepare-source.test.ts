import { frameworkSupportsContextOverflow } from '../../../lib/api/cloud-assembly/private/prepare-source';
import type { ConstructTreeNode } from '../../../lib/api/tree';

describe('frameworkSupportsContextOverflow', () => {
  test('returns true for undefined tree', () => {
    expect(frameworkSupportsContextOverflow(undefined)).toBe(true);
  });

  test('returns true for empty tree', () => {
    expect(frameworkSupportsContextOverflow({} as any)).toBe(true);
  });

  test('returns true for tree with non-App constructs', () => {
    const tree: ConstructTreeNode = {
      id: 'root',
      path: '',
      children: {
        stack1: {
          id: 'stack1',
          path: 'stack1',
          constructInfo: {
            fqn: 'aws-cdk-lib.Stack',
            version: '2.50.0',
          },
        },
      },
    };
    expect(frameworkSupportsContextOverflow(tree)).toBe(true);
  });

  test('returns false for v1 App', () => {
    const tree: ConstructTreeNode = {
      id: 'root',
      path: '',
      children: {
        app: {
          id: 'app',
          path: 'app',
          constructInfo: {
            fqn: '@aws-cdk/core.App',
            version: '1.180.0',
          },
        },
      },
    };
    expect(frameworkSupportsContextOverflow(tree)).toBe(false);
  });

  test('returns false for v2 App with version <= 2.38.0', () => {
    const tree: ConstructTreeNode = {
      id: 'root',
      path: '',
      children: {
        app: {
          id: 'app',
          path: 'app',
          constructInfo: {
            fqn: 'aws-cdk-lib.App',
            version: '2.38.0',
          },
        },
      },
    };
    expect(frameworkSupportsContextOverflow(tree)).toBe(false);
  });

  test('returns true for v2 App with version > 2.38.0', () => {
    const tree: ConstructTreeNode = {
      id: 'root',
      path: '',
      children: {
        app: {
          id: 'app',
          path: 'app',
          constructInfo: {
            fqn: 'aws-cdk-lib.App',
            version: '2.38.1',
          },
        },
      },
    };
    expect(frameworkSupportsContextOverflow(tree)).toBe(true);
  });

  test('returns true for v2 App with developer version (0.0.0)', () => {
    const tree: ConstructTreeNode = {
      id: 'root',
      path: '',
      children: {
        app: {
          id: 'app',
          path: 'app',
          constructInfo: {
            fqn: 'aws-cdk-lib.App',
            version: '0.0.0',
          },
        },
      },
    };
    expect(frameworkSupportsContextOverflow(tree)).toBe(true);
  });

  test('returns false if any node in the tree is a v2 App with version <= 2.38.0', () => {
    const tree: ConstructTreeNode = {
      id: 'root',
      path: '',
      children: {
        stack1: {
          id: 'stack1',
          path: 'stack1',
          constructInfo: {
            fqn: 'aws-cdk-lib.Stack',
            version: '2.50.0',
          },
        },
        nested: {
          id: 'nested',
          path: 'nested',
          children: {
            app: {
              id: 'app',
              path: 'nested/app',
              constructInfo: {
                fqn: 'aws-cdk-lib.App',
                version: '2.38.0',
              },
            },
          },
        },
      },
    };
    expect(frameworkSupportsContextOverflow(tree)).toBe(false);
  });

  test('returns true if all v2 Apps in the tree have version > 2.38.0', () => {
    const tree: ConstructTreeNode = {
      id: 'root',
      path: '',
      children: {
        app1: {
          id: 'app1',
          path: 'app1',
          constructInfo: {
            fqn: 'aws-cdk-lib.App',
            version: '2.38.1',
          },
        },
        nested: {
          id: 'nested',
          path: 'nested',
          children: {
            app2: {
              id: 'app2',
              path: 'nested/app2',
              constructInfo: {
                fqn: 'aws-cdk-lib.App',
                version: '2.50.0',
              },
            },
          },
        },
      },
    };
    expect(frameworkSupportsContextOverflow(tree)).toBe(true);
  });
});
