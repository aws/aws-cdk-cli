import type { UserAgentMetadata } from '../api/aws-auth';
import { isCI, guessAgent } from '../api-private';

/**
 * User-Agent tokens describing the environment the CLI runs in
 *
 * Sent as `aws-cdk/agent#true` and `aws-cdk/ci#true` when an AI agent or
 * CI system is detected. Which agent or CI system it is, is not sent.
 */
export function cliUserAgentMetadata(): UserAgentMetadata[] {
  const metadata: UserAgentMetadata[] = [];

  if (guessAgent()) {
    metadata.push({ key: 'agent', value: 'true' });
  }

  if (isCI()) {
    metadata.push({ key: 'ci', value: 'true' });
  }

  return metadata;
}
