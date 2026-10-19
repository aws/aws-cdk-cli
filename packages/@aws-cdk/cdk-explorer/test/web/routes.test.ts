import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NonInteractiveIoHost, Toolkit } from '@aws-cdk/toolkit-lib';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import type { Express } from '../../lib/expressy';
import { createApp } from '../../lib/expressy';
import { createApiRouter } from '../../lib/web/routes';
import { StalenessTracker } from '../../lib/web/staleness';
import { AssemblyFixture, type AssemblySpec } from '../_helpers/assembly';

/**
 * These drive the router through a real `Toolkit` over a fixture cloud assembly
 * on disk, so the whole read path (assembly read lock, index, validation report)
 * is exercised rather than stubbed.
 */
const APP_SOURCES = {
  'app.ts': 'export const x = 1;\n',
  'lib/stack.ts': `${'\n'.repeat(19)}class Stack {}\n`,
};

let fixture: AssemblyFixture | undefined;

afterEach(() => {
  fixture?.cleanup();
  fixture = undefined;
});

/** Build an app serving the router over a freshly-created fixture assembly. */
function appFor(spec: AssemblySpec = {}, opts: { staleness?: StalenessTracker; assemblyDir?: string } = {}): Express {
  fixture = AssemblyFixture.create({ sourceFiles: APP_SOURCES, ...spec });
  const app = createApp();
  app.use('/api', createApiRouter({
    appDir: fixture.appDir,
    assemblyDir: opts.assemblyDir ?? fixture.assemblyDir,
    toolkit: new Toolkit({ ioHost: new NonInteractiveIoHost() }),
    staleness: opts.staleness,
    // Nothing here aborts mid-request; the signal exists so the assembly read's
    // lock retry can be cancelled on server shutdown.
    abort: new AbortController().signal,
  }).router);
  return app;
}

/** A single-stack assembly whose bucket is created at lib/stack.ts:12:5. */
const ONE_BUCKET: AssemblySpec = {
  stacks: [{
    id: 'MyStack',
    resources: [{
      path: 'Bucket/Resource',
      logicalId: 'Bucket123',
      type: 'AWS::S3::Bucket',
      at: 'lib/stack.ts:12:5',
      props: { BucketName: 'my-bucket', VersioningConfiguration: { Status: 'Enabled' } },
    }],
  }],
};

describe('GET /api/health', () => {
  test('returns ok', async () => {
    const res = await request(appFor()).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('GET /api/info', () => {
  test('reports the canonical app dir', async () => {
    const app = appFor();

    const res = await request(app).get('/api/info');

    expect(res.status).toBe(200);
    expect(res.body.appDir).toBe(fixture!.appDir);
  });
});

describe('GET /api/file', () => {
  test('returns file content with an app-relative POSIX path', async () => {
    const res = await request(appFor()).get('/api/file').query({ path: 'lib/stack.ts' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ path: 'lib/stack.ts', stale: false });
    expect(res.body.content).toContain('class Stack {}');
  });

  test('requires a path parameter', async () => {
    expect((await request(appFor()).get('/api/file')).status).toBe(400);
  });

  test('rejects traversal out of the app dir', async () => {
    const res = await request(appFor()).get('/api/file').query({ path: '../../../etc/passwd' });

    expect(res.status).toBe(403);
  });

  test('returns 404 for a missing file', async () => {
    expect((await request(appFor()).get('/api/file').query({ path: 'missing.ts' })).status).toBe(404);
  });

  test('returns 400 when the path is a directory', async () => {
    expect((await request(appFor()).get('/api/file').query({ path: 'lib' })).status).toBe(400);
  });

  test('rejects a binary file', async () => {
    const app = appFor();
    fs.writeFileSync(path.join(fixture!.appDir, 'bin.dat'), Buffer.from([0x00, 0x01, 0x02, 0x03]));

    expect((await request(app).get('/api/file').query({ path: 'bin.dat' })).status).toBe(415);
  });

  // The app dir is the whole project tree, so containment alone is not enough.
  test.each([
    ['.env', 'AWS_SECRET_ACCESS_KEY=hunter2\n'],
    ['.npmrc', '//registry.npmjs.org/:_authToken=secret\n'],
  ])('refuses to serve %s', async (name, content) => {
    const app = appFor();
    fs.writeFileSync(path.join(fixture!.appDir, name), content);

    const res = await request(app).get('/api/file').query({ path: name });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not readable/);
  });

  test('refuses a symlink whose innocuous name points at a denied file', async () => {
    const app = appFor();
    fs.writeFileSync(path.join(fixture!.appDir, '.env'), 'AWS_SECRET_ACCESS_KEY=hunter2\n');
    try {
      fs.symlinkSync(path.join(fixture!.appDir, '.env'), path.join(fixture!.appDir, 'config.ts'));
    } catch {
      return; // symlinks not permitted in this environment
    }

    expect((await request(app).get('/api/file').query({ path: 'config.ts' })).status).toBe(403);
  });

  test('rejects a symlink pointing outside the app dir', async () => {
    const app = appFor();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'cdk-explorer-outside-'));
    try {
      fs.writeFileSync(path.join(outside, 'secret.txt'), 'top secret');
      try {
        fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(fixture!.appDir, 'link.txt'));
      } catch {
        return; // symlinks not permitted in this environment
      }

      expect((await request(app).get('/api/file').query({ path: 'link.txt' })).status).toBe(403);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  test('flags a file modified after the staleness reference', async () => {
    const staleness = new StalenessTracker();
    // Reference well before the fixture was written, so everything reads stale.
    staleness.onAssemblyRefreshed(0);

    const res = await request(appFor({}, { staleness })).get('/api/file').query({ path: 'app.ts' });

    expect(res.status).toBe(200);
    expect(res.body.stale).toBe(true);
  });

  test('does not flag a file older than the staleness reference', async () => {
    const staleness = new StalenessTracker();
    staleness.onAssemblyRefreshed(Date.now() + 60_000);

    const res = await request(appFor({}, { staleness })).get('/api/file').query({ path: 'app.ts' });

    expect(res.body.stale).toBe(false);
  });
});

describe('GET /api/tree', () => {
  test('serves the construct tree with relativized locations', async () => {
    const res = await request(appFor(ONE_BUCKET)).get('/api/tree');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.timestamp).toBeGreaterThan(0);
    const [stack] = res.body.tree;
    expect(stack.path).toBe('MyStack');
    // The L1 leaf folds into its L2 parent.
    const [bucket] = stack.children;
    expect(bucket).toMatchObject({
      path: 'MyStack/Bucket',
      type: 'AWS::S3::Bucket',
      templateLocation: { file: 'MyStack.template.json', logicalId: 'Bucket123' },
      sourceLocation: { file: 'lib/stack.ts', line: 12, column: 5 },
    });
  });

  test('returns not-synthesized when no assembly exists', async () => {
    const res = await request(appFor({}, { assemblyDir: '/nonexistent/cdk.out' })).get('/api/tree');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'not-synthesized' });
  });

  test('returns 500 with a message when the assembly cannot be read', async () => {
    const app = appFor(ONE_BUCKET);
    fs.writeFileSync(path.join(fixture!.assemblyDir, 'manifest.json'), 'not json{{{');

    const res = await request(app).get('/api/tree');

    expect(res.status).toBe(500);
    expect(res.body.error).toBeTruthy();
  });

  test('re-reads once the manifest changes, and serves the cache until then', async () => {
    const app = appFor(ONE_BUCKET);

    const first = await request(app).get('/api/tree');
    const cached = await request(app).get('/api/tree');
    expect(cached.body.timestamp).toBe(first.body.timestamp);

    // Rewrite the stack with a different resource and bump the manifest mtime.
    const manifest = path.join(fixture!.assemblyDir, 'manifest.json');
    const future = new Date(Date.now() + 5_000);
    fs.writeFileSync(fixture!.templatePath('MyStack'), JSON.stringify({ Resources: { Renamed: { Type: 'AWS::SQS::Queue' } } }, undefined, 1));
    fs.utimesSync(manifest, future, future);

    const refreshed = await request(app).get('/api/tree');
    expect(refreshed.body.timestamp).not.toBe(first.body.timestamp);
  });
});

describe('GET /api/policy-validation', () => {
  test('normalizes violations joined to the construct tree', async () => {
    const app = appFor({
      ...ONE_BUCKET,
      reports: [{
        pluginName: 'cdk-validator',
        conclusion: 'failure',
        violations: [{
          ruleName: 'no-public-access',
          description: 'no public access',
          severity: 'error',
          violatingConstructs: [{
            constructPath: 'MyStack/Bucket/Resource',
            cloudFormationResource: { templatePath: 'ignored', logicalId: 'ignored', propertyPaths: ['Properties.Public'] },
          }],
        }],
      }],
    });

    const res = await request(app).get('/api/policy-validation');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.violations).toHaveLength(1);
    expect(res.body.violations[0]).toMatchObject({ ruleName: 'no-public-access', severity: 'error', source: 'cdk-validator' });
    expect(res.body.violations[0].occurrences[0]).toMatchObject({
      constructPath: 'MyStack/Bucket/Resource',
      logicalId: 'Bucket123',
      templateFile: 'MyStack.template.json',
      sourceLocations: [{ file: 'lib/stack.ts', line: 12, column: 5 }],
      propertyPaths: ['Properties.Public'],
    });
  });

  test('returns an empty list when the assembly has no report', async () => {
    const res = await request(appFor(ONE_BUCKET)).get('/api/policy-validation');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', violations: [] });
  });

  test('returns not-synthesized when no assembly exists', async () => {
    const res = await request(appFor({}, { assemblyDir: '/nonexistent/cdk.out' })).get('/api/policy-validation');

    expect(res.body).toEqual({ status: 'not-synthesized' });
  });
});

describe('GET /api/template', () => {
  test('serves template text with per-resource line ranges and source links', async () => {
    const app = appFor(ONE_BUCKET);

    const res = await request(app).get('/api/template').query({ file: 'MyStack.template.json' });

    expect(res.status).toBe(200);
    expect(res.body.content).toBe(fixture!.templateText('MyStack'));
    const resource = res.body.resources.Bucket123;
    expect(resource.block.startLine).toBeGreaterThan(0);
    expect(resource.block.endLine).toBeGreaterThanOrEqual(resource.block.startLine);
    expect(resource.source).toEqual({ file: 'lib/stack.ts', line: 12, column: 5 });
  });

  test('omits the source for a resource no construct claims', async () => {
    const app = appFor({
      stacks: [{
        id: 'MyStack',
        resources: [
          { path: 'Bucket/Resource', logicalId: 'Bucket123', type: 'AWS::S3::Bucket', at: 'lib/stack.ts:12:5' },
          // No creation stack, so nothing to link back to.
          { path: 'Topic/Resource', logicalId: 'Topic456', type: 'AWS::SNS::Topic' },
        ],
      }],
    });

    const res = await request(app).get('/api/template').query({ file: 'MyStack.template.json' });

    expect(res.body.resources.Bucket123.source).toBeDefined();
    expect(res.body.resources.Topic456).toBeDefined();
    expect(res.body.resources.Topic456.source).toBeUndefined();
  });

  test('requires a file parameter', async () => {
    expect((await request(appFor()).get('/api/template')).status).toBe(400);
  });

  test('rejects traversal out of the assembly dir', async () => {
    expect((await request(appFor()).get('/api/template').query({ file: '../../etc/passwd' })).status).toBe(403);
  });

  test('returns 404 for a missing template', async () => {
    expect((await request(appFor()).get('/api/template').query({ file: 'nope.template.json' })).status).toBe(404);
  });

  test('still serves the template when no assembly can be read', async () => {
    const app = appFor(ONE_BUCKET);
    const text = fixture!.templateText('MyStack');
    fs.rmSync(path.join(fixture!.assemblyDir, 'manifest.json'));

    const res = await request(app).get('/api/template').query({ file: 'MyStack.template.json' });

    // Ranges still resolve from the text; only the source join is lost.
    expect(res.status).toBe(200);
    expect(res.body.content).toBe(text);
    expect(res.body.resources.Bucket123.block.startLine).toBeGreaterThan(0);
    expect(res.body.resources.Bucket123.source).toBeUndefined();
  });

  // The assembly dir also holds staged assets, carrying whatever the app bundled.
  test.each([
    ['asset.abc/index.js', 'exports.handler = () => {};\n'],
    ['asset.abc/.env', 'AWS_SECRET_ACCESS_KEY=hunter2\n'],
  ])('refuses to serve %s', async (relPath, content) => {
    const app = appFor();
    const target = path.join(fixture!.assemblyDir, relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);

    const res = await request(app).get('/api/template').query({ file: relPath });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not a readable template/);
  });
});
