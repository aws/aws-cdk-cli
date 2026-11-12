import { Settings } from '../../lib/api/settings';
import type { Tag } from '../../lib/api/tags';
import { parseCommandLineArguments } from '../../lib/cli/parse-command-line-arguments';
import { Command, commandLineArgumentsToSettings } from '../../lib/cli/user-configuration';
import { TestIoHost } from '../_helpers/io-host';

const ioHelper = new TestIoHost().asHelper();

test('can parse string context from command line arguments', async () => {
  // GIVEN
  const settings1 = await commandLineArgumentsToSettings(ioHelper, { context: ['foo=bar'], _: [Command.DEPLOY] });
  const settings2 = await commandLineArgumentsToSettings(ioHelper, { context: ['foo='], _: [Command.DEPLOY] });

  // THEN
  expect(settings1.get(['context']).foo).toEqual( 'bar');
  expect(settings2.get(['context']).foo).toEqual( '');
});

test('can parse string context from command line arguments with equals sign in value', async () => {
  // GIVEN
  const settings1 = await commandLineArgumentsToSettings(ioHelper, { context: ['foo==bar='], _: [Command.DEPLOY] });
  const settings2 = await commandLineArgumentsToSettings(ioHelper, { context: ['foo=bar='], _: [Command.DEPLOY] });

  // THEN
  expect(settings1.get(['context']).foo).toEqual( '=bar=');
  expect(settings2.get(['context']).foo).toEqual( 'bar=');
});

describe('the debug flags map to separate debugApp/debugCli settings', () => {
  // The `debugApp` setting gates the CDK_DEBUG environment variable.
  // `--debug` implies both targets (resolved during argument parsing);
  // `--debug-app` / `--debug-cli` are independent.
  test('--debug enables both debugApp and debugCli', async () => {
    const argv = await parseCommandLineArguments(['deploy', '--debug']);
    const settings = await commandLineArgumentsToSettings(ioHelper, argv);
    expect(settings.get(['debugApp'])).toBe(true);
    expect(settings.get(['debugCli'])).toBe(true);
  });

  test('--debug-app enables only debugApp', async () => {
    const argv = await parseCommandLineArguments(['deploy', '--debug-app']);
    const settings = await commandLineArgumentsToSettings(ioHelper, argv);
    expect(settings.get(['debugApp'])).toBe(true);
    expect(settings.get(['debugCli'])).toBe(false);
  });

  test('--debug-cli enables only debugCli', async () => {
    const argv = await parseCommandLineArguments(['deploy', '--debug-cli']);
    const settings = await commandLineArgumentsToSettings(ioHelper, argv);
    expect(settings.get(['debugCli'])).toBe(true);
    expect(settings.get(['debugApp'])).toBe(false);
  });

  test('no debug flags leave both settings false', async () => {
    const argv = await parseCommandLineArguments(['deploy']);
    const settings = await commandLineArgumentsToSettings(ioHelper, argv);
    expect(settings.get(['debugApp'])).toBe(false);
    expect(settings.get(['debugCli'])).toBe(false);
  });
});

test('can parse tag values from command line arguments', async () => {
  // GIVEN
  const settings1 = await commandLineArgumentsToSettings(ioHelper, { tags: ['foo=bar'], _: [Command.DEPLOY] });
  const settings2 = await commandLineArgumentsToSettings(ioHelper, { tags: ['foo='], _: [Command.DEPLOY] });

  // THEN
  expect(settings1.get(['tags']).find((tag: Tag) => tag.Key === 'foo').Value).toEqual('bar');
  expect(settings2.get(['tags']).find((tag: Tag) => tag.Key === 'foo').Value).toEqual('');
});

test('can parse tag values from command line arguments with equals sign in value', async () => {
  // GIVEN
  const settings1 = await commandLineArgumentsToSettings(ioHelper, { tags: ['foo==bar='], _: [Command.DEPLOY] });
  const settings2 = await commandLineArgumentsToSettings(ioHelper, { tags: ['foo=bar='], _: [Command.DEPLOY] });

  // THEN
  expect(settings1.get(['tags']).find((tag: Tag) => tag.Key === 'foo').Value).toEqual('=bar=');
  expect(settings2.get(['tags']).find((tag: Tag) => tag.Key === 'foo').Value).toEqual('bar=');
});

test('bundling stacks defaults to an empty list', async () => {
  // GIVEN
  const settings = await commandLineArgumentsToSettings(ioHelper, {
    _: [Command.LIST],
  });

  // THEN
  expect(settings.get(['bundlingStacks'])).toEqual([]);
});

test('bundling stacks defaults to ** for deploy', async () => {
  // GIVEN
  const settings = await commandLineArgumentsToSettings(ioHelper, {
    _: [Command.DEPLOY],
  });

  // THEN
  expect(settings.get(['bundlingStacks'])).toEqual(['**']);
});

test('bundling stacks defaults to ** for watch', async () => {
  // GIVEN
  const settings = await commandLineArgumentsToSettings(ioHelper, {
    _: [Command.WATCH],
  });

  // THEN
  expect(settings.get(['bundlingStacks'])).toEqual(['**']);
});

test('bundling stacks defaults to ** for refactor', async () => {
  // GIVEN
  const settings = await commandLineArgumentsToSettings(ioHelper, {
    _: [Command.REFACTOR],
  });

  // THEN
  expect(settings.get(['bundlingStacks'])).toEqual(['**']);
});

test('bundling stacks with deploy exclusively', async () => {
  // GIVEN
  const settings = await commandLineArgumentsToSettings(ioHelper, {
    _: [Command.DEPLOY],
    exclusively: true,
    STACKS: ['cool-stack'],
  });

  // THEN
  expect(settings.get(['bundlingStacks'])).toEqual(['cool-stack']);
});

test('bundling stacks with watch exclusively', async () => {
  // GIVEN
  const settings = await commandLineArgumentsToSettings(ioHelper, {
    _: [Command.WATCH],
    exclusively: true,
    STACKS: ['cool-stack'],
  });

  // THEN
  expect(settings.get(['bundlingStacks'])).toEqual(['cool-stack']);
});

test('should include outputs-file in settings', async () => {
  // GIVEN
  const settings = await commandLineArgumentsToSettings(ioHelper, {
    _: [Command.DEPLOY],
    outputsFile: 'my-outputs-file.json',
  });

  // THEN
  expect(settings.get(['outputsFile'])).toEqual('my-outputs-file.json');
});

describe('ignoreDestructive', () => {
  test('is read from the command line', async () => {
    const settings = await commandLineArgumentsToSettings(ioHelper, {
      _: [Command.DEPLOY],
      ignoreDestructive: ['AWS::ApiGateway::Deployment'],
    });

    expect(settings.get(['ignoreDestructive'])).toEqual(['AWS::ApiGateway::Deployment']);
  });

  test('keeps the project setting when it is not given on the command line', async () => {
    const commandLine = await commandLineArgumentsToSettings(ioHelper, parseCommandLineArguments(['deploy']));
    const merged = new Settings({ ignoreDestructive: ['AWS::Lambda::Version'] }).merge(commandLine);

    expect(merged.get(['ignoreDestructive'])).toEqual(['AWS::Lambda::Version']);
  });

  test('replaces the project setting when it is given on the command line', async () => {
    const commandLine = await commandLineArgumentsToSettings(
      ioHelper,
      parseCommandLineArguments(['deploy', '--ignore-destructive', 'AWS::ApiGateway::Deployment']),
    );
    const merged = new Settings({ ignoreDestructive: ['AWS::Lambda::Version'] }).merge(commandLine);

    expect(merged.get(['ignoreDestructive'])).toEqual(['AWS::ApiGateway::Deployment']);
  });

  test('can be given more than once on the command line, for diff too', async () => {
    const commandLine = await commandLineArgumentsToSettings(
      ioHelper,
      parseCommandLineArguments(['diff', '--ignore-destructive', 'AWS::ApiGateway::Deployment', '--ignore-destructive', 'MyApi/Deployment']),
    );

    expect(commandLine.get(['ignoreDestructive'])).toEqual(['AWS::ApiGateway::Deployment', 'MyApi/Deployment']);
  });
});

test('providing a build arg', async () => {
  // GIVEN
  const settings = await commandLineArgumentsToSettings(ioHelper, {
    _: [Command.SYNTH],
    build: 'mvn package',
  });

  // THEN
  expect(settings.get(['build'])).toEqual('mvn package');
});
