import { pathToFileURL } from 'url';
import { type ConstructIndex, indexTemplateRanges, type OffsetRange, type TemplateRanges } from '@aws-cdk/cloud-assembly-api';
import { type Hover, MarkupKind, type Position, type Range } from 'vscode-languageserver/node';
import { isResourceOnFile, type ResourceConstruct } from './codelens';
import { offsetsToRange } from './positions';
import type { ConstructNode } from '../core/assembly-reader';

/** A clickable template target: a file URI and a 1-based line. */
export interface LinkTarget {
  readonly uri: string;
  readonly line: number;
}

/**
 * Template line targets for a hover, resolved from the synthesized template(s).
 * `blocks` is keyed by construct path (the hovered resource and its auxiliaries);
 * paths are globally unique, where stack-relative logical ids can collide across
 * templates. `properties` is keyed by the template (PascalCase) property name of
 * the primary resource. Absent when the template can't be read, in which case
 * values render without links.
 */
export interface HoverLinks {
  readonly blocks: Record<string, LinkTarget>;
  readonly properties: Record<string, LinkTarget>;
}

/** A construct line's primary resource (its default child) and its other resources. */
export interface PrimarySelection {
  readonly primary: ResourceConstruct;
  readonly others: readonly ResourceConstruct[];
}

/** Top-level properties shown before truncating with a "+N more" line. */
const MAX_PROPERTIES = 12;
/** Auxiliary resources listed individually before collapsing to a type histogram. */
const MAX_LINKED_AUX = 5;
/** Characters of a string value shown before truncating with an ellipsis. */
const MAX_STRING_LENGTH = 60;
/** Object keys previewed inline before collapsing with an ellipsis. */
const MAX_OBJECT_KEYS = 4;
/** Distinct CFN types shown in an auxiliary histogram before "+N more". */
const MAX_HISTOGRAM_TYPES = 6;

/**
 * Resource nodes whose creation line is the hovered position in `uri`. Reuses
 * the CodeLens resource predicate, narrowed to the single hovered line.
 */
export function resourceNodesOnLine(
  index: ConstructIndex<ConstructNode>,
  uri: string,
  position: Position,
): ResourceConstruct[] {
  // sourceLocation is 1-based; LSP positions are 0-based.
  const line = position.line + 1;
  return [...index].filter(
    (node): node is ResourceConstruct => isResourceOnFile(node, uri) && node.sourceLocation.line === line,
  );
}

/**
 * Resolves the resource(s) on the hovered line and builds their hover, reading
 * each referenced template once (via the injected seam) to resolve block and
 * property link targets. Returns undefined when no resource maps to the line.
 */
export async function hoverForPosition(
  index: ConstructIndex<ConstructNode>,
  uri: string,
  position: Position,
  readTemplate: (file: string) => Promise<string | undefined>,
): Promise<Hover | undefined> {
  const nodes = resourceNodesOnLine(index, uri, position);
  if (nodes.length === 0) {
    return undefined;
  }
  // Select the primary once and thread it through both link resolution and
  // rendering, so a single place owns "which resource is canonical".
  const selection = selectPrimary(nodes);
  const links = await resolveHoverLinks(nodes, selection?.primary, readTemplate);
  const range: Range = {
    start: { line: position.line, character: 0 },
    end: { line: position.line, character: Number.MAX_VALUE },
  };
  return buildHover(nodes, selection, links, range);
}

/** A template read and parsed once: its text (for offset->line) and its range index. */
interface ResolvedTemplate {
  readonly text: string;
  readonly ranges: TemplateRanges;
}

/**
 * Resolves the link targets for a hover: every resource's block, plus the
 * primary resource's per-property lines. Each referenced template is read and
 * parsed at most once, so a multi-resource construct whose resources share one
 * template (for example a VPC and its dozens of auxiliaries) pays a single
 * parse. Blocks are keyed by construct path, which is globally unique, because
 * stack-relative logical ids can collide across templates.
 */
async function resolveHoverLinks(
  nodes: readonly ResourceConstruct[],
  primary: ResourceConstruct | undefined,
  readTemplate: (file: string) => Promise<string | undefined>,
): Promise<HoverLinks> {
  const templates = new Map<string, ResolvedTemplate | undefined>();
  const resolveOnce = async (file: string): Promise<ResolvedTemplate | undefined> => {
    if (!templates.has(file)) {
      const text = await readTemplate(file);
      const ranges = text === undefined ? undefined : indexTemplateRanges(text);
      templates.set(file, text !== undefined && ranges !== undefined ? { text, ranges } : undefined);
    }
    return templates.get(file);
  };

  const blocks: Record<string, LinkTarget> = {};
  const properties: Record<string, LinkTarget> = {};
  for (const node of nodes) {
    if (node.templateFile === undefined) {
      continue;
    }
    const template = await resolveOnce(node.templateFile);
    if (template === undefined) {
      continue;
    }
    const uri = pathToFileURL(node.templateFile).toString();
    if (node === primary) {
      const resource = template.ranges.resource(node.logicalId);
      if (resource === undefined) {
        continue;
      }
      blocks[node.path] = { uri, line: lineOf(template.text, resource.block) };
      for (const [name, range] of Object.entries(resource.properties)) {
        properties[name] = { uri, line: lineOf(template.text, range) };
      }
    } else {
      const block = template.ranges.block(node.logicalId);
      if (block !== undefined) {
        blocks[node.path] = { uri, line: lineOf(template.text, block) };
      }
    }
  }
  return { blocks, properties };
}

/** 1-based template line of a range's start (the file: `#L` fragment is 1-based). */
function lineOf(text: string, range: OffsetRange): number {
  return offsetsToRange(text, range).start.line + 1;
}

/**
 * Builds the hover for the resource(s) created on a line, given the primary
 * selection. When one resource is the construct's primary (default) child, its
 * resolved properties are shown and the rest are listed under "Also creates";
 * when several resources tie at the shallowest depth (an L3 with no default
 * child), `selection` is undefined and a resource summary is shown instead.
 * Returns undefined when no resource maps to the line.
 */
export function buildHover(
  nodes: readonly ResourceConstruct[],
  selection: PrimarySelection | undefined,
  links: HoverLinks | undefined,
  range: Range,
): Hover | undefined {
  if (nodes.length === 0) {
    return undefined;
  }
  const value = selection === undefined
    ? renderSummary(nodes, links)
    : renderResource(selection.primary, selection.others, links);
  return { contents: { kind: MarkupKind.Markdown, value }, range };
}

/**
 * The construct's primary resource (the uniquely shallowest, i.e. its default
 * child) plus its other resources. Undefined when several resources tie at the
 * shallowest depth, so no single one is canonical.
 */
export function selectPrimary(nodes: readonly ResourceConstruct[]): PrimarySelection | undefined {
  const byDepth = [...nodes].sort((a, b) => segments(a) - segments(b));
  if (byDepth.length === 1) {
    return { primary: byDepth[0], others: [] };
  }
  if (segments(byDepth[0]) === segments(byDepth[1])) {
    return undefined;
  }
  return { primary: byDepth[0], others: byDepth.slice(1) };
}

function segments(node: ConstructNode): number {
  return node.path.split('/').length;
}

function renderResource(
  primary: ResourceConstruct,
  others: readonly ResourceConstruct[],
  links: HoverLinks | undefined,
): string {
  const lines = [
    `${linked(`**${primary.logicalId}**`, links?.blocks[primary.path])} · \`${primary.type}\``,
    `\`${primary.path}\``,
    '',
    ...propertyLines(primary, links),
  ];
  if (others.length > 0) {
    lines.push('', alsoCreates(others, links));
  }
  return lines.join('\n');
}

function propertyLines(primary: ResourceConstruct, links: HoverLinks | undefined): string[] {
  const properties = primary.cfnProperties ?? {};
  const keys = Object.keys(properties);
  const lines = keys.slice(0, MAX_PROPERTIES).map((key) => {
    const value = `\`${renderValue(properties[key])}\``;
    return `- \`${key}\`: ${linked(value, links?.properties[pascalCase(key)])}`;
  });
  if (keys.length > MAX_PROPERTIES) {
    lines.push(`- +${keys.length - MAX_PROPERTIES} more`);
  }
  return lines;
}

function alsoCreates(others: readonly ResourceConstruct[], links: HoverLinks | undefined): string {
  if (others.length > MAX_LINKED_AUX) {
    return `Also creates ${others.length} resources: ${histogram(others)}`;
  }
  const items = others.map((node) => linked(`\`${node.type}\``, links?.blocks[node.path]));
  return `Also creates: ${items.join(' · ')}`;
}

function renderSummary(nodes: readonly ResourceConstruct[], links: HoverLinks | undefined): string {
  const items = nodes.map((node) => `- ${linked(`\`${node.type}\``, links?.blocks[node.path])} \`${node.path}\``);
  return [`**${nodes.length} resources on this line**`, '', ...items].join('\n');
}

/** Wrap `text` in a markdown link to `target`, or return it unchanged when absent. */
function linked(text: string, target: LinkTarget | undefined): string {
  return target === undefined ? text : `[${text}](${target.uri}#L${target.line})`;
}

/** Compact, single-line rendering of a resolved CloudFormation property value. */
export function renderValue(value: unknown): string {
  if (typeof value === 'string') {
    return `"${truncate(value, MAX_STRING_LENGTH)}"`;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.length} ${value.length === 1 ? 'item' : 'items'}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const intrinsic = renderIntrinsic(record);
    if (intrinsic !== undefined) {
      return intrinsic;
    }
    const keys = Object.keys(record);
    if (keys.length === 0) {
      return '{}';
    }
    return `{ ${keys.slice(0, MAX_OBJECT_KEYS).join(', ')}${keys.length > MAX_OBJECT_KEYS ? ', …' : ''} }`;
  }
  return String(value);
}

/** CFN intrinsics ({Ref}, {Fn::GetAtt}, other Fn::*) rendered compactly, else undefined. */
function renderIntrinsic(record: Record<string, unknown>): string | undefined {
  const keys = Object.keys(record);
  if (keys.length !== 1) {
    return undefined;
  }
  const key = keys[0];
  if (key === 'Ref') {
    return `{Ref ${String(record[key])}}`;
  }
  if (key === 'Fn::GetAtt') {
    const target = record[key];
    return `{Fn::GetAtt ${Array.isArray(target) ? target.join('.') : String(target)}}`;
  }
  if (key.startsWith('Fn::')) {
    return `{${key} …}`;
  }
  return undefined;
}

/** Group auxiliary resources by short CFN type, most common first, e.g. "8× Subnet". */
function histogram(nodes: readonly ResourceConstruct[]): string {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    const short = node.type.split('::').pop() ?? node.type;
    counts.set(short, (counts.get(short) ?? 0) + 1);
  }
  const parts = [...counts].sort((a, b) => b[1] - a[1]).map(([type, count]) => `${count}× ${type}`);
  const shown = parts.slice(0, MAX_HISTOGRAM_TYPES);
  return shown.join(', ') + (parts.length > shown.length ? `, … +${parts.length - shown.length} more` : '');
}

/** First-letter-uppercase: maps an L1 camelCase prop name to its CFN PascalCase name. */
function pascalCase(name: string): string {
  return name.length === 0 ? name : name[0].toUpperCase() + name.slice(1);
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
