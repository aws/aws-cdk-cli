/**
 * Serves the web explorer SPA from memory. The bytes come from
 * web-assets.generated.json (written by build-tools/bundle-frontend.ts); the
 * static `require` is what pulls them into the published CLI bundle. The build
 * always generates this file, so its absence is a build error, not a runtime
 * condition we handle (same convention as the CLI's build-info.json).
 */
import * as fs from 'fs';
import * as path from 'path';
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

/** A named SPA asset (e.g. "bundle.js"), or undefined if not part of the build. */
export function webAsset(name: string): WebAsset | undefined {
  if (process.env.CDK_LIVE === undefined) {
    return WEB_ASSETS.hasOwnProperty(name) ? WEB_ASSETS[name] : undefined;
  }

  try {
    return {
      contentType: CONTENT_TYPES[name],
      body: fs.readFileSync(path.resolve(__dirname, 'static', `${name}`), 'utf-8'),
    };
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      return undefined;
    }
    throw e;
  }
}
