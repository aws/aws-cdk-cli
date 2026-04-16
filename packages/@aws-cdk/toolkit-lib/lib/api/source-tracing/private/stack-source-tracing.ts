import { SourceTrace } from "../types";
import { ISourceTracer } from "./source-tracing";
import * as cxapi from '@aws-cdk/cloud-assembly-api';
import * as cxschema from '@aws-cdk/cloud-assembly-schema';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Use a stack artifact as the root for tracing problems with this deployment
 *
 * The stack can be either the stack itself, or a nested stack inside it.
 *
 * ## Strategy
 *
 * The first thing we need to do is translate the given resource to a
 * construct path.
 *
 * - The construct path can be found in the target template, if that option was
 *   enabled during synthesis; or
 * - We can (try to) dig it out of the `tree.json` once
 *   https://github.com/aws/aws-cdk/pull/37630 is merged (although we still
 *   need some information about the stack).
 *
 * Especially for nested stacks the above is hard, since this called from a
 * place where we only have CloudFormation information (stack name). The stack
 * name of a nested stack cannot be predicted in advance, and even if we have
 * the list of logical IDs to get to the nested stack (which we do), finding
 * the actual template is not easy.
 */
export class StackArtifactSourceTracer implements ISourceTracer {
  constructor(private readonly stack: cxapi.CloudFormationStackArtifact) {
  }

  public async traceResource(_stackName: string, nestedStackLogicalIds: string[], logicalId: string, propertyName?: string): Promise<SourceTrace | undefined> {
    const containingTemplate = getStackTemplate(this.stack, nestedStackLogicalIds);

    const constructPath = containingTemplate?.Resources?.[logicalId]?.Metadata?.[cxapi.PATH_METADATA_KEY];
    if (!constructPath) {
      return undefined;
    }

    return {
      constructPath,
      creationStackTrace: findCreationStackTrace(this.stack, constructPath),
      mutationStackTraces: propertyName ? findMutationStackTraces(this.stack, constructPath, propertyName) : undefined,
    };
  }

  public async traceStack(_stackName: string, nestedStackLogicalIds: string[]): Promise<SourceTrace | undefined> {
    // This can either be a stack or nested stack. If it's a nested stack, trace the resource
    // in the parent stack.
    if (nestedStackLogicalIds.length > 0) {
      const lastLogicalId = nestedStackLogicalIds.pop()!;
      return this.traceResource(_stackName, nestedStackLogicalIds, lastLogicalId);
    }

    // Must be the root stack
    const constructPath = this.stack.hierarchicalId;
    return {
      constructPath,
      creationStackTrace: findCreationStackTrace(this.stack, constructPath),
    };
  }
}

/**
 * Try to find the creation stack trace for the given construct
 *
 * - This can be the 'trace' of adding the 'aws:cdk:logicalId' metadata.
 * - This can also be dedicated metadata (we haven't added it yet).
 *
 * The construct path in metadata ALWAYS starts with a `/` while the construct path
 * we have here probably doesn't, account for that as well.
 *
 * Stack's currently don't emit any stack traces.
 */
function findCreationStackTrace(stack: cxapi.CloudFormationStackArtifact, constructPath: string): string[] | undefined {
  const candidates = [
    // logical ID traces
    ...resourceMetadata(stack, constructPath, cxschema.ArtifactMetadataEntryType.LOGICAL_ID).flatMap((m) => {
      if (m.trace) {
        return [m.trace];
      }
      return [];
    }),
    // Creation stack
    ...resourceMetadata(stack, constructPath, 'aws:cdk:creationStack').flatMap((m) => {
      if (m.data) {
        return [m.data as unknown as string[]];
      }
      return [];
    }),
  ];

  return candidates[0];
}

/**
 * Find property mutation stack traces
 *
 * These are all places in the code where a property's value is overwritten after
 * construct creation.
 */
function findMutationStackTraces(stack: cxapi.CloudFormationStackArtifact, constructPath: string, propertyName: string): string[][] | undefined {
  const assignments = resourceMetadata(stack, constructPath, 'aws:cdk:propertyAssignment');

  return assignments.flatMap((m) => {
    const data: PropertyAssignmentData | undefined = m.data as any;
    if (data?.propertyName === propertyName) {
      return [data.stackTrace];
    }
    return [];
  });
}

function resourceMetadata(stack: cxapi.CloudFormationStackArtifact, constructPath: string, metadataType: string): cxschema.MetadataEntry[] {
  if (!constructPath.startsWith('/')) {
    constructPath = '/' + constructPath;
  }

  return (stack.metadata[constructPath] ?? []).filter((m) => m.type === metadataType);
}


/**
 * Find the stack template given a root stack and a logical ID path into nested stacks
 */
function getStackTemplate(stack: cxapi.CloudFormationStackArtifact, logicalIdPath: readonly string[]): any | undefined {
  let template = stack.template;
  const segments = [...logicalIdPath];
  while (segments.length > 0) {
    const next = segments.shift()!;

    // The nested stack resource has metadata to tell us which (local) file
    // we are looking for: "aws:asset:path".
    const nextTemplateFile = template.Resources[next]?.Metadata?.[cxapi.ASSET_RESOURCE_METADATA_PATH_KEY];
    if (!nextTemplateFile) {
      return undefined;
    }

    const nextTemplatePath = path.join(path.dirname(stack.templateFullPath), nextTemplateFile);
    template = JSON.parse(fs.readFileSync(nextTemplatePath, 'utf-8'));
  }

  return template;
}

interface PropertyAssignmentData {
  propertyName: string;
  stackTrace: string[];
}