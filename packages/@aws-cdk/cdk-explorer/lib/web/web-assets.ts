/**
 * Serves the web explorer SPA from memory. The bytes come from
 * web-assets.generated.json (written by build-tools/bundle-frontend.ts); the
 * static `require` is what pulls them into the published CLI bundle. The build
 * always generates this file, so its absence is a build error, not a runtime
 * condition we handle (same convention as the CLI's build-info.json).
 */
import * as fs from 'fs';
import * as path from 'path';
import { EMBEDDED_ASSETS } from './web-assets.generated';
export interface WebAsset {
  readonly contentType: string;
  readonly body: Buffer;
}

const CONTENT_TYPES: Record<string, string> = {
  'index.html': 'text/html; charset=utf-8',
  'bundle.js': 'text/javascript; charset=utf-8',
  'bundle.css': 'text/css; charset=utf-8',
  'icon.png': 'image/png',
};

const BUNDLED_FILES = ['bundle.js', 'bundle.css'];

const WEB_ASSETS: Record<string, WebAsset> = Object.fromEntries(
  Object.entries(EMBEDDED_ASSETS).map(([name, body]) => [name, { contentType: CONTENT_TYPES[name], body }]),
);

/** A named SPA asset (e.g. "bundle.js"), or undefined if not part of the build. */
export function webAsset(name: string): WebAsset | undefined {
  if (process.env.CDK_LIVE === undefined) {
    return WEB_ASSETS.hasOwnProperty(name) ? WEB_ASSETS[name] : undefined;
  }

  try {
    const diskLocation = BUNDLED_FILES.includes(name)
      ? path.resolve(__dirname, 'static', `${name}`)
      : path.resolve(__dirname, '..', '..', 'frontend', `${name}`)
      ;

    return {
      contentType: CONTENT_TYPES[name],
      body: fs.readFileSync(diskLocation),
    };
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      return undefined;
    }
    throw e;
  }
}
