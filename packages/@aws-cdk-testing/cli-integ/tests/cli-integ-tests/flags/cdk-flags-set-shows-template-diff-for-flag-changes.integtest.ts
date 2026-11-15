import { promises as fs } from 'fs';
import * as path from 'path';
import { integTest, withAws, withSpecificCdkApp } from '../../../lib';

const FLAG = '@aws-cdk/aws-lambda:useCdkManagedLogGroup';

integTest(
  'flags --set shows the template diff caused by the flag change',
  // `cdk flags` only synthesizes the app, so no bootstrap is needed
  withAws(
    withSpecificCdkApp('flags-diff-app', async (fixture) => {
      const output = await fixture.cdk([
        'flags',
        '--unstable=flags',
        '--set',
        FLAG,
        '--value',
        'true',
        '--yes',
      ]);

      // The prototype synth without the flag must be compared against the synth with the flag,
      // so the LogGroup that the flag adds has to show up in the diff
      expect(output).toContain('AWS::Logs::LogGroup');
      expect(output).not.toContain('There were no differences');
      expect(output).toContain('Flag changes:');

      const cdkJson = JSON.parse(await fs.readFile(path.join(fixture.integTestDir, 'cdk.json'), 'utf-8'));
      expect(cdkJson.context[FLAG]).toBe(true);
    }),
    { disableBootstrap: true },
  ),
);
