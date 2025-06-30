import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs-extra';
import { IoHelper } from '../../api-private';

export async function getLibraryVersion(ioHelper: IoHelper): Promise<string | undefined> {
  try {
    const command = "node -e 'console.log(require.resolve(\"aws-cdk-lib\"))'";
    const { stdout } = await promisify(exec)(command);

    // stdout should be a file path but lets double check
    if (!fs.existsSync(stdout)) {
      ioHelper.defaults.trace('Could not get CDK Library Version: require.resolve("aws-cdk-lib") did not return a file path');
      return;
    };

    const pathToPackageJson = path.join(path.dirname(stdout), 'package.json');
    const packageJson = fs.readJSONSync(pathToPackageJson);
    return packageJson.version;
  } catch (e: any) {
    ioHelper.defaults.trace(`Could not get CDK Library Version: ${e}`);
    return;
  }
}
