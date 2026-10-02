export interface SetCookie {
  readonly httpOnly?: boolean;
  readonly sameSite?: 'strict' | 'lax' | 'none';
  readonly path?: string;
}

/** Serialize a cookie into a `Set-Cookie` value from the subset of options we support. */
export function serializeSetCookieValue(name: string, value: string, options: SetCookie = {}): string {
  const parts = [`${name}=${value}`];
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite.charAt(0).toUpperCase()}${options.sameSite.slice(1)}`);
  }
  return parts.join('; ');
}

export function parseSetCookieValues(setCookieHeaders: string | string[] | undefined): Record<string, string> {
  if (!setCookieHeaders) {
    return {};
  }

  if (!Array.isArray(setCookieHeaders)) {
    setCookieHeaders = [setCookieHeaders];
  }

  const cookies: Record<string, string> = {};
  for (const header of setCookieHeaders) {
    const [cookie] = header.split(';');
    const [name, value] = cookie.split('=');
    cookies[name.trim()] = value.trim();
  }
  return cookies;
}

/**
 * Read one cookie out of a `Cookie` header. Hand-parsed rather than pulling in
 * `cookie-parser`: the explorer needs exactly one name, and the CLI bundles its
 * runtime dependencies.
 */
export function parseCookieValue(cookieHeader: string | string[] | null | undefined): Record<string, string> {
  if (!cookieHeader) {
    return {};
  }

  if (Array.isArray(cookieHeader)) {
    cookieHeader = cookieHeader.join('; ');
  }

  const ret: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;

    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();

    ret[name] = decodeURIComponent(value);
  }

  return ret;
}

export function serializeCookieValue(cookies: Record<string, string>) {
  return Object.entries(cookies)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('; ');
}
