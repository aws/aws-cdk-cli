import type { StackDefinition } from '@aws-sdk/client-cloudformation';
import type { CloudFormationStack, CloudFormationTemplate, ResourceMapping } from './cloudformation';
import type { StackContainer } from './stack-container';
import { ToolkitError } from '../../toolkit/toolkit-error';

/**
 * Generates a list of stack definitions to be sent to the CloudFormation API
 * by applying each mapping to the corresponding stack template(s).
 */
export function generateStackDefinitions(
  mappings: ResourceMapping[],
  deployedStacks: CloudFormationStack[],
  localStacks: CloudFormationStack[],
): StackDefinition[] {
  const deployedTemplates = copyTemplates(deployedStacks);
  const deployedExports = buildExportMap(deployedTemplates);

  const localTemplates = copyTemplates(localStacks);
  const localExports = buildExportMap(localTemplates);

  mappings.forEach((mapping) => {
    const sourceStackName = mapping.source.stack.stackName;
    const sourceLogicalId = mapping.source.logicalResourceId;
    const sourceTemplate = deployedTemplates[sourceStackName];

    const destinationStackName = mapping.destination.stack.stackName;
    const destinationLogicalId = mapping.destination.logicalResourceId;
    if (deployedTemplates[destinationStackName] == null) {
      // The API doesn't allow anything in the template other than the resources
      // that are part of the mappings. So we need to create an empty template
      // to start adding resources to.
      deployedTemplates[destinationStackName] = { Resources: {} };
    }
    const destinationTemplate = deployedTemplates[destinationStackName];

    // Do the move
    if (destinationTemplate.Resources != null && sourceTemplate.Resources != null) {
      destinationTemplate.Resources[destinationLogicalId] = sourceTemplate.Resources[sourceLogicalId];
      delete sourceTemplate.Resources[sourceLogicalId];
    }

    checkExported(sourceStackName, sourceLogicalId, deployedExports);
    checkExported(destinationStackName, destinationLogicalId, localExports);

    if (isReferencedByOutput(sourceLogicalId, sourceTemplate.Outputs)) {
      throw new ToolkitError(
        `Resource ${sourceLogicalId} in stack ${sourceStackName} is referenced by an output. This use case is not supported yet.`,
      );
    }
  });

  Object.values(deployedTemplates).forEach((template) => {
    Object.values(template.Resources ?? {}).forEach((res) => replaceReferences(exports, mappings, res));
  });

  // CloudFormation doesn't allow empty stacks
  for (const [stackName, template] of Object.entries(deployedTemplates)) {
    if (Object.keys(template.Resources ?? {}).length === 0) {
      throw new ToolkitError(
        `Stack ${stackName} has no resources after refactor. You must add a resource to this stack. This resource can be a simple one, like a waitCondition resource type.`,
      );
    }
  }

  return Object.entries(deployedTemplates).map(([stackName, template]) => ({
    StackName: stackName,
    TemplateBody: JSON.stringify(template),
  }));

  function copyTemplates(stacks: CloudFormationStack[]): { [p: string]: CloudFormationTemplate } {
    return Object.fromEntries(
      stacks
        .filter((s) =>
          mappings.some(
            (m) =>
              // We only care about stacks that are part of the mappings
              m.source.stack.stackName === s.stackName || m.destination.stack.stackName === s.stackName,
          ),
        )
        .map((s) => [s.stackName, JSON.parse(JSON.stringify(s.template)) as CloudFormationTemplate]),
    );
  }

  function buildExportMap(templates: Record<string, CloudFormationTemplate>) {
    return (
      Object.fromEntries(
        Object.entries(templates).flatMap(([stackName, template]) =>
          Object.values(template.Outputs ?? {})
            .filter((output) => output.Export?.Name != null)
            .map((output: any) => [`${stackName}.${logicalIdFrom(output.Value)}`, output.Export?.Name]),
        ),
      ) ?? {}
    );
  }

  function logicalIdFrom(value: any) {
    if ('Ref' in value) {
      return value.Ref;
    } else if ('Fn::GetAtt' in value) {
      return Array.isArray(value['Fn::GetAtt']) ? value['Fn::GetAtt'][0] : value['Fn::GetAtt'].split('.')[0];
    }
    return undefined;
  }

  function checkExported(stackName: string, logicalId: string, exports: Record<string, string>) {
    // Not supported for now. We'll implement it later
    const isExported = Object.keys(exports).some((k) => k === `${stackName}.${logicalId}`);
    if (isExported) {
      throw new ToolkitError(
        `Resource ${logicalId} in stack ${stackName} is part of a cross-stack reference. This use case is not supported yet.`,
      );
    }
  }
}

function replaceReferences(exports: Record<string, string>, mappings: ResourceMapping[], value: any) {
  if (!value || typeof value !== 'object') return;

  if ('Ref' in value) {
    value.Ref = newValueOf(value.Ref);
  }
  if ('Fn::GetAtt' in value) {
    if (Array.isArray(value['Fn::GetAtt'])) {
      value['Fn::GetAtt'][0] = newValueOf(value['Fn::GetAtt'][0]);
    } else {
      const [id, att] = value['Fn::GetAtt'].split('.');
      value['Fn::GetAtt'] = `${newValueOf(id)}.${att}`;
    }
  }
  if ('DependsOn' in value) {
    if (Array.isArray(value.DependsOn)) {
      value.DependsOn = value.DependsOn.map(newValueOf);
    } else {
      value.DependsOn = newValueOf(value.DependsOn);
    }
  }
  if (Array.isArray(value)) {
    value.forEach((v) => replaceReferences(exports, mappings, v));
  }
  for (const v of Object.values(value)) {
    replaceReferences(exports, mappings, v);
  }

  function newValueOf(id: string) {
    const mapping = mappings.find((m) => m.source.logicalResourceId === id);
    return mapping?.destination.logicalResourceId ?? id;
  }
}

function isReferencedByOutput(sourceId: string, outputs: Record<string, any> = {}): boolean {
  return Object.values(outputs).some((output: any) => {
    const value = output.Value ?? {};
    if (value['Fn::GetAtt'] != null) {
      const refTarget = Array.isArray(value['Fn::GetAtt']) ? value['Fn::GetAtt'][0] : value['Fn::GetAtt'].split('.')[0];
      return refTarget === sourceId;
    }
    if (value.Ref != null) {
      return value.Ref === sourceId;
    }
    return false;
  });
}

export async function executeRefactor(mappings: ResourceMapping[], stackContainer: StackContainer): Promise<boolean> {
  return stackContainer.forEachEnvironment(async (cfn, deployedStacks, localStacks) => {
    const input = {
      EnableStackCreation: true,
      ResourceMappings: mappings.map((m) => m.toCloudFormation()),
      StackDefinitions: generateStackDefinitions(mappings, deployedStacks, localStacks),
    };
    const refactor = await cfn.createStackRefactor(input);

    await cfn.waitUntilStackRefactorCreateComplete({
      StackRefactorId: refactor.StackRefactorId,
    });

    await cfn.executeStackRefactor({
      StackRefactorId: refactor.StackRefactorId,
    });

    await cfn.waitUntilStackRefactorExecuteComplete({
      StackRefactorId: refactor.StackRefactorId,
    });
  });
}
