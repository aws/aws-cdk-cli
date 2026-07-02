import * as fs from 'fs/promises';
import * as path from 'path';
import { CdkIntegHelper } from '../../lib/runner';
import { IntegTest } from '../../lib/runner/integration-tests';
import { findTestSpecificContext } from '../../lib/runner/private/test-specific-context';

let mockCdk: any;
let tempDir: string;

beforeEach(async () => {
  mockCdk = {
    synthesize: jest.fn(),
    deploy: jest.fn(),
    destroy: jest.fn(),
  };

  tempDir = await fs.mkdtemp('cdk-integ-helper-test-');
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('can read context from integ.context.json in the same directory', async () => {
  // GIVEN
  await writeJson(path.join(tempDir, 'integ.context.json'), {
    key: 'value',
  });
  const helper = await makeHelper('test.js');

  // WHEN / THEN
  expect(helper.getContext()).toMatchObject({ key: 'value' });
});

test('can read context from cdk.json in the same directory', async () => {
  // GIVEN
  await writeJson(path.join(tempDir, 'cdk.json'), {
    context: {
      key: 'value',
    },
  });
  const helper = await makeHelper('test.js');

  // WHEN / THEN
  expect(helper.getContext()).toMatchObject({ key: 'value' });
});

test('integ.context.json takes precedence over cdk.json', async () => {
  // GIVEN
  await writeJson(path.join(tempDir, 'cdk.json'), {
    context: {
      cdkJsonKey: 'cdkJsonValue',
    },
  });
  await writeJson(path.join(tempDir, 'integ.context.json'), {
    integJsonKey: 'integJsonValue',
  });
  const helper = await makeHelper('test.js');

  // WHEN / THEN
  expect(helper.getContext()).toMatchObject({ integJsonKey: 'integJsonValue' });
  expect(helper.getContext()).not.toMatchObject({ cdkJsonKey: 'cdkJsonValue' });
});

test('can read context from parent directory', async () => {
  // GIVEN
  await writeJson(path.join(tempDir, 'integ.context.json'), {
    integJsonKey: 'integJsonValue',
  });
  const helper = await makeHelper('subdir/test.js');

  // WHEN / THEN
  expect(helper.getContext()).toMatchObject({ integJsonKey: 'integJsonValue' });
});

test('can read upwards from current directory', async () => {
  // GIVEN
  await writeJson(path.join(tempDir, 'integ.context.json'), {
    integJsonKey: 'integJsonValue',
  });

  const oldDir = process.cwd();
  const subdir = path.join(tempDir, 'subdir');
  await fs.mkdir(subdir, { recursive: true });

  process.chdir(subdir);
  try {
    // WHEN
    const context = await findTestSpecificContext('.');

    // THEN
    expect(context).toMatchObject({ integJsonKey: 'integJsonValue' });
  } finally {
    process.chdir(oldDir);
  }
});

async function makeHelper(relativePath: string) {
  const ret = CdkIntegHelper.create({
    cdk: mockCdk,
    test: new IntegTest({
      fileName: path.join(tempDir, relativePath),
      discoveryRoot: tempDir,
    }),
    showOutput: true,
    region: 'eu-west-1',
  });
  await ret.asyncInitialize();
  return ret;
}

async function writeJson(filePath: string, data: any): Promise<void> {
  const jsonString = JSON.stringify(data, null, 2);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, jsonString, 'utf-8');
}
