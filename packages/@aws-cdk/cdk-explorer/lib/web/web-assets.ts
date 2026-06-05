/**
 * Serves the web explorer SPA from memory. The bytes come from
 * web-assets.generated.json (written by build-tools/bundle-frontend.ts); the
 * static `require` is what pulls them into the published CLI bundle. The build
 * always generates this file, so its absence is a build error, not a runtime
 * condition we handle (same convention as the CLI's build-info.json).
 */
export interface WebAsset {
  readonly contentType: string;
  readonly body: string;
}

const CONTENT_TYPES: Record<string, string> = {
  'index.html': 'text/html; charset=utf-8',
  'bundle.js': 'text/javascript; charset=utf-8',
  'bundle.css': 'text/css; charset=utf-8',
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const raw = require('./web-assets.generated.json') as Record<string, string>;

const WEB_ASSETS: Record<string, WebAsset> = Object.fromEntries(
  Object.entries(raw).map(([name, body]) => [name, { contentType: CONTENT_TYPES[name], body }]),
);

/** The SPA entry document. */
export function indexHtml(): WebAsset {
  return WEB_ASSETS['index.html'];
}

/** A named SPA asset (e.g. "bundle.js"), or undefined if not part of the build. */
export function webAsset(name: string): WebAsset | undefined {
  return WEB_ASSETS[name];
}
