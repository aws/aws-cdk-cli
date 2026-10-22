import { convertConfigToUserInput, convertYargsToUserInput } from '../../lib/cli/convert-to-user-input';
import { parseCommandLineArguments } from '../../lib/cli/parse-command-line-arguments';

describe('yargs', () => {
  test('yargs object can be converted to cli arguments', async () => {
    const input = await parseCommandLineArguments(['deploy', '-R', '-v', '--ci']);

    const result = convertYargsToUserInput(input);

    expect(result).toEqual({
      command: 'deploy',
      globalOptions: {
        app: undefined,
        assetMetadata: undefined,
        build: undefined,
        caBundlePath: undefined,
        color: undefined,
        context: undefined,
        ignoreErrors: false,
        noColor: false,
        pathMetadata: undefined,
        plugin: undefined,
        profile: undefined,
        proxy: undefined,
        region: undefined,
        roleArn: undefined,
        staging: true,
        strict: undefined,
        telemetryFile: undefined,
        verbose: 1,
        versionReporting: undefined,
        ci: true,
        debug: false,
        debugApp: false,
        debugCli: false,
        ec2creds: undefined,
        lookups: true,
        trace: undefined,
        unstable: [],
        notices: undefined,
        output: undefined,
        yes: false,
      },
      deploy: {
        STACKS: undefined,
        all: false,
        assetParallelism: undefined,
        assetBuildConcurrency: 1,
        assetPrebuild: true,
        buildExclude: [],
        changeSetName: undefined,
        concurrency: 1,
        execute: undefined,
        exclusively: undefined,
        express: false,
        force: false,
        hotswap: undefined,
        hotswapEcsMaximumHealthyPercent: undefined,
        hotswapEcsMinimumHealthyPercent: undefined,
        hotswapEcsStabilizationTimeoutSeconds: undefined,
        hotswapFallback: undefined,
        ignoreNoStacks: false,
        importExistingResources: false,
        logs: true,
        method: undefined,
        monitoringTimeMinutes: undefined,
        notificationArns: undefined,
        outputsFile: undefined,
        parameters: [{}],
        previousParameters: true,
        progress: undefined,
        requireApproval: undefined,
        revertDrift: false,
        rollback: false,
        rollbackTriggerAlarmArns: undefined,
        tags: undefined,
        toolkitStackName: undefined,
        watch: undefined,
      },
    });
  });

  test('positional argument is correctly passed through -- variadic', async () => {
    const input = await parseCommandLineArguments(['deploy', 'stack1', 'stack2', '-R', '-v', '--ci']);

    const result = convertYargsToUserInput(input);

    expect(result).toEqual({
      command: 'deploy',
      deploy: expect.objectContaining({
        STACKS: ['stack1', 'stack2'],
      }),
      globalOptions: expect.anything(),
    });
  });

  test('positional argument is correctly passed through -- single', async () => {
    const input = await parseCommandLineArguments(['acknowledge', 'id1', '-v', '--ci']);

    const result = convertYargsToUserInput(input);

    expect(result).toEqual({
      command: 'acknowledge',
      acknowledge: expect.objectContaining({
        ID: 'id1',
      }),
      globalOptions: expect.anything(),
    });
  });

  test('hotswap ECS arguments are correctly parsed', async () => {
    const input = await parseCommandLineArguments([
      'deploy',
      '--hotswap',
      '--hotswap-ecs-minimum-healthy-percent', '100',
      '--hotswap-ecs-maximum-healthy-percent', '250',
      '--hotswap-ecs-stabilization-timeout-seconds', '300',
    ]);

    const result = convertYargsToUserInput(input);

    expect(result).toEqual({
      command: 'deploy',
      deploy: expect.objectContaining({
        hotswap: true,
        hotswapEcsMinimumHealthyPercent: 100,
        hotswapEcsMaximumHealthyPercent: 250,
        hotswapEcsStabilizationTimeoutSeconds: 300,
      }),
      globalOptions: expect.anything(),
    });
  });

  test('init --project-name is correctly passed through', async () => {
    const input = await parseCommandLineArguments(['init', 'app', '--language', 'typescript', '--project-name', 'my-app']);

    const result = convertYargsToUserInput(input);

    expect(result).toEqual({
      command: 'init',
      init: expect.objectContaining({
        projectName: 'my-app',
        TEMPLATE: 'app',
      }),
      globalOptions: expect.anything(),
    });
  });

  test('refactor --toolkit-stack-name is correctly passed through', async () => {
    const input = await parseCommandLineArguments(['refactor', '--toolkit-stack-name', 'MyCustomToolkit']);

    const result = convertYargsToUserInput(input);

    expect(result).toEqual({
      command: 'refactor',
      refactor: expect.objectContaining({
        toolkitStackName: 'MyCustomToolkit',
      }),
      globalOptions: expect.anything(),
    });
  });

  test.each([
    [['ls', '--json']],
    [['synth', '-j']],
    [['metadata', 'MyStack', '--json']],
    [['context', '--json']],
    [['bootstrap', '--show-template', '--json']],
  ])('--json is parsed for commands that support it: %p', async (args) => {
    const input = await parseCommandLineArguments(args);

    expect(input.json).toBe(true);
  });

  test('--json is no longer a global option', async () => {
    const input = await parseCommandLineArguments(['deploy']);

    const result = convertYargsToUserInput(input);

    expect(result.globalOptions).not.toHaveProperty('json');
  });

  test('--json is mapped to command options in UserInput', async () => {
    const input = await parseCommandLineArguments(['list', '--json']);

    const result = convertYargsToUserInput(input);

    expect(result.list?.json).toBe(true);
    expect(result.globalOptions).not.toHaveProperty('json');
  });

  test('unsupported --json on deploy remains in argv for unknown-option detection', async () => {
    // yargs still accepts unknown flags; findUnknownOptions reports them as a warning.
    const input = await parseCommandLineArguments(['deploy', '--json']);

    expect(input.json).toBe(true);
    expect(convertYargsToUserInput(input).globalOptions).not.toHaveProperty('json');
  });
});

describe('config', () => {
  test('command-scoped json from cdk.json is converted to UserInput', () => {
    const result = convertConfigToUserInput({
      synth: { json: true },
      context: { json: true },
    });

    expect(result.globalOptions).not.toHaveProperty('json');
    expect(result.synth?.json).toBe(true);
    expect(result.context?.json).toBe(true);
  });

  test('cdk.json arguments can be converted to cli arguments', async () => {
    const input = {
      output: 'blah.out',
      build: 'yarn build',
      list: {
        long: true,
      },
      bootstrap: {
        bootstrapBucketName: 'bucketName',
      },
    };

    const result = convertConfigToUserInput(input);

    expect(result).toEqual({
      globalOptions: expect.objectContaining({
        output: 'blah.out',
        build: 'yarn build',
      }),
      list: expect.objectContaining({
        long: true,
      }),
      bootstrap: expect.objectContaining({
        bootstrapBucketName: 'bucketName',
      }),
      context: expect.anything(),
      acknowledge: expect.anything(),
      deploy: expect.anything(),
      destroy: expect.anything(),
      diff: expect.anything(),
      drift: expect.anything(),
      init: expect.anything(),
      metadata: expect.anything(),
      migrate: expect.anything(),
      rollback: expect.anything(),
      publishAssets: expect.anything(),
      synth: expect.anything(),
      validate: expect.anything(),
      watch: expect.anything(),
      notices: expect.anything(),
      import: expect.anything(),
      gc: expect.anything(),
      flags: expect.anything(),
      doctor: expect.anything(),
      docs: expect.anything(),
      lsp: expect.anything(),
      orphan: expect.anything(),
      refactor: expect.anything(),
      cliTelemetry: expect.anything(),
      diagnose: expect.anything(),
    });
  });
});
