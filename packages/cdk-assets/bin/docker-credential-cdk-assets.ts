/**
 * Docker Credential Helper to retrieve credentials based on an external configuration file.
 * Supports loading credentials from ECR repositories and from Secrets Manager,
 * optionally via an assumed role.
 *
 * The only operation currently supported by this credential helper at this time is the `get`
 * command, which receives a domain name as input on stdin and returns a Username/Secret in
 * JSON format on stdout.
 *
 * IMPORTANT - The credential helper must not output anything else besides the final credentials
 * in any success case; doing so breaks docker's parsing of the output and causes the login to fail.
 */

import * as fs from 'fs';
import { DefaultAwsClient } from '@aws-cdk/cdk-assets-lib';

// During bundling, esbuild enforces that every module accessed
// via the top level package name is also exported. Since 'docker-credentials'
// is a private module, we prefer to not export it. Luckily, we can use relative
// local paths instead.
import {
  cdkCredentialsConfig,
  cdkCredentialsConfigFile,
  fetchDockerLoginCredentials,
// eslint-disable-next-line import/no-relative-packages
} from '../../@aws-cdk/cdk-assets-lib/lib/private/docker-credentials';

async function main() {
  // Expected invocation is [node, docker-credential-cdk-assets, get] with input fed via STDIN
  // For other valid docker commands (store, list, erase), we no-op.
  if (process.argv.length !== 3 || process.argv[2] !== 'get') {
    process.exit(0);
  }

  const config = cdkCredentialsConfig();
  if (!config) {
    throw new Error(`unable to find CDK Docker credentials at: ${cdkCredentialsConfigFile()}`);
  }

  // Read the domain to fetch from stdin
  let endpoint = fs.readFileSync(0, { encoding: 'utf-8' }).trim();

  const deadline = Date.now() + 60_000; // 60 seconds timeout
  let lastError: Error | undefined;

  while (Date.now() < deadline) {
    try {
      const credentials = await fetchDockerLoginCredentials(new DefaultAwsClient(), config, endpoint);
      // Write the credentials back to stdout
      fs.writeFileSync(1, JSON.stringify(credentials));
      return;
    } catch (e: any) {
      lastError = e;
      
      // Retry on AccessDenied errors due to eventual consistency in AWS IAM.
      // Newly created roles and policies may take time to propagate across regions.
      if (e.name === 'AccessDenied') {
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
        continue;
      }
      
      // For other errors, throw immediately
      throw e;
    }
  }

  throw lastError;
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e.stack);
  process.exitCode = 1;
});
