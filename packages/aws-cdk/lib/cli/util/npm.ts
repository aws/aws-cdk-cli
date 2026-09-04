import type { ClientRequest } from 'node:http';
import type { Agent, RequestOptions } from 'node:https';
import * as https from 'node:https';
import { ToolkitError } from '@aws-cdk/toolkit-lib';

const NPM_REGISTRY_ROOT = 'https://registry.npmjs.org';
const REQUEST_TIMEOUT_MS = 3_000;

/**
 * Version information about the `aws-cdk` package, as reported by the npm registry
 */
export interface NpmVersionInfo {
  /**
   * The version the `latest` dist-tag points to
   */
  readonly latestVersion: string;

  /**
   * The deprecation message of the currently running version, if it is deprecated
   */
  readonly deprecated?: string;
}

/**
 * Query the public npm registry for version information about the `aws-cdk` package.
 *
 * This deliberately queries `registry.npmjs.org` directly (rather than shelling out
 * to `npm view`, which honors the local npm configuration), so that stale metadata
 * from corporate registry mirrors or the local npm cache cannot produce bogus
 * upgrade recommendations.
 */
export async function fetchNpmVersionInfo(currentVersion: string, agent?: Agent): Promise<NpmVersionInfo> {
  // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
  const [latestInfo, currentInfo] = await Promise.all([
    getJson(`${NPM_REGISTRY_ROOT}/aws-cdk/latest`, agent),
    // The running version may not exist on the registry (e.g. developer builds),
    // in which case we simply have no deprecation information for it.
    getJson(`${NPM_REGISTRY_ROOT}/aws-cdk/${encodeURIComponent(currentVersion)}`, agent, { allowNotFound: true }),
  ]);

  if (typeof latestInfo?.version !== 'string') {
    throw new ToolkitError('NpmRegistryUnexpectedResponse', 'npm registry response for aws-cdk@latest did not contain a version');
  }

  return {
    latestVersion: latestInfo.version,
    deprecated: typeof currentInfo?.deprecated === 'string' ? currentInfo.deprecated : undefined,
  };
}

interface GetJsonOptions {
  /**
   * Resolve to `undefined` on a 404 response instead of failing
   *
   * @default false
   */
  readonly allowNotFound?: boolean;
}

function getJson(url: string, agent?: Agent, options: GetJsonOptions = {}): Promise<any> {
  const requestOptions: RequestOptions = {
    agent,
    headers: { Accept: 'application/json' },
  };

  return new Promise((resolve, reject) => {
    let req: ClientRequest | undefined;

    const timer = setTimeout(() => {
      if (req) {
        req.destroy(new ToolkitError('NpmRegistryRequestTimeout', `request to ${url} timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }
    }, REQUEST_TIMEOUT_MS);
    timer.unref();

    req = https.get(url, requestOptions, (res) => {
      if (res.statusCode === 404 && options.allowNotFound) {
        res.resume(); // discard the response body
        resolve(undefined);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume(); // discard the response body
        reject(new ToolkitError('NpmRegistryHttpError', `request to ${url} failed with status code ${res.statusCode}`));
        return;
      }

      res.setEncoding('utf8');
      let rawData = '';
      res.on('data', (chunk) => {
        rawData += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(rawData));
        } catch (e: any) {
          reject(ToolkitError.withCause('NpmRegistryParseError', `could not parse response from ${url}: ${e.message}`, e));
        }
      });
      res.on('error', (e) => {
        reject(ToolkitError.withCause('NpmRegistryResponseError', `response from ${url} failed: ${e.message}`, e));
      });
    });
    req.on('error', (e) => {
      reject(ToolkitError.withCause('NpmRegistryNetworkError', `request to ${url} failed: ${e.message}`, e));
    });
  });
}
