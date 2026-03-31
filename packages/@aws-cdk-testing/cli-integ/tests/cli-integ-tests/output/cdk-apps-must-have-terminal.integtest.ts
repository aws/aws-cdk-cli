import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'cdk apps must run attached to a TTY',
  withDefaultFixture(async (fixture) => {
    // Certain customers pretty display libraries which stop being pretty if stdout is not attached to a terminal
    await fixture.cdkSynth({
      tty: true,
      env: {
        CHECK_TTY: 'true',
      },
    });
  }),
);

