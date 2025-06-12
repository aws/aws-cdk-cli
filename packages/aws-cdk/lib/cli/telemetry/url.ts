import { parse, UrlWithStringQuery } from 'node:url';

let cachedUrl: UrlWithStringQuery;

let prodUrl: string = ''; // TODO: add when its launched

/**
 *  Usage data tracking service URL
 */
export const getUrl = (): UrlWithStringQuery => {
  if (!cachedUrl) {
    cachedUrl = getParsedUrl();
  }

  return cachedUrl;
};

const getParsedUrl = (): UrlWithStringQuery => {
  return parse(
    process.env.CDK_TELEMETRY_ENDPOINT || prodUrl,
  );
};
