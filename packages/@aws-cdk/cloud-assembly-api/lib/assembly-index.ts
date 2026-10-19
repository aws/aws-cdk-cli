import * as fs from 'fs';
import * as path from 'path';
import { type ViolatingConstructJson, ArtifactMetadataEntryType, CFN_RESOURCE_LOGICAL_ID_ATTRIBUTE, CFN_RESOURCE_PROPS_ATTRIBUTE, CFN_RESOURCE_TYPE_ATTRIBUTE, type MetadataEntry } from '@aws-cdk/cloud-assembly-schema';
import type { CloudFormationStackArtifact } from './artifacts/cloudformation-artifact';
import type { CloudAssembly } from './cloud-assembly';
import { type ForestFile, type TreeNode, type TreeFile, type TreeFileNode, isSubtreeReference, type ConstructInfo } from './tree-json-types';

/**
 * A construct from tree.json joined with the CloudFormation metadata of the
 * stack it belongs to: the construct path/id plus, for CFN resources, the
 * logical ID and resource type. Readers that need more (for example a source
 * location) extend this and build the richer tree via {@link buildConstructTree}.
 */
export interface AssemblyIndexNode {
  readonly constructPath: string;
  readonly id: string;
  readonly cfnResource: MaybeCloudFormationResource;
  readonly children: Record<string, AssemblyIndexNode>;
  readonly creationStack?: string[];

  /**
   * Construct class, if available from `tree.json`.
   */
  readonly constructInfo?: ConstructInfo;
}

export interface MaybeCloudFormationResource {
  /**
   * CFN resource type (e.g. "AWS::S3::Bucket"), if this construct is a CFN resource.
   *
   * Comes from `tree.json` if available.
   */
  readonly type?: string;

  /**
   * CFN logical ID
   *
   * Comes from either `tree.json` or metadata.
   *
   * This is usually the logical ID in the `Resources` section of the CloudFormation template,
   * but it may also be in the `Parameters` section or `Conditions` section; we don't have
   * enough information to tell.
   */
  readonly logicalId?: string;

  /**
   * Template file.
   *
   * Comes from metadata.
   */
  readonly assemblyRelativeTemplateFile?: string;

  /**
   * Resolved CloudFormation resource properties (the synthesized values from
   * the `aws:cdk:cloudformation:props` attribute), if this is a CFN resource.
   *
   * Comes from `tree.json` if available.
   */
  readonly cfnProperties?: Record<string, unknown>;
}

export interface AssemblyIndexViolation {
  readonly violation: ViolatingConstructJson;
  readonly node?: AssemblyIndexNode;
  readonly cfnResource?: ViolatingConstructJson['cloudFormationResource'];
  readonly stackTraces?: string[][];
}

/** The slice of a CloudFormation template the tree walk reads. */
interface CfnTemplate {
  readonly Resources?: Record<string, CfnResource>;
}
interface CfnResource {
  readonly Type?: string;
  readonly Metadata?: Record<string, unknown>;
}

/** A stack artifact plus its metadata Map, keyed (in the index) by construct path. */
interface StackMetadata {
  readonly stack: CloudFormationStackArtifact;
  readonly metadata: Map<string, MetadataEntry[]>;
  readonly assemblyRelativeTemplateFile: string;
}
type StackMetadataIndex = Map<string, StackMetadata>;

/**
 * An index of constructs, stacks and warnings.
 *
 * Combines information from:
 *
 * - the construct tree (tree.json);
 * - the CloudFormation stack metadata;
 * - the CloudFormation templates (this is unfortunately necessary to resolve the location
 *   of a resource in a nested stack template; we have no other way of finding this).
 */
export class AssemblyIndex {
  public static async fromAssembly(asm: CloudAssembly) {
    const index = new AssemblyIndex();
    await index.indexCloudAssembly(asm);
    return index;
  }

  private stackIndex: StackMetadataIndex = new Map();
  private templateCache: Map<string, CfnTemplate> = new Map();

  private templateFileFromProducer: Record<string, string> = {};

  /**
   * Maps assembly-relative template file paths to their root construct path.
   */
  private templateProducerFromFile: Record<string, string> = {};

  /**
   * Construct tree obtained from tree.json
   */
  private constructTree: AssemblyIndexNode = {
    constructPath: '',
    id: '',
    children: {},
    cfnResource: {},
  };

  public async indexCloudAssembly(asm: CloudAssembly) {
    await this.loadTreeJson(asm);
    await this.indexStacksAndMetadata(asm.directory, asm.stacksRecursively);
    await this.indexTemplateFiles(asm.directory);

    // If the built-in Tree node exists, delete it.
    this.deleteNodeByPath('Tree');
  }

  public get root() {
    return this.constructTree;
  }

  /**
   * Find a construct node by its path within the construct tree.
   *
   * Returns undefined if the node does not exist.
   *
   * Currently uses a tree walk, could be using a Map lookup if necessary for performance.
   */
  public byPath(constructPath: string): AssemblyIndexNode | undefined {
    const parts = this.pathParts(constructPath);
    let current: AssemblyIndexNode | undefined = this.constructTree;
    while (current && parts.length > 0) {
      const part = parts.shift()!;
      current = current.children[part];
    }
    return current;
  }

  /**
   * Find a construct node by its template file and logical ID.
   *
   * Returns undefined if the node does not exist.
   */
  public byTemplateLocation(assemblyRelativeTemplateFile: string, logicalId: string): AssemblyIndexNode | undefined {
    const rootConstruct = this.templateProducerFromFile[assemblyRelativeTemplateFile];
    if (!rootConstruct) {
      return undefined;
    }

    let found: AssemblyIndexNode | undefined;
    recurse.call(this, rootConstruct);
    return found;

    function recurse(this: AssemblyIndex, constructPath: string) {
      if (this.templateFileFromProducer[constructPath] && this.templateFileFromProducer[constructPath] !== assemblyRelativeTemplateFile) {
        return;
      }
      const node = this.byPath(constructPath);
      if (!node) {
        return;
      }
      if (node.cfnResource.logicalId === logicalId) {
        found = node;
        return;
      }

      for (const child of Object.values(node.children)) {
        recurse.call(this, child.constructPath);
        if (found) return;
      }
    }
  }

  public get firstLevelChildren() {
    return Object.values(this.constructTree.children);
  }

  public traceViolation(vio: ViolatingConstructJson): AssemblyIndexViolation {
    const node = this.byPath(vio.constructPath);
    const templateFile = node?.cfnResource.assemblyRelativeTemplateFile ?? vio.cloudFormationResource?.templatePath;

    const logicalId = node?.cfnResource.logicalId ?? vio.cloudFormationResource?.logicalId;
    const stackTraces = vio.stackTraces?.map(splitStackTrace) ?? (node?.creationStack ? [node.creationStack] : []);

    return {
      violation: vio,
      node,
      cfnResource: templateFile && logicalId ? {
        templatePath: templateFile,
        logicalId,
        propertyPaths: vio.cloudFormationResource?.propertyPaths,
      } : undefined,
      stackTraces,
    };
  }

  private async indexStacksAndMetadata(assemblyDir: string, stacks: CloudFormationStackArtifact[]) {
    for (const stack of stacks) {
      const metadata = new Map(Object.entries(stack.metadata));
      const assemblyRelativeTemplateFile = path.relative(assemblyDir, stack.templateFullPath);

      this.stackIndex.set(stack.hierarchicalId, { stack, metadata, assemblyRelativeTemplateFile });

      for (const [constructPath, entries] of metadata.entries()) {
        const node = this.obtainNode(constructPath);
        for (const entry of entries) {
          switch (entry.type) {
            case ArtifactMetadataEntryType.CREATION_STACK:
              mutable(node).creationStack = entry.data as string[];
              break;
            case ArtifactMetadataEntryType.LOGICAL_ID:
              if (!node.cfnResource.logicalId) {
                mutable(node.cfnResource).logicalId = entry.data as string;
              }
              // Creation stack can also be found on the trace of the logical ID metadata entry.
              if (!node.creationStack && entry.trace) {
                mutable(node).creationStack = entry.trace as string[];
              }
              break;

              // TODO: property mutations
          }
        }
      }

      // For every stack, delete any internal nodes that are not interesting to users
      this.deleteNodeByPath(`${stack.hierarchicalId}/CDKMetadata`);
      this.deleteNodeByPath(`${stack.hierarchicalId}/BootstrapVersion`);
      this.deleteNodeByPath(`${stack.hierarchicalId}/CheckBootstrapVersion`);
    }
  }

  /**
   * Try to find the template file for every CFN resource in the construct tree.
   *
   * Complicated *A LOT* by the fact that we need to parse CFN templates in
   * order to find the template file that contains resources in nested stacks; we
   * don't have this information readily in metadata. Grr.
   *
   * Instead, we are relying on `aws:cdk:path` and `aws:asset:path` in the CFN
   * template Metadata section to find this. This is all extremely non-amazing.
   */
  private async indexTemplateFiles(assemblyDir: string) {
    for (const [hierarchicalId, { assemblyRelativeTemplateFile }] of this.stackIndex.entries()) {
      this.templateFileFromProducer[hierarchicalId] = assemblyRelativeTemplateFile;
      await scanTemplate.call(this, assemblyRelativeTemplateFile);
    }

    // For every resource, tell it what template it's defined in by inheriting from its parent scope
    assignTemplateToNode.call(this, this.constructTree, undefined);

    // Record all the template roots so we can do the reverse mapping as well (template -> producer)
    // Also assign each producer the template file it produces with the special marker logical ID so
    // we can jump to it in a navigator.
    for (const [hierarchicalId, assemblyRelativeTemplateFile] of Object.entries(this.templateFileFromProducer)) {
      this.templateProducerFromFile[assemblyRelativeTemplateFile] = hierarchicalId;

      const producerResource = this.byPath(hierarchicalId)?.cfnResource;
      if (producerResource && !producerResource.assemblyRelativeTemplateFile && !producerResource.logicalId) {
        mutable(producerResource).logicalId = ENTIRE_TEMPLATE_LOGICALID_MARKER;
        mutable(producerResource).assemblyRelativeTemplateFile = assemblyRelativeTemplateFile;
      }
    }

    async function scanTemplate(this: AssemblyIndex, templateFile: string) {
      const template = await this.loadTemplate(path.join(assemblyDir, templateFile));
      for (const resource of Object.values(template.Resources ?? {})) {
        if (resource.Type === 'AWS::CloudFormation::Stack') {
          const stackResourceConstructPath = resource.Metadata?.['aws:cdk:path'] as string;
          const assetPath = resource.Metadata?.['aws:asset:path'] as string;

          if (stackResourceConstructPath && assetPath) {
            // Nested Stack Resource has a construct path like `/ParentStack/NestedStack/X.NestedStack/Resource`.
            const nestedStackResourceParts = stackResourceConstructPath.split('/').slice(0, -1);
            nestedStackResourceParts[nestedStackResourceParts.length - 1] = nestedStackResourceParts[nestedStackResourceParts.length - 1].replace(/\.NestedStack$/, '');
            const nestedStackConstructPath = nestedStackResourceParts.join('/');
            const templatePath = path.join(path.dirname(templateFile), assetPath);
            this.templateFileFromProducer[nestedStackConstructPath] = templatePath;

            await scanTemplate.call(this, templatePath);
          }
        }
      }
    }

    function assignTemplateToNode(this: AssemblyIndex, node: AssemblyIndexNode, templateFile: string | undefined) {
      if (node.cfnResource.logicalId && templateFile) {
        mutable(node.cfnResource).assemblyRelativeTemplateFile = templateFile;
      }
      for (const child of Object.values(node.children)) {
        assignTemplateToNode.call(this, child, this.templateFileFromProducer[node.constructPath] ?? templateFile);
      }
    }
  }

  private async loadTemplate(templateFullPath: string): Promise<CfnTemplate> {
    const existing = this.templateCache.get(templateFullPath);
    if (existing) {
      return existing;
    }

    let template: CfnTemplate;
    try {
      template = JSON.parse(await fs.promises.readFile(templateFullPath, 'utf-8')) as CfnTemplate;
    } catch {
      template = {};
    }
    this.templateCache.set(templateFullPath, template);
    return template;
  }

  private async loadTreeJson(assembly: CloudAssembly) {
    const treeArtifact = assembly.tree();
    if (!treeArtifact) {
      return;
    }

    const treeJsonTree = await loadTreeMetadata(path.join(assembly.directory, treeArtifact.file));
    if (treeJsonTree) {
      this.constructTree = constructIndexNodeFromTreeNode(treeJsonTree);
    }
  }

  /**
   * Obtain a node from the construct tree by its construct path.
   *
   * Creates the node if it doesn't exist.
   */
  private obtainNode(constructPath: string): AssemblyIndexNode {
    const parts = this.pathParts(constructPath);

    let current = this.constructTree;
    while (parts.length > 0) {
      const part = parts.shift()!;
      if (!current.children[part]) {
        current.children[part] = {
          constructPath: current.constructPath ? `${current.constructPath}/${part}` : part,
          id: part,
          children: {},
          cfnResource: {},
        };
      }
      current = current.children[part];
    }
    return current;
  }

  private deleteNodeByPath(constructPath: string): void {
    const parts = this.pathParts(constructPath);
    if (parts.length === 0) {
      // Can't delete the root
      return;
    }

    let current = this.constructTree;
    while (parts.length > 1) {
      const part = parts.shift()!;
      if (!current.children[part]) {
        return;
      }
      current = current.children[part];
    }
    delete current.children[parts[0]];
  }

  private pathParts(constructPath: string): string[] {
    if (constructPath.startsWith('/')) {
      constructPath = constructPath.slice(1);
    }
    return constructPath === '' ? [] : constructPath.split('/');
  }
}

/**
 * Turn a file-based TreeNode into a ConstructIndexNode.
 */
function constructIndexNodeFromTreeNode(treeNode: TreeNode): AssemblyIndexNode {
  return {
    constructPath: treeNode.path,
    id: treeNode.id,
    cfnResource: {
      type: treeNode.attributes?.[CFN_RESOURCE_TYPE_ATTRIBUTE] as string,
      logicalId: treeNode.attributes?.[CFN_RESOURCE_LOGICAL_ID_ATTRIBUTE] as string,
      cfnProperties: treeNode.attributes?.[CFN_RESOURCE_PROPS_ATTRIBUTE] as any,
    },
    constructInfo: treeNode.constructInfo,
    children: Object.fromEntries(Object.entries(treeNode.children ?? {}).map(
      ([key, value]) => [key, constructIndexNodeFromTreeNode(value)]),
    ),
  };
}

/**
 * Load a tree.json file into memory, expanding all subtree references
 */
async function loadTreeMetadata(treePath: string): Promise<TreeNode | undefined> {
  if (!fs.existsSync(treePath)) return undefined;
  const content: TreeFile = JSON.parse(await fs.promises.readFile(treePath, 'utf-8'));
  const forestCache: Record<string, ForestFile> = {};

  return recurse(content.tree);

  // Walk this tree and expand all forests
  async function recurse(node: TreeFileNode): Promise<TreeNode> {
    if (isSubtreeReference(node)) {
      const forestAbsPath = path.join(path.dirname(treePath), node.fileName);

      let forest = forestCache[forestAbsPath];
      if (!forest) {
        forest = JSON.parse(await fs.promises.readFile(forestAbsPath, 'utf-8'));
        forestCache[forestAbsPath] = forest;
      }
      return recurse(forest.forest[node.treeId] ?? {});
    } else {
      for (const [key, value] of Object.entries(node.children ?? {})) {
        node.children![key] = await recurse(value);
      }
      return node;
    }
  }
}

function mutable<A extends object>(x: A): { -readonly [k in keyof A]: A[k] } {
  return x;
}

function splitStackTrace(stackTrace: string): string[] {
  return stackTrace.split('\n');
}

/**
 * A logical ID marker used to represent the entire template in the construct tree.
 *
 * With this we can treat a template producer in the same flow as a "resource", where
 * the presence of a `logicalId` field indicates that it maps to a CloudFormation template.
 *
 * This marker contains characters that are not valid in a regular logical ID so it cannot conflict.
 */
export const ENTIRE_TEMPLATE_LOGICALID_MARKER = '<<Template>>';
