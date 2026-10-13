import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AssemblyIndex, CloudAssembly } from '@aws-cdk/cloud-assembly-api';
import type { PluginReportJson } from '@aws-cdk/cloud-assembly-schema';
import { AssemblyIndexWithSourceLocations } from '../../lib/core/assembly-index-with-source-locations';

/**
 * Builds a real cloud assembly on disk and indexes it, so tests exercise the
 * production read path (manifest + tree.json + templates) instead of
 * hand-shaped node objects.
 *
 * Deliberately only models flat stacks: nested stacks, Stages and template
 * resolution are `AssemblyIndex`'s job and are covered in the
 * `@aws-cdk/cloud-assembly-api` suite. What matters here is how the explorer
 * layers on top of an index, so this keeps the fixture to the smallest shape
 * that produces one.
 */
export interface ResourceSpec {
  /** Construct path below its stack, e.g. `Bucket/Resource`. */
  readonly path: string;
  readonly logicalId: string;
  /** CFN type. Omit to model a construct that is not a CFN resource. */
  readonly type?: string;
  /**
   * Creation site as `<file>:<line>[:<column>]`, the file app-relative. Omit to
   * model a non-TypeScript app, where no creation stack is recorded.
   */
  readonly at?: string;
  /** Resolved CFN properties, as tree.json records them. */
  readonly props?: Record<string, unknown>;
}

export interface StackSpec {
  readonly id: string;
  readonly resources?: readonly ResourceSpec[];
}

export interface AssemblySpec {
  readonly stacks?: readonly StackSpec[];
  /** Written to `validation-report.json`. */
  readonly reports?: readonly PluginReportJson[];
  /** Extra files to create in the app dir, keyed by app-relative path. */
  readonly sourceFiles?: Record<string, string>;
  /** Omit `tree.json`, leaving only manifest metadata to index from. */
  readonly withoutTree?: boolean;
}

/** A tree.json node under construction (children keyed by construct id). */
interface MutableTreeNode {
  id: string;
  path: string;
  children: Record<string, MutableTreeNode>;
  attributes?: Record<string, unknown>;
}

export class AssemblyFixture {
  public static create(spec: AssemblySpec = {}): AssemblyFixture {
    // realpath: on macOS os.tmpdir() is a symlink, and the index relativizes
    // creation-stack paths against appDir, so the two must agree.
    const appDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cdk-explorer-')));
    const assemblyDir = path.join(appDir, 'cdk.out');
    fs.mkdirSync(assemblyDir);

    for (const [relPath, content] of Object.entries(spec.sourceFiles ?? {})) {
      const full = path.join(appDir, relPath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }

    const artifacts: Record<string, unknown> = {};
    const root: MutableTreeNode = { id: 'App', path: '', children: {} };

    for (const stack of spec.stacks ?? []) {
      const metadata: Record<string, unknown[]> = {};
      const resources: Record<string, unknown> = {};

      for (const resource of stack.resources ?? []) {
        const constructPath = `${stack.id}/${resource.path}`;
        const entries: unknown[] = [];
        if (resource.at) {
          entries.push({ type: 'aws:cdk:creationStack', data: creationStack(appDir, resource.at) });
        }
        entries.push({ type: 'aws:cdk:logicalId', data: resource.logicalId });
        metadata[`/${constructPath}`] = entries;

        if (resource.type) {
          resources[resource.logicalId] = {
            Type: resource.type,
            ...(resource.props ? { Properties: resource.props } : {}),
          };
        }
        insert(root, constructPath, resource);
      }

      artifacts[stack.id] = {
        type: 'aws:cloudformation:stack',
        environment: 'aws://111111111111/us-east-1',
        properties: { templateFile: templateFileFor(stack.id) },
        displayName: stack.id,
        metadata,
      };
      // Indented so resource blocks span several lines, which is what makes the
      // template line ranges in these tests meaningful.
      write(assemblyDir, templateFileFor(stack.id), { Resources: resources });
    }

    if (!spec.withoutTree) {
      artifacts.Tree = { type: 'cdk:tree', properties: { file: 'tree.json' } };
      write(assemblyDir, 'tree.json', { version: 'tree-0.1', tree: root });
    }

    write(assemblyDir, 'manifest.json', { version: '0.0.0', artifacts });

    if (spec.reports) {
      write(assemblyDir, 'validation-report.json', { version: '1.0.0', pluginReports: spec.reports });
    }

    return new AssemblyFixture(appDir, assemblyDir);
  }

  private constructor(
    public readonly appDir: string,
    public readonly assemblyDir: string,
  ) {
  }

  /** Index the assembly exactly as production does. */
  public async index(): Promise<AssemblyIndexWithSourceLocations> {
    return new AssemblyIndexWithSourceLocations({
      appDir: this.appDir,
      assemblyDir: this.assemblyDir,
      assemblyIndex: await AssemblyIndex.fromAssembly(new CloudAssembly(this.assemblyDir)),
    });
  }

  /** Absolute path of a source file in the app dir. */
  public sourcePath(relPath: string): string {
    return path.join(this.appDir, relPath);
  }

  /** Assembly-relative template name for a stack. */
  public templateFile(stackId: string): string {
    return templateFileFor(stackId);
  }

  public templatePath(stackId: string): string {
    return path.join(this.assemblyDir, templateFileFor(stackId));
  }

  public templateText(stackId: string): string {
    return fs.readFileSync(this.templatePath(stackId), 'utf-8');
  }

  public cleanup(): void {
    fs.rmSync(this.appDir, { recursive: true, force: true });
  }
}

function templateFileFor(stackId: string): string {
  return `${stackId}.template.json`;
}

function write(dir: string, relPath: string, content: unknown): void {
  fs.writeFileSync(path.join(dir, relPath), JSON.stringify(content, undefined, 1));
}

/**
 * A "Just My Code" creation stack whose only user frame is `at`. The leading
 * frame mimics the redacted aws-cdk-lib frames, so the default frame finder has
 * something to skip past. File names are absolute, as a real capture records them.
 */
function creationStack(appDir: string, at: string): string[] {
  const match = /^(.*?):(\d+)(?::(\d+))?$/.exec(at);
  if (!match) {
    throw new Error(`creation site must be '<file>:<line>[:<column>]', got '${at}'`);
  }
  const [, file, line, column] = match;
  const absolute = path.isAbsolute(file) ? file : path.join(appDir, file);
  return [
    '...aws-cdk-lib...',
    `myConstruct (${absolute}:${line}${column ? `:${column}` : ''})`,
  ];
}

/** Insert a construct path into the tree, creating intermediate wrapper nodes. */
function insert(root: MutableTreeNode, constructPath: string, resource: ResourceSpec): void {
  const segments = constructPath.split('/');
  let node = root;
  let walked = '';
  for (const segment of segments) {
    walked = walked ? `${walked}/${segment}` : segment;
    node.children[segment] ??= { id: segment, path: walked, children: {} };
    node = node.children[segment];
  }
  if (resource.type) {
    node.attributes = {
      'aws:cdk:cloudformation:type': resource.type,
      ...(resource.props ? { 'aws:cdk:cloudformation:props': resource.props } : {}),
    };
  }
}
