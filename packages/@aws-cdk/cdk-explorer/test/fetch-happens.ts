import { parseCookieValue, parseSetCookieValues, serializeCookieValue } from '../lib/expressy/cookies';

/**
 * A fetch wrapper that handles redirects *with* cookies
 *
 * Not something `fetch` does by default so we have to build it on top.
 *
 * The name is a reference to an early 2000s film.
 */
export async function fetchHappens(url: string | URL, init?: FetchInit): Promise<Response> {
  const request = {
    ...init,
    headers: { ...init?.headers },
    redirect: 'manual' as const,
  };

  const cookieJar = init?.cookieJar ?? {};
  // Merge cookies from the request headers into the cookie jar
  Object.assign(cookieJar, parseCookieValue(new Headers(request.headers).get('Cookie')));
  // Rewrite cookie header with the updated cookie jar
  request.headers = {
    ...request.headers,
    Cookie: serializeCookieValue(cookieJar),
  };

  let response = await fetch(url, request);
  while (response.status === 301 || response.status === 302) {
    const location = response.headers.get('Location');
    if (!location) break;

    url = new URL(location, url);

    // Update the cookie jar with cookies from the response
    const setCookie = response.headers.getSetCookie();
    if (setCookie) {
      Object.assign(cookieJar, parseSetCookieValues(setCookie));
      // Rewrite cookie header with the updated cookie jar
      request.headers = {
        ...request.headers,
        Cookie: serializeCookieValue(cookieJar),
      };
    }

    response = await fetch(url, request);
  }
  return response;
}

interface FetchInit extends RequestInit {
  /**
   * Optional cookie jar to store and send cookies with requests.
   *
   * Will be updated in-place with cookies received from responses.
   */
  cookieJar?: CookieJar;
}

export type CookieJar = Record<string, string>;
