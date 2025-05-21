import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'cdk ls --show-dependencies --json',
  withDefaultFixture(async (fixture) => {
    const listing = await fixture.cdk(['ls --show-dependencies --json'], { captureStderr: false });

    const expectedStacks = [
      {
        id: 'test-1',
        dependencies: [],
      },
      {
        id: 'order-providing',
        dependencies: [],
      },
      {
        id: 'order-consuming',
        dependencies: [
          {
            id: 'order-providing',
            dependencies: [],
          },
        ],
      },
      {
        id: 'with-nested-stack',
        dependencies: [],
      },
      {
        id: 'list-stacks',
        dependencies: [
          {
            id: 'list-stacks/DependentStack',
            dependencies: [
              {
                id: 'list-stacks/DependentStack/InnerDependentStack',
                dependencies: [],
              },
            ],
          },
        ],
      },
      {
        id: 'list-multiple-dependent-stacks',
        dependencies: [
          {
            id: 'list-multiple-dependent-stacks/DependentStack1',
            dependencies: [],
          },
          {
            id: 'list-multiple-dependent-stacks/DependentStack2',
            dependencies: [],
          },
        ],
      },
    ];

    function validateStackDependencies(stack: StackDetails) {
      expect(listing).toContain(stack.id);

      function validateDependencies(dependencies: DependencyDetails[]) {
        for (const dependency of dependencies) {
          expect(listing).toContain(dependency.id);
          if (dependency.dependencies.length > 0) {
            validateDependencies(dependency.dependencies);
          }
        }
      }

      if (stack.dependencies.length > 0) {
        validateDependencies(stack.dependencies);
      }
    }

    for (const stack of expectedStacks) {
      validateStackDependencies(stack);
    }
  }),
);

/**
 * Type to store stack dependencies recursively
 */
type DependencyDetails = {
  id: string;
  dependencies: DependencyDetails[];
};

type StackDetails = {
  id: string;
  dependencies: DependencyDetails[];
};
