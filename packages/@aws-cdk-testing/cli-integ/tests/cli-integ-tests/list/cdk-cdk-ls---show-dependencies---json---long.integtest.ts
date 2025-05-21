import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'cdk ls --show-dependencies --json --long',
  withDefaultFixture(async (fixture) => {
    const listing = await fixture.cdk(['ls --show-dependencies --json --long'], { captureStderr: false });

    const expectedStacks = [
      {
        id: 'order-providing',
        name: 'order-providing',
        enviroment: {
          account: 'unknown-account',
          region: 'unknown-region',
          name: 'aws://unknown-account/unknown-region',
        },
        dependencies: [],
      },
      {
        id: 'order-consuming',
        name: 'order-consuming',
        enviroment: {
          account: 'unknown-account',
          region: 'unknown-region',
          name: 'aws://unknown-account/unknown-region',
        },
        dependencies: [
          {
            id: 'order-providing',
            dependencies: [],
          },
        ],
      },
    ];

    for (const stack of expectedStacks) {
      expect(listing).toContain(fixture.fullStackName(stack.id));
      expect(listing).toContain(fixture.fullStackName(stack.name));
      expect(listing).toContain(stack.enviroment.account);
      expect(listing).toContain(stack.enviroment.name);
      expect(listing).toContain(stack.enviroment.region);
      for (const dependency of stack.dependencies) {
        expect(listing).toContain(fixture.fullStackName(dependency.id));
      }
    }
  }),
);

