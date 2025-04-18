import { promises as fs } from 'fs';
import * as path from 'path';
import { integTest, withDefaultFixture } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'enableDiffNoFail',
  withDefaultFixture(async (fixture) => {
    await diffShouldSucceedWith({ fail: false, enableDiffNoFail: false });
    await diffShouldSucceedWith({ fail: false, enableDiffNoFail: true });
    await diffShouldFailWith({ fail: true, enableDiffNoFail: false });
    await diffShouldFailWith({ fail: true, enableDiffNoFail: true });
    await diffShouldFailWith({ fail: undefined, enableDiffNoFail: false });
    await diffShouldSucceedWith({ fail: undefined, enableDiffNoFail: true });

    async function diffShouldSucceedWith(props: DiffParameters) {
      await expect(diff(props)).resolves.not.toThrow();
    }

    async function diffShouldFailWith(props: DiffParameters) {
      await expect(diff(props)).rejects.toThrow('exited with error');
    }

    async function diff(props: DiffParameters): Promise<string> {
      await updateContext(props.enableDiffNoFail);
      const flag = props.fail != null ? (props.fail ? '--fail' : '--no-fail') : '';

      return fixture.cdk(['diff', flag, fixture.fullStackName('test-1')]);
    }

    async function updateContext(enableDiffNoFail: boolean) {
      const cdkJson = JSON.parse(await fs.readFile(path.join(fixture.integTestDir, 'cdk.json'), 'utf8'));
      cdkJson.context = {
        ...cdkJson.context,
        'aws-cdk:enableDiffNoFail': enableDiffNoFail,
      };
      await fs.writeFile(path.join(fixture.integTestDir, 'cdk.json'), JSON.stringify(cdkJson));
    }

    type DiffParameters = { fail?: boolean; enableDiffNoFail: boolean };
  }),
);

