/* eslint-disable import/order */
import * as os from 'os';
import * as fs_path from 'path';
import * as fs from 'fs-extra';
import type { Arguments, Command } from '../../lib/cli/user-configuration';
import { Configuration, PROJECT_CONFIG, PROJECT_CONTEXT } from '../../lib/cli/user-configuration';
import { parseCommandLineArguments } from '../../lib/cli/parse-command-line-arguments';
import { TestIoHost } from '../_helpers/io-host';

// mock fs deeply
jest.mock('fs-extra');
const mockedFs = jest.mocked(fs, { shallow: true });

const USER_CONFIG = fs_path.join(os.homedir(), '.cdk.json');

const ioHost = new TestIoHost();
const ioHelper = ioHost.asHelper();

test('correctly parses hotswap overrides', async () => {
  const GIVEN_CONFIG: Map<string, any> = new Map([
    [PROJECT_CONFIG, {
      project: 'foobar',
    }],
    [USER_CONFIG, {
      project: 'foo',
      test: 'bar',
    }],
  ]);

  // WHEN
  mockedFs.pathExists.mockImplementation(path => {
    return GIVEN_CONFIG.has(path);
  });
  mockedFs.readJSON.mockImplementation(path => {
    return GIVEN_CONFIG.get(path);
  });

  const config = await Configuration.fromArgsAndFiles(ioHelper, {
    commandLineArguments: {
      _: ['deploy'] as unknown as [Command, ...string[]],
      hotswapEcsMinimumHealthyPercent: 50,
      hotswapEcsMaximumHealthyPercent: 250,
      hotswapEcsStabilizationTimeoutSeconds: 20,
    },
  });
  expect(config.settings.get(['hotswap', 'ecs', 'minimumHealthyPercent'])).toEqual(50);
  expect(config.settings.get(['hotswap', 'ecs', 'maximumHealthyPercent'])).toEqual(250);
  expect(config.settings.get(['hotswap', 'ecs', 'stabilizationTimeoutSeconds'])).toEqual(20);
});

test('load settings from both files if available', async () => {
  // GIVEN
  const GIVEN_CONFIG: Map<string, any> = new Map([
    [PROJECT_CONFIG, {
      project: 'foobar',
    }],
    [USER_CONFIG, {
      project: 'foo',
      test: 'bar',
    }],
  ]);

  // WHEN
  mockedFs.pathExists.mockImplementation(path => {
    return GIVEN_CONFIG.has(path);
  });
  mockedFs.readJSON.mockImplementation(path => {
    return GIVEN_CONFIG.get(path);
  });

  const config = await Configuration.fromArgsAndFiles(ioHelper);

  // THEN
  expect(config.settings.get(['project'])).toBe('foobar');
  expect(config.settings.get(['test'])).toBe('bar');
});

test('load context from all 3 files if available', async () => {
  // GIVEN
  const GIVEN_CONFIG: Map<string, any> = new Map([
    [PROJECT_CONFIG, {
      context: {
        project: 'foobar',
      },
    }],
    [PROJECT_CONTEXT, {
      foo: 'bar',
    }],
    [USER_CONFIG, {
      context: {
        test: 'bar',
      },
    }],
  ]);

  // WHEN
  mockedFs.pathExists.mockImplementation(path => {
    return GIVEN_CONFIG.has(path);
  });
  mockedFs.readJSON.mockImplementation(path => {
    return GIVEN_CONFIG.get(path);
  });

  const config = await Configuration.fromArgsAndFiles(ioHelper);

  // THEN
  expect(config.context.get('project')).toBe('foobar');
  expect(config.context.get('foo')).toBe('bar');
  expect(config.context.get('test')).toBe('bar');
});

test('throws an error if the `build` key is specified in the user config', async () => {
  // GIVEN
  const GIVEN_CONFIG: Map<string, any> = new Map([
    [USER_CONFIG, {
      build: 'foobar',
    }],
  ]);

  // WHEN
  mockedFs.pathExists.mockImplementation(path => {
    return GIVEN_CONFIG.has(path);
  });
  mockedFs.readJSON.mockImplementation(path => {
    return GIVEN_CONFIG.get(path);
  });

  // THEN
  await expect(Configuration.fromArgsAndFiles(ioHelper)).rejects.toEqual(new Error('The `build` key cannot be specified in the user config (~/.cdk.json), specify it in the project config (cdk.json) instead'));
});

test('Can specify the `quiet` key in the user config', async () => {
  // GIVEN
  const GIVEN_CONFIG: Map<string, any> = new Map([
    [USER_CONFIG, {
      quiet: true,
    }],
  ]);

  // WHEN
  mockedFs.pathExists.mockImplementation(path => {
    return GIVEN_CONFIG.has(path);
  });
  mockedFs.readJSON.mockImplementation(path => {
    return GIVEN_CONFIG.get(path);
  });

  // THEN
  const config = await Configuration.fromArgsAndFiles(ioHelper);

  expect(config.settings.get(['quiet'])).toBe(true);
});

test('array settings are not overridden by yarg defaults', async () => {
  // GIVEN
  const GIVEN_CONFIG: Map<string, any> = new Map([
    [PROJECT_CONFIG, {
      plugin: ['dummy'],
    }],
  ]);
  const argsWithPlugin: Arguments = await parseCommandLineArguments(['ls', '--plugin', '[]']);
  const argsWithoutPlugin: Arguments= await parseCommandLineArguments(['ls']);

  // WHEN
  mockedFs.pathExists.mockImplementation(path => {
    return GIVEN_CONFIG.has(path);
  });
  mockedFs.readJSON.mockImplementation(path => {
    return GIVEN_CONFIG.get(path);
  });

  const configWithPlugin = await Configuration.fromArgsAndFiles(ioHelper, { commandLineArguments: argsWithPlugin });
  const configWithoutPlugin = await Configuration.fromArgsAndFiles(ioHelper, { commandLineArguments: argsWithoutPlugin });

  // THEN
  expect(configWithPlugin.settings.get(['plugin'])).toEqual(['[]']);
  expect(configWithoutPlugin.settings.get(['plugin'])).toEqual(['dummy']);
});
