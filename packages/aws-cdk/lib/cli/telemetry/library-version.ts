import { createRequire } from 'module';
import * as path from 'path';
import * as fs from 'fs-extra';
import type { IoHelper } from '../../api-private';

export async function getLibraryVersion(ioHelper: IoHelper): Promise<string | undefined> {
  try {
    // Resolve from the app's directory rather than our own. The CLI is usually
    // installed globally (or run via `npx`), so its own module paths don't contain
    // the app's `aws-cdk-lib`.
    const requireFromApp = createRequire(path.join(process.cwd(), 'index.js'));
    const entryPoint = requireFromApp.resolve('aws-cdk-lib');

    // entryPoint should be a file path but lets double check
    if (!fs.existsSync(entryPoint)) {
      await ioHelper.defaults.trace('Could not get CDK Library Version: require.resolve("aws-cdk-lib") did not return a file path');
      return;
    }

    const pathToPackageJson = path.join(path.dirname(entryPoint), 'package.json');
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
