/**
 * Get a human-readable error message for a network error
 * @param error The network error object
 */
export function humanNetworkError(error: NodeJS.ErrnoException): string {
  switch (error.code) {
    case 'ENOTFOUND':
      return `Cannot reach the server. Please check your internet connection or the URL (${(error as any).hostname}).`;
    case 'ECONNREFUSED':
      return `Connection refused. The server at ${(error as any).address}:${(error as any).port} is not accepting connections.`;
    case 'ECONNRESET':
      return 'Connection was suddenly closed by the server. Please try again later.';
    case 'ETIMEDOUT':
      return 'Connection timed out. The server took too long to respond.';
    case 'CERT_HAS_EXPIRED':
      return 'The SSL certificate of the server has expired. This could be a security risk.';
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'CERT_SIGNATURE_FAILURE':
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
      return 'SSL certificate validation failed. This could indicate a security issue or a misconfigured server.';
    default:
      return `Network error: ${error.message || error.code || 'Unknown error'}`;
  }
}

/**
 * Get a human-readable error message for a HTTP status code
 */
export function humanHttpStatusError(statusCode: number): string {
  switch (statusCode) {
    case 400:
      return 'Bad request - the server could not understand the request';
    case 401:
      return 'Unauthorized - authentication is required';
    case 403:
      return 'Forbidden - you do not have permission to access this resource';
    case 404:
      return 'Not found - the requested resource does not exist';
    case 408:
      return 'Request timeout - the server timed out waiting for the request';
    case 429:
      return 'Too many requests - you have sent too many requests in a given amount of time';
    case 500:
      return 'Internal server error - something went wrong on the server';
    case 502:
      return 'Bad gateway - the server received an invalid response from an upstream server';
    case 503:
      return 'Service unavailable - the server is temporarily unable to handle the request';
    case 504:
      return 'Gateway timeout - the server did not receive a timely response from an upstream server';
    default:
      return statusCode >= 500
        ? 'Server error - something went wrong on the server'
        : 'Client error - something went wrong with the request';
  }
}
