import * as path from 'path';
import { run } from '@aws-cdk/private-tools/lib/subprocess';
import * as fs from 'fs-extra';
import type { IoHelper } from '../../api-private';

export async function getLibraryVersion(ioHelper: IoHelper): Promise<string | undefined> {
  try {
    const { stdout } = await run([process.execPath, '-e', 'process.stdout.write(require.resolve("aws-cdk-lib"))']);

    // stdout should be a file path but lets double check
    if (!fs.existsSync(stdout)) {
      await ioHelper.defaults.trace('Could not get CDK Library Version: require.resolve("aws-cdk-lib") did not return a file path');
      return;
    }

    const pathToPackageJson = path.join(path.dirname(stdout), 'package.json');
    const packageJson = fs.readJSONSync(pathToPackageJson);
    if (!packageJson.version) {
      await ioHelper.defaults.trace('Could not get CDK Library Version: package.json does not have version field');
      return;
    }

    return packageJson.version;
  } catch (e: any) {
    await ioHelper.defaults.trace(`Could not get CDK Library Version: ${e}`);
    return;
  }
}
