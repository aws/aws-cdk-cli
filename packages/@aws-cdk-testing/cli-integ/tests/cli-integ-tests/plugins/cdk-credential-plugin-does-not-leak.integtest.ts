import * as fs from 'fs';
import * as path from 'path';
import { Writable } from 'stream';
import { integTest, withoutBootstrap } from '../../../lib';

/**
 * Synthetic secrets the plugin hands back to the CLI.
 *
 * Deliberately not shaped like real AWS credentials, so that a leak of these into a build log can
 * never be mistaken for an actual credential.
 *
 * These are NOT passed to `registerSecrets()` on purpose: the harness redacts registered secrets
 * from captured output (lib/corking.ts), which would mask a real leak and let this test pass while
 * the CLI is printing credentials to stderr.
 */
const SENTINELS = {
  accessKeyId: 'sentinel-access-key-id-integ-do-not-print',
  secretAccessKey: 'sentinel-secret-access-key-integ-do-not-print',
  sessionToken: 'sentinel-session-token-integ-do-not-print',
};

const CREDENTIAL_SOURCE_NAME = 'leak-check-plugin';

// `withoutBootstrap` because this test never deploys anything: the CLI is expected to fail while it
// is still resolving credentials, long before it touches CloudFormation.
integTest('credential plugin secrets do not reach stderr when the plugin breaks its refresh contract', withoutBootstrap(async (fixture) => {
  const pluginPath = path.join(fixture.integTestDir, 'leak-check-credential-plugin.js');
  fs.writeFileSync(pluginPath, credentialPluginSource());

  // An account the ambient test credentials cannot serve, so the CLI is forced to ask the plugin
  // for credentials rather than using its own.
  const ownAccount = await fixture.aws.account();
  const foreignAccount = ownAccount === '123456789012' ? '210987654321' : '123456789012';

  const chunks = new Array<string>();
  const captured = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });

  await expect(fixture.cdk([
    'bootstrap', `aws://${foreignAccount}/${fixture.aws.region}`,
    '--plugin', pluginPath,
  ], {
    // Keep the harness log, and additionally take our own copy of the child's raw stdout+stderr.
    // The returned string is not available when the command fails, and it is the failure case we
    // need to inspect here.
    outputs: [captured, fixture.output],
  })).rejects.toThrow(/exited with error code/);

  const output = chunks.join('');

  // The stable prefix and the actionable CDK-side context are expected...
  expect(output).toMatch(/Plugin initially returned static V3/);
  expect(output).toContain(`credential provider source '${CREDENTIAL_SOURCE_NAME}'`);
  expect(output).toContain('when refreshing expired credentials');

  // ...and none of the secrets the plugin returned, in any form.
  for (const secret of Object.values(SENTINELS)) {
    expect(output).not.toContain(secret);
  }
}));

/**
 * A real credential-provider plugin that violates the refresh contract.
 *
 * The first request for a given account and mode returns static V3 credentials that are already
 * inside the expiry window, so the very next use of that provider takes the refresh path. Every
 * later request for the same account and mode returns a V2-compatible credential object, which the
 * refresh path rejects -- that rejected object is what used to be interpolated into the error
 * message and printed to stderr.
 *
 * Keyed on account and mode rather than on a call counter: the CLI may set up providers for reading
 * and for writing separately, and each of those *initial* resolutions must still hand out the
 * expiring credentials. A plain counter would make the second initial resolution return the
 * rejected shape, which takes a different code path and never reaches the refresh error.
 */
function credentialPluginSource(): string {
  return [
    "'use strict';",
    '',
    'const alreadyResolved = new Set();',
    '',
    'module.exports = {',
    "  version: '1',",
    '  init(host) {',
    '    host.registerCredentialProviderSource({',
    `      name: ${JSON.stringify(CREDENTIAL_SOURCE_NAME)},`,
    '      isAvailable: () => Promise.resolve(true),',
    '      canProvideCredentials: () => Promise.resolve(true),',
    '      getProvider: (accountId, mode) => {',
    "        const key = accountId + ':' + mode;",
    '        if (!alreadyResolved.has(key)) {',
    '          alreadyResolved.add(key);',
    '          return Promise.resolve({',
    "            accessKeyId: 'first-call-placeholder-not-a-secret',",
    "            secretAccessKey: 'first-call-placeholder-not-a-secret',",
    "            sessionToken: 'first-call-placeholder-not-a-secret',",
    '            // Within the 5 second window that counts as "about to expire", so the first use of',
    '            // the provider immediately asks the plugin again.',
    '            expiration: new Date(Date.now() + 1000),',
    '          });',
    '        }',
    '        return Promise.resolve({',
    `          accessKeyId: ${JSON.stringify(SENTINELS.accessKeyId)},`,
    `          secretAccessKey: ${JSON.stringify(SENTINELS.secretAccessKey)},`,
    `          sessionToken: ${JSON.stringify(SENTINELS.sessionToken)},`,
    '          expireTime: new Date(Date.now() + 3600 * 1000),',
    '          getPromise: () => Promise.resolve(),',
    '        });',
    '      },',
    '    });',
    '  },',
    '};',
    '',
  ].join('\n');
}
