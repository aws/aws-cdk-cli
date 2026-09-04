/**
 * Determine whether the S3 client should use path-style addressing.
 *
 * The AWS SDK defaults to virtual-hosted-style addressing
 * (`https://<bucket>.s3.amazonaws.com`). That doesn't work for S3-compatible
 * emulators reached over loopback (e.g. LocalStack or MinIO on `localhost`),
 * which only serve path-style URLs (`https://<endpoint>/<bucket>`).
 *
 * Returns `true` when path-style should be forced, or `undefined` to leave the
 * SDK default in place.
 *
 * - The `CDK_S3_FORCE_PATH_STYLE` environment variable forces it explicitly.
 * - Otherwise it is auto-detected when the configured S3 endpoint
 *   (`AWS_ENDPOINT_URL_S3`, falling back to `AWS_ENDPOINT_URL`) points at a
 *   loopback host.
 */
export function forceS3PathStyle(): boolean | undefined {
  if (process.env.CDK_S3_FORCE_PATH_STYLE) {
    return true;
  }

  const endpoint = process.env.AWS_ENDPOINT_URL_S3 ?? process.env.AWS_ENDPOINT_URL;
  if (endpoint && isLoopbackEndpoint(endpoint)) {
    return true;
  }

  return undefined;
}

function isLoopbackEndpoint(endpoint: string): boolean {
  let host: string;
  try {
    host = new URL(endpoint).hostname;
  } catch {
    return false;
  }

  // The URL parser wraps IPv6 addresses in brackets to make use of colons unambiguous, e.g. "http://[::1]:4566"
  // Strip them for easier comparison.
  const normalized = host.replace(/^\[|\]$/g, '').toLowerCase();
  return normalized === 'localhost'
    || normalized.startsWith('127.')
    || normalized === '::1';
}
