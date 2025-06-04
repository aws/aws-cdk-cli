import type { StackDefinition } from '@aws-sdk/client-cloudformation';
import {
  type CloudFormationResource,
  type CloudFormationStack,
  type CloudFormationTemplate,
  DependsOn,
  type ResourceMapping,
  type ResourceReference,
  resourceReferenceFromCfn,
} from './cloudformation';
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
  const localTemplates = cloneTemplates(localStacks);
  const localExports = indexExports(localStacks);

  const deployedTemplates = cloneTemplates(deployedStacks);
  const deployedExports = indexExports(deployedStacks);

  // First, remove from the local templates any resources that are not in the deployed templates
  iterate(localTemplates, (stackName, logicalResourceId) => {
    const location = correspondingLocation(stackName, logicalResourceId, 'backward');

    const deployedResource = deployedStacks.find((s) => s.stackName === location.stackName)?.template.Resources?.[
      location.logicalResourceId
    ];

    if (deployedResource == null) {
      delete localTemplates[stackName].Resources?.[logicalResourceId];
    } else {
      // We've got a deployed resource matching a local resource.
      // The final template should contain the deployed resource, but with local references.
      localTemplates[stackName].Resources![logicalResourceId] = updateReferences(
        deployedResource,
        location.stackName,
        mapper(mappings),
      );

      // After copying (an updated version of) the deployed resource,
      // we may end up with dangling dependencies. Sanitize them.
      sanitizeDependencies(localTemplates[stackName]);
    }
  });

  // Now do the opposite: add to the local templates any resources that are in the deployed templates
  iterate(deployedTemplates, (stackName, logicalResourceId, deployedResource) => {
    const location = correspondingLocation(stackName, logicalResourceId, 'forward');

    const resources = Object.entries(localTemplates).find(([name, _]) => name === location.stackName)?.[1].Resources;
    const localResource = resources?.[location.logicalResourceId];

    if (localResource == null) {
      if (localTemplates[stackName]?.Resources) {
        localTemplates[stackName].Resources[logicalResourceId] = deployedResource;
      }
    } else {
      // This is temporary, until CloudFormation supports CDK construct path updates in the refactor API
      if (localResource.Metadata != null) {
        localResource.Metadata['aws:cdk:path'] = deployedResource.Metadata?.['aws:cdk:path'];
      }
    }
  });

  for (const [stackName, template] of Object.entries(localTemplates)) {
    if (Object.keys(template.Resources ?? {}).length === 0) {
      // CloudFormation does not allow empty stacks
      throw new ToolkitError(
        `Stack ${stackName} has no resources after refactor. You must add a resource to this stack. This resource can be a simple one, like a waitCondition resource type.`,
      );
    }
  }

  return Object.entries(localTemplates)
    .filter(([stackName, _]) =>
      mappings.some((m) => {
        // Only send templates for stacks that are part of the mappings
        return m.source.stack.stackName === stackName || m.destination.stack.stackName === stackName;
      }),
    )
    .map(([stackName, template]) => ({
      StackName: stackName,
      TemplateBody: JSON.stringify(template),
    }));

  /**
   * Recursively updates references in the given value using the provided mapping function
   * to transform every reference found.
   */
  function updateReferences(
    value: any,
    stackName: string,
    mapReference: (r: ResourceReference) => ResourceReference,
  ): any {
    /*
    The key to understand this function is the following diagram:

                               e_d
                        A -------------> B
                        |                |
                        |                |
                        |      e_l       |
                        A' ------------> B'

    where the horizontal arrows are edges in the resource graphs: the top one is
    from the deployed graph, and the bottom one is the local graph. A, B, A' and B'
    refer to the location of resources. Vertical lines represent the mapping we are
    going to send to the refactor API.

    The goal of this function is to replace every edge e_d with the corresponding
    edge e_l, as in the diagram. In the simplest case, e_d is of the form {Ref: X}
    and e_l is of the form {Ref: Y}. We can obtain Y by a simple lookup in the
    mapping. In more complex cases, the edges can be cross stack references. In such
    cases, the reference is of the form {Fn::ImportValue: X}, and therefore there is
    an additional level of indirection we have to deal with. If the deployed edge is
    a cross-stack reference, we start with X, find the exported value, and then do
    the mapping. If the local edge is cross-stack, we do the reverse lookup:
    from the value, find the export name.
     */

    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
      return value.map((x) => updateReferences(x, stackName, mapReference));
    }

    if ('Ref' in value || 'Fn::GetAtt' in value) {
      const ref = resourceReferenceFromCfn(stackName, value);
      return resolveLocalReference(ref);
    }

    if ('Fn::ImportValue' in value) {
      const exportName = value['Fn::ImportValue'];
      const ref = deployedExports[exportName];
      return resolveLocalReference(ref);
    }

    if ('DependsOn' in value) {
      const update = (id: string) => resolveLocalReference(DependsOn.fromString(stackName, id));

      value.DependsOn = typeof value.DependsOn === 'string'
        ? update(value.DependsOn)
        : value.DependsOn.map(update);
    }
    const result: any = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = updateReferences(v, stackName, mapReference);
    }
    return result;

    /**
     * Given a deployed reference, resolve the corresponding local reference
     * as a CloudFormation import value or a local reference.
     */
    function resolveLocalReference(deployedRef: ResourceReference) {
      const localRef = mapReference(deployedRef);
      const exp = Object.entries(localExports).find(([_, r]) => localRef.equals(r));
      if (exp != null) {
        return { 'Fn::ImportValue': exp[0] };
      }
      return localRef.toCfn();
    }
  }

  /**
   * Updates the DependsOn property of all resources, removing references
   * to resources that do not exist in the template. If a resource's
   * DependsOn property ends up empty or undefined, it is removed.
   */
  function sanitizeDependencies(template: CloudFormationTemplate) {
    const resources = template.Resources ?? {};
    for (const resource of Object.values(resources)) {
      if (typeof resource.DependsOn === 'string' && resources[resource.DependsOn] == null) {
        delete resource.DependsOn;
      }

      if (Array.isArray(resource.DependsOn)) {
        resource.DependsOn = resource.DependsOn.filter((dep) => resources[dep] != null);
        if (resource.DependsOn.length === 0) {
          delete resource.DependsOn;
        }
      }
    }
  }

  /**
   * The location of a resource in the opposite set of stacks (local vs. deployed).
   */
  function correspondingLocation(stackName: string, logicalResourceId: string, direction: 'forward' | 'backward') {
    const from = direction === 'forward' ? 'source' : 'destination';
    const to = direction === 'forward' ? 'destination' : 'source';
    const mapping = mappings.find(
      (m) => m[from].stack.stackName === stackName && m[from].logicalResourceId === logicalResourceId,
    );
    return mapping != null
      ? { stackName: mapping[to].stack.stackName, logicalResourceId: mapping[to].logicalResourceId }
      : { stackName, logicalResourceId };
  }

  function iterate(
    templates: Record<string, CloudFormationTemplate>,
    cb: (stackName: string, logicalResourceId: string, resource: CloudFormationResource) => void,
  ) {
    Object.entries(templates).forEach(([stackName, template]) => {
      Object.entries(template.Resources ?? {}).forEach(([logicalResourceId, resource]) => {
        cb(stackName, logicalResourceId, resource);
      });
    });
  }
}

function mapper(mappings: ResourceMapping[]): (r: ResourceReference) => ResourceReference {
  return (r: ResourceReference): ResourceReference => {
    for (const mapping of mappings) {
      if (mapping.source.logicalResourceId === r.logicalResourceId && mapping.source.stack.stackName === r.stackName) {
        const logicalResourceId = mapping.destination.logicalResourceId;
        const stackName = mapping.destination.stack.stackName;
        return r.map(stackName, logicalResourceId);
      }
    }
    return r;
  };
}

function indexExports(stacks: CloudFormationStack[]): Record<string, ResourceReference> {
  return Object.fromEntries(
    stacks.flatMap((s) =>
      Object.values(s.template.Outputs ?? {})
        .filter((o) => typeof o.Export?.Name === 'string')
        .map((o) => {
          const ref = resourceReferenceFromCfn(s.stackName, o.Value);
          return [o.Export.Name, ref];
        }),
    ),
  );
}

function cloneTemplates(stacks: CloudFormationStack[]) {
  return Object.fromEntries(
    stacks.map((s) => [s.stackName, JSON.parse(JSON.stringify(s.template)) as CloudFormationTemplate]),
  );
}
