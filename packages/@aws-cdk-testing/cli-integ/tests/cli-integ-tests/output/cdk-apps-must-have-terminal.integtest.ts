import { integTest, withAws, withSpecificCdkApp } from '../../../lib';

integTest(
  'cdk apps must run attached to a TTY',
  withAws(withSpecificCdkApp('tty-app', async (fixture) => {
    // Certain customers pretty display libraries which stop being pretty if stdout is not attached to a terminal
    // This application will fail if it doesn't detect a TTY
    await fixture.cdkSynth({
      tty: true,
    });
  })),
);

