import type { TestContext } from '../../lib/integ-test';
import type { AwsContext } from '../../lib/with-aws';
import { withAws } from '../../lib/with-aws';
import type { DisableBootstrapContext } from '../../lib/with-cdk-app';
import type { PackageContext } from '../../lib/with-packages';
import { withPackages } from '../../lib/with-packages';
import type { TemporaryDirectoryContext } from '../../lib/with-temporary-directory';
import { withTemporaryDirectory } from '../../lib/with-temporary-directory';

/**
 * The default prerequisites for tests running tool integrations
 */
export function withToolContext<A extends TestContext>(
  block: (context: A & TemporaryDirectoryContext & PackageContext & AwsContext & DisableBootstrapContext
  ) => Promise<void>) {
  return withAws(withTemporaryDirectory(withPackages(block)));
}
