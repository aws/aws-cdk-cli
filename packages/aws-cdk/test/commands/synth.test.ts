import * as cxschema from '@aws-cdk/cloud-assembly-schema';
import type { FeatureFlag } from '@aws-cdk/toolkit-lib';
import { Toolkit } from '@aws-cdk/toolkit-lib';
import { Deployments } from '../../lib/api/deployments';
import { CdkToolkit } from '../../lib/cli/cdk-toolkit';
import { CliIoHost } from '../../lib/cli/io-host';
import { instanceMockFrom, MockCloudExecutable } from '../_helpers';
import type { TestAssembly } from '../_helpers';
import { IoHostRecorder } from '../_helpers/io-recorder';

// `cdk synth` prints the template of a single selected stack to stdout (or a
// success message for several stacks) and appends a feature-flags warning with
// CI/quiet-dependent gating. Its stdout is a scripting surface (must stay valid
// YAML in CI mode), so these tests run `CdkToolkit.synth` and snapshot
// everything the user sees (via IoHostRecorder) — the committed NDJSON is the
// assertion for selection, template rendering, message levels and gating.
//
// Coverage notes: the cli.ts argument mapping (settings-file `quiet` override,
// the `--exclusively` branch) sits above the entry point used here and is NOT
// pinned by these snapshots. Several scenarios are also asserted, spy-style, in
// test/cli/cdk-toolkit.test.ts describe('synth') — these snapshots are the
// authoritative record of the user-visible output.
describe('cdk synth', () => {
  const ioHost = CliIoHost.instance();
  let recorder: IoHostRecorder;

  // A flag that `FlagOperations.filterNeedsAttention` keeps (unconfigured, not
  // obsolete, unconfigured behavior differs from the recommended value), so
  // `displayFlagsMessage` deterministically emits its warning when not gated.
  const UNCONFIGURED_FLAG: FeatureFlag = {
    module: 'aws-cdk-lib',
    name: '@aws-cdk/testing:synthSnapshotFlag',
    recommendedValue: true,
    unconfiguredBehavesLike: { v2: false },
  };

  beforeEach(() => {
    jest.resetAllMocks();
    ioHost.isCI = false;
    ioHost.currentAction = 'synth';
    jest.spyOn(Toolkit.prototype, 'flags').mockResolvedValue([UNCONFIGURED_FLAG]);
    // The recorder observes the host (it does not spy on `notify`), so the real
    // notify path — and any output listeners — run without any pass-through.
    recorder = IoHostRecorder.create(ioHost);
  });

  afterEach(() => {
    recorder.matchSnapshot();
  });

  async function synth(
    assembly: TestAssembly,
    stackNames: string[],
    options: {
      exclusively?: boolean;
      quiet?: boolean;
      autoValidate?: boolean;
      json?: boolean;
      strict?: boolean;
      ignoreErrors?: boolean;
    } = {},
  ) {
    const cloudExecutable = await MockCloudExecutable.create(assembly, undefined, ioHost, 'synth');
    const toolkit = new CdkToolkit({
      ioHost,
      cloudExecutable,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
      deployments: instanceMockFrom(Deployments),
      strict: options.strict,
      ignoreErrors: options.ignoreErrors,
    });
    await toolkit.synth(
      stackNames,
      options.exclusively ?? true,
      options.quiet ?? false,
      options.autoValidate,
      options.json,
    );
  }

  const STACK_A = {
    stackName: 'Test-Stack-A',
    displayName: 'Test-Stack-A-Display-Name',
    // Rules.CheckBootstrapVersion must be obscured from the printed template
    template: {
      Resources: { TemplateName: 'Test-Stack-A' },
      Rules: { CheckBootstrapVersion: { Assertions: [] } },
    },
    env: 'aws://123456789012/bermuda-triangle-1',
  };

  const STACK_B = {
    stackName: 'Test-Stack-B',
    template: { Resources: { TemplateName: 'Test-Stack-B' } },
    env: 'aws://123456789012/bermuda-triangle-1',
  };

  const STACK_WITH_ERROR = {
    stackName: 'witherrors',
    displayName: 'Test-Stack-A/witherrors',
    env: 'aws://123456789012/bermuda-triangle-1',
    template: { resource: 'errorresource' },
    metadata: {
      '/resource': [
        {
          type: cxschema.ArtifactMetadataEntryType.ERROR,
          data: 'this is an error',
        },
      ],
    },
  };

  test('single stack prints the obscured YAML template and the flags warning', async () => {
    await synth({ stacks: [STACK_A] }, ['Test-Stack-A-Display-Name']);
  });

  test('single stack with --json prints the JSON template', async () => {
    await synth({ stacks: [STACK_A] }, ['Test-Stack-A-Display-Name'], { json: true });
  });

  test('single stack with --quiet prints no template but keeps the flags warning', async () => {
    await synth({ stacks: [STACK_A] }, ['Test-Stack-A-Display-Name'], { quiet: true });
  });

  test('multiple stacks print the success and supply-a-stack-id lines', async () => {
    await synth({ stacks: [STACK_A, STACK_B] }, []);
  });

  test('nested-assembly stacks are addressed by hierarchical id in the supply line', async () => {
    // Select the nested stack explicitly (the no-pattern default only selects
    // top-level stacks), so the snapshot pins the hierarchical-id handoff.
    await synth({
      stacks: [STACK_A, STACK_B],
      nestedAssemblies: [{
        stacks: [{
          stackName: 'nested',
          displayName: 'Test-Stack-A/nested',
          template: { Resources: { TemplateName: 'nested' } },
          env: 'aws://123456789012/bermuda-triangle-1',
        }],
      }],
    }, ['Test-Stack-A-Display-Name', 'Test-Stack-A/nested']);
  });

  test('stack ids containing glob metacharacters are handed to toolkit-lib literally', async () => {
    // 'Data[prod]' glob-matches 'Datap' when re-interpreted as a pattern, so an
    // unescaped id handoff would select both stacks and print the supply line
    // instead of the template. The snapshot must show Data[prod]'s template.
    await synth({
      stacks: [
        {
          stackName: 'DataProd',
          displayName: 'Data[prod]',
          template: { Resources: { TemplateName: 'Data[prod]' } },
          env: 'aws://123456789012/bermuda-triangle-1',
        },
        {
          stackName: 'Datap',
          template: { Resources: { TemplateName: 'Datap' } },
          env: 'aws://123456789012/bermuda-triangle-1',
        },
      ],
    }, ['Data\\[prod\\]']);
  });

  test('CI mode single stack skips the flags warning to keep stdout valid YAML', async () => {
    ioHost.isCI = true;
    await synth({ stacks: [STACK_A] }, ['Test-Stack-A-Display-Name']);
  });

  test('CI mode single stack with --quiet allows the flags warning', async () => {
    ioHost.isCI = true;
    await synth({ stacks: [STACK_A] }, ['Test-Stack-A-Display-Name'], { quiet: true });
  });

  test('explicitly selected stack with error annotations fails synthesis', async () => {
    await expect(synth({
      stacks: [STACK_A, STACK_B],
      nestedAssemblies: [{ stacks: [STACK_WITH_ERROR] }],
    }, ['Test-Stack-A/witherrors'], { quiet: true })).rejects.toThrow(/Synthesis finished with errors/);
  });

  test('a validateOnSynth stack with errors fails synth when validation is on', async () => {
    await expect(synth({
      stacks: [STACK_A, STACK_B],
      nestedAssemblies: [{ stacks: [{ ...STACK_WITH_ERROR, properties: { validateOnSynth: true } }] }],
    }, [], { quiet: true, autoValidate: true })).rejects.toThrow(/Synthesis finished with errors/);
  });

  test('a validateOnSynth stack with errors is tolerated with --no-validation', async () => {
    await synth({
      stacks: [STACK_A, STACK_B],
      nestedAssemblies: [{ stacks: [{ ...STACK_WITH_ERROR, properties: { validateOnSynth: true } }] }],
    }, [], { quiet: true, autoValidate: false });
  });

  test('an unmatched pattern fails with the historical error message', async () => {
    await expect(synth({ stacks: [STACK_A] }, ['NoSuchStack']))
      .rejects.toThrow(/No stacks match the name\(s\) NoSuchStack/);
  });

  test('a stage-only app selects no stacks and still succeeds', async () => {
    // Pipeline-style apps have no top-level stacks; the no-pattern MainAssembly
    // default selects nothing and synth must not fail.
    //
    // The snapshot deliberately pins the current output as-is, including the
    // awkward empty-parens "Supply a stack id ()" line — this is a baseline,
    // not an endorsement; fixing that wording should show up as a snapshot diff.
    await synth({
      stacks: [],
      nestedAssemblies: [{ stacks: [{ ...STACK_B, stackName: 'staged', displayName: 'MyStage/staged' }] }],
    }, []);
  });

  test('non-exclusive selection expands to upstream dependencies', async () => {
    // Selecting the dependent stack without --exclusively pulls in its
    // dependency, taking the multi-stack path.
    await synth({
      stacks: [
        STACK_B,
        {
          stackName: 'Test-Stack-D',
          template: { Resources: { TemplateName: 'Test-Stack-D' } },
          env: 'aws://123456789012/bermuda-triangle-1',
          depends: ['Test-Stack-B'],
        },
      ],
    }, ['Test-Stack-D'], { exclusively: false });
  });

  test('--strict fails synthesis on warning annotations', async () => {
    await expect(synth({
      stacks: [{
        ...STACK_B,
        metadata: {
          '/resource': [{ type: cxschema.ArtifactMetadataEntryType.WARN, data: 'this is a warning' }],
        },
      }],
    }, ['Test-Stack-B'], { quiet: true, strict: true })).rejects.toThrow(/Synthesis finished with warnings/);
  });

  test('--ignore-errors tolerates error annotations on a selected stack', async () => {
    await synth({
      stacks: [STACK_A, STACK_B],
      nestedAssemblies: [{ stacks: [STACK_WITH_ERROR] }],
    }, ['Test-Stack-A/witherrors'], { quiet: true, ignoreErrors: true });
  });
});
