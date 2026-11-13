import type * as cxapi from '@aws-cdk/cloud-assembly-api';
import { SynthesisMessageLevel } from '@aws-cdk/cloud-assembly-api';
import { loadUnifiedValidationReport } from '@aws-cdk/cloud-assembly-api/lib/validation/loading';
import type { PluginReportJson, PolicyValidationReportConclusion, ValidateResult } from '../../actions/validate';
import { type StackDetails } from '../../payloads/stack-details';
import { AssemblyError, ToolkitError } from '../../toolkit/toolkit-error';
import type { MinimumSeverity } from '../../toolkit/types';
import type { IoHelper } from '../io/private/io-helper';
import { hostMessageFromValidation } from '../validate/validate-formatting';

/**
 * A Cloud Assembly wrapper that stacks can be selected from
 */
export interface IStackAssembly {
  /**
   * The directory this CloudAssembly was read from
   */
  directory: string;

  /**
   * Select a single stack by its ID
   */
  stackById(stackId: string): StackCollection;
}

/**
 * A collection of stacks and related artifacts
 *
 * In practice, not all artifacts in the CloudAssembly are created equal;
 * stacks can be selected independently, but other artifacts such as asset
 * bundles cannot.
 */
export class StackCollection {
  constructor(public readonly assembly: IStackAssembly, public readonly stackArtifacts: cxapi.CloudFormationStackArtifact[]) {
  }

  public get stackCount() {
    return this.stackArtifacts.length;
  }

  public get firstStack() {
    if (this.stackCount < 1) {
      throw new ToolkitError('EmptyStackCollection', 'StackCollection contains no stack artifacts (trying to access the first one)');
    }
    return this.stackArtifacts[0];
  }

  public get stackIds(): string[] {
    return this.stackArtifacts.map(s => s.id);
  }

  public get hierarchicalIds(): string[] {
    return this.stackArtifacts.map(s => s.hierarchicalId);
  }

  public withDependencies(): StackDetails[] {
    const allData: StackDetails[] = [];

    for (const stack of this.stackArtifacts) {
      const data: StackDetails = {
        id: stack.displayName ?? stack.id,
        name: stack.stackName,
        environment: stack.environment,

        // Might be huge so load it lazily
        get metadata() {
          return stack.metadata;
        },
        dependencies: [],
      };

      for (const dependencyId of stack.dependencies.map(x => x.id)) {
        if (dependencyId.includes('.assets')) {
          continue;
        }

        const depStack = this.assembly.stackById(dependencyId);

        if (depStack.firstStack.dependencies.filter((dep) => !(dep.id).includes('.assets')).length > 0) {
          for (const stackDetail of depStack.withDependencies()) {
            data.dependencies.push({
              id: stackDetail.id,
              dependencies: stackDetail.dependencies,
            });
          }
        } else {
          data.dependencies.push({
            id: depStack.firstStack.displayName ?? depStack.firstStack.id,
            dependencies: [],
          });
        }
      }

      allData.push(data);
    }

    return allData;
  }

  public reversed() {
    const arts = [...this.stackArtifacts];
    arts.reverse();
    return new StackCollection(this.assembly, arts);
  }

  public filter(predicate: (art: cxapi.CloudFormationStackArtifact) => boolean): StackCollection {
    return new StackCollection(this.assembly, this.stackArtifacts.filter(predicate));
  }

  public concat(...others: StackCollection[]): StackCollection {
    return new StackCollection(this.assembly, this.stackArtifacts.concat(...others.map(o => o.stackArtifacts)));
  }

  /**
   * Extracts 'aws:cdk:warning|info|error' metadata entries from the stack synthesis
   *
   * @deprecated The formatting of this function is lackluster. Use `throwIfValidationFailures()` instead.
   */
  public async validateMetadata(
    failAt: 'warn' | 'error' | 'none' = 'error',
    logger: (level: 'info' | 'error' | 'warn', msg: cxapi.SynthesisMessage) => Promise<void> = async () => {
    },
  ) {
    let warnings = false;
    let errors = false;

    for (const stack of this.stackArtifacts) {
      for (const message of stack.messages) {
        switch (message.level) {
          case SynthesisMessageLevel.WARNING:
            warnings = true;
            await logger('warn', message);
            break;
          case SynthesisMessageLevel.ERROR:
            errors = true;
            await logger('error', message);
            break;
          case SynthesisMessageLevel.INFO:
            await logger('info', message);
            break;
        }
      }
    }

    if (errors && failAt != 'none') {
      const error = AssemblyError.withStacks('Found errors', this.stackArtifacts);
      error.attachSynthesisErrorCode('AnnotationErrors');
      throw error;
    }

    if (warnings && failAt === 'warn') {
      const error = AssemblyError.withStacks('Found warnings (--strict mode)', this.stackArtifacts);
      error.attachSynthesisErrorCode('StrictAnnotationWarnings');
      throw error;
    }
  }

  /**
   * A validation report that includes the new validation report, as well as the metadata-based annotations results.
   */
  public async unifiedValidationReport() {
    return loadUnifiedValidationReport(this.assembly, this.stackArtifacts);
  }

  /**
   * For operations that are NOT `cdk validate`, read the validation report and produce a failure if validation failed.
   *
   * Validation failed if there are any plugin reports with a failure conclusion, or if there are any warnings and the assembly is in strict mode.
   */
  public async reportValidationFailuresAndThrow(
    failAt: MinimumSeverity,
    ioHelper: IoHelper,
  ): Promise<void> {
    const pluginReports = await this.unifiedValidationReport();
    if (pluginReports.length === 0) {
      return;
    }

    const conclusion = combineConclusions(pluginReports);
    const result: ValidateResult = { conclusion, pluginReports };
    await ioHelper.notify(hostMessageFromValidation(process.cwd(), result));

    switch (failAt) {
      case 'error':
        if (conclusion === 'failure') {
          const error = AssemblyError.withStacks('Synthesis finished with errors', this.stackArtifacts);
          error.attachSynthesisErrorCode('AnnotationErrors');
          throw error;
        }
        break;
      case 'warn':
        // if we're failing at 'warn', then both warnings and errors cause failure, so the initial conclusion is correct
        if (conclusion === 'failure' || hasWarnings(pluginReports)) {
          const error = AssemblyError.withStacks('Synthesis finished with warnings (--strict mode)', this.stackArtifacts);
          error.attachSynthesisErrorCode('StrictAnnotationWarnings');
          throw error;
        }

        break;
      case 'none':
        // if we're not failing at all, then the conclusion is always success
        break;
    }
  }
}

function hasWarnings(reports: PluginReportJson[]): boolean {
  return reports.some((r) => r.violations.some((v) => v.severity === 'warning'));
}

/**
 * Return a success/failure conclusion from the given report
 */
export function combineConclusions(reports: PluginReportJson[]): PolicyValidationReportConclusion {
  const reportHasFailures = reports.some((r) => r.conclusion === 'failure');
  return reportHasFailures ? 'failure' : 'success';
}
