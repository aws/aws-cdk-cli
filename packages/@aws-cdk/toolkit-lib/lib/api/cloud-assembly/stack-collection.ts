import type * as cxapi from '@aws-cdk/cloud-assembly-api';
import { SynthesisMessageLevel } from '@aws-cdk/cloud-assembly-api';
import type { IStackAssembly } from './stack-assembly';
import { type StackDetails } from '../../payloads/stack-details';
import { AssemblyError, ToolkitError } from '../../toolkit/toolkit-error';

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
      throw new ToolkitError('StackCollection contains no stack artifacts (trying to access the first one)');
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
      throw AssemblyError.withStacks('Found errors', this.stackArtifacts);
    }

    if (warnings && failAt === 'warn') {
      throw AssemblyError.withStacks('Found warnings (--strict mode)', this.stackArtifacts);
    }
  }
}
