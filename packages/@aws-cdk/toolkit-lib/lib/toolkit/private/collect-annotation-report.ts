import * as cxapi from '@aws-cdk/cloud-assembly-api';
import type * as cxschema from '@aws-cdk/cloud-assembly-schema';
import type { StackCollection } from '../../api/cloud-assembly/stack-collection';

const ANNOTATION_PLUGIN_NAME = 'Construct Annotations';

/**
 * Collect annotation metadata (warnings and errors) from the construct tree
 * and convert them into a NamedValidationPluginReport that can be merged
 * into the same report pipeline as plugin violations.
 *
 * Effectively the same as what happens here:
 * <https://github.com/aws/aws-cdk/blob/main/packages/aws-cdk-lib/core/lib/private/collect-annotation-report.ts>
 */
export function collectAnnotationReport(stacks: StackCollection): cxschema.PluginReportJson {
  // The return type requires that we combine violations by rule, so we have to group them first here.
  const ruleMap = new Map<string, cxschema.PolicyViolationJson>();

  for (const stack of stacks.stackArtifacts) {
    for (const entry of stack.messages) {
      let severity: cxschema.PolicyViolationSeverity | undefined;

      switch (entry.level) {
        case cxapi.SynthesisMessageLevel.WARNING:
          severity = 'warning';
          break;
        case cxapi.SynthesisMessageLevel.ERROR:
          severity = 'error';
          break;
        case cxapi.SynthesisMessageLevel.INFO:
          severity = 'info';
          break;
      }

      const { message, ruleName } = splitDescriptionAndId(String(entry.entry.data));
      const ruleKey = `${ruleName}|${severity}|${message}`;
      let violation = ruleMap.get(ruleKey);
      if (!violation) {
        violation = {
          ruleName: ruleName ?? `${severity}-annotation`,
          description: message,
          severity,
          violatingConstructs: [],
          ruleMetadata: {
            'cdk:annotation': 'true',
          },
        };
        ruleMap.set(ruleKey, violation);
      }

      violation.violatingConstructs.push({
        constructPath: entry.id.replace(/^\//, ''), // remove leading slash

        // TODO: see if this information can be obtained from tree.json
        // cloudFormationResource
        // constructFqn:
        // libraryVersion

        // TODO: see if we can get this from metadata stack traces. We may need to re-enable them for
        // annotations in the core library. Otherwise we should probably get a stack trace to the resource itself.
        // stackTraces
      });
    }
  }

  const violations = Array.from(ruleMap.values());
  const hasErrors = violations.some(v => v.severity === 'error');
  return {
    pluginName: ANNOTATION_PLUGIN_NAME,
    conclusion: hasErrors ? 'failure' : 'success',
    violations,
  };
}

/**
 * Annotations have IDs in two places:
 *
 * - Warnings have `[ack:<id>]` in the message.
 * - Errors have `(<namespace>::<id>)` in the message.
 *
 * Separate the rule name from the rest of the description.
 */
function splitDescriptionAndId(message: string): { message: string; ruleName?: string } {
  const ackMatch = message.match(/\[ack: ([^\]]+)\]/);
  if (ackMatch) {
    return { message: message.replace(ackMatch[0], '').trim(), ruleName: ackMatch[1] };
  }

  const idMatch = message.match(/\(([^()]+::[^()]+)\)$/);
  if (idMatch) {
    return { message: message.replace(idMatch[0], '').trim(), ruleName: idMatch[1] };
  }

  return { message };
}
