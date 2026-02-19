import * as semver from 'semver';
import { languageDisplayName } from '../../util/guess-language';
import type { IoHelper } from '../io/private';
import type { ConstructTreeNode } from '../tree';
import { loadTreeFromDir } from '../tree';
import type { BootstrappedEnvironment, Component, Notice } from './types';

/**
 * Normalizes the given components structure into DNF form
 */
function normalizeComponents(xs: Array<Component | Component[]>): Component[][] {
  return xs.map(x => Array.isArray(x) ? x : [x]);
}

function renderComponent(c: Component): string {
  if (c.name.startsWith('language-')) {
    return `${languageDisplayName(c.name.slice('language-'.length))} apps`;
  }
  return `${c.name}: ${c.version}`;
}

function renderConjunction(xs: Component[]): string {
  return xs.map(renderComponent).join(' AND ');
}

interface ActualComponent {
  /**
   * Name of the component
   */
  readonly name: string;

  /**
   * Version of the component
   */
  readonly version: string;

  /**
   * If matched, under what name should it be added to the set of dynamic values
   *
   * These will be used to substitute placeholders in the message string, where
   * placeholders look like `{resolve:XYZ}`.
   *
   * If there is more than one component with the same dynamic name, they are
   * joined by ','.
   *
   * @default - Don't add to the set of dynamic values
   */
  readonly dynamicName?: string;

  /**
   * If matched, what we should put in the set of dynamic values instead of the version.
   *
   * Only used if `dynamicName` is set; by default we will add the actual version
   * of the component.
   *
   * @default - The version
   */
  readonly dynamicValue?: string;
}

export interface NoticesFilterFilterOptions {
  readonly data: Notice[];
  readonly cliVersion: string;
  readonly outDir: string;
  readonly bootstrappedEnvironments: BootstrappedEnvironment[];

  /**
   * The guessed language of the CDK app.
   *
   * @default - no language component is added
   */
  readonly language?: string;
}

export class NoticesFilter {
  private readonly ioHelper: IoHelper;

  constructor(ioHelper: IoHelper) {
    this.ioHelper = ioHelper;
  }

  public async filter(options: NoticesFilterFilterOptions): Promise<FilteredNotice[]> {
    const components = [
      ...(await this.constructTreeComponents(options.outDir)),
      ...(await this.otherComponents(options)),
    ];

    return this.findForNamedComponents(options.data, components);
  }

  /**
   * From a set of input options, return the notices components we are searching for
   */
  private async otherComponents(options: NoticesFilterFilterOptions): Promise<ActualComponent[]> {
    // Bootstrap environments
    let bootstrappedEnvironments = [];
    for (const env of options.bootstrappedEnvironments) {
      const semverBootstrapVersion = semver.coerce(env.bootstrapStackVersion);
      if (!semverBootstrapVersion) {
        // we don't throw because notices should never crash the cli.
        await this.ioHelper.defaults.warning(`While filtering notices, could not coerce bootstrap version '${env.bootstrapStackVersion}' into semver`);
        continue;
      }

      bootstrappedEnvironments.push({
        name: 'bootstrap',
        version: `${semverBootstrapVersion}`,
        dynamicName: 'ENVIRONMENTS',
        dynamicValue: env.environment.name,
      });
    }

    return [
      // CLI
      {
        name: 'cli',
        version: options.cliVersion,
      },

      // Node version
      {
        name: 'node',
        version: process.version.replace(/^v/, ''), // remove the 'v' prefix.
        dynamicName: 'node',
      },

      // Bootstrap environments
      ...bootstrappedEnvironments,

      // Language
      ...(options.language ? [{
        name: `language-${options.language}`,
        version: '0.0.0',
        dynamicName: 'LANGUAGE',
        dynamicValue: languageDisplayName(options.language),
      }] : []),
    ];
  }

  /**
   * Based on a set of component names, find all notices that match one of the given components
   */
  private findForNamedComponents(data: Notice[], actualComponents: ActualComponent[]): FilteredNotice[] {
    return data.flatMap(notice => {
      const ors = this.resolveAliases(normalizeComponents(notice.components));

      // Find the first set of the disjunctions of which all components match against the actual components.
      // Return the actual components we found so that we can inject their dynamic values. A single filter
      // component can match more than one actual component
      for (const ands of ors) {
        const matched = ands.map(affected => actualComponents.filter(actual =>
          this.componentNameMatches(affected, actual) && semver.satisfies(actual.version, affected.version, { includePrerelease: true })));

        // For every clause in the filter we matched one or more components
        if (matched.every(xs => xs.length > 0)) {
          const ret = new FilteredNotice(notice);
          this.addDynamicValues(matched.flatMap(x => x), ret);
          return [ret];
        }
      }

      return [];
    });
  }

  /**
   * Whether the given "affected component" name applies to the given actual component name.
   *
   * The name matches if the name is exactly the same, or the name in the notice
   * is a prefix of the node name when the query ends in '.'.
   */
  private componentNameMatches(pattern: Component, actual: ActualComponent): boolean {
    return pattern.name.endsWith('.') ? actual.name.startsWith(pattern.name) : pattern.name === actual.name;
  }

  /**
   * Adds dynamic values from the given ActualComponents
   *
   * If there are multiple components with the same dynamic name, they are joined
   * by a comma.
   */
  private addDynamicValues(comps: ActualComponent[], notice: FilteredNotice) {
    const dynamicValues: Record<string, string[]> = {};
    for (const comp of comps) {
      if (comp.dynamicName) {
        dynamicValues[comp.dynamicName] = dynamicValues[comp.dynamicName] ?? [];
        dynamicValues[comp.dynamicName].push(comp.dynamicValue ?? comp.version);
      }
    }
    for (const [key, values] of Object.entries(dynamicValues)) {
      notice.addDynamicValue(key, values.join(','));
    }
  }

  /**
   * Treat 'framework' as an alias for either `aws-cdk-lib.` or `@aws-cdk/core.`.
   *
   * Because it's EITHER `aws-cdk-lib` or `@aws-cdk/core`, we need to add multiple
   * arrays at the top level.
   */
  private resolveAliases(ors: Component[][]): Component[][] {
    return ors.flatMap(ands => {
      const hasFramework = ands.find(c => c.name === 'framework');
      if (!hasFramework) {
        return [ands];
      }

      return [
        ands.map(c => c.name === 'framework' ? { ...c, name: '@aws-cdk/core.' } : c),
        ands.map(c => c.name === 'framework' ? { ...c, name: 'aws-cdk-lib.' } : c),
      ];
    });
  }

  /**
   * Load the construct tree from the given directory and return its components
   */
  private async constructTreeComponents(manifestDir: string): Promise<ActualComponent[]> {
    const tree = await loadTreeFromDir(manifestDir, (msg: string) => this.ioHelper.defaults.trace(msg));
    if (!tree) {
      return [];
    }

    const ret: ActualComponent[] = [];
    recurse(tree);
    return ret;

    function recurse(x: ConstructTreeNode) {
      if (x.constructInfo?.fqn && x.constructInfo?.version) {
        ret.push({
          name: x.constructInfo?.fqn,
          version: x.constructInfo?.version,
        });
      }

      for (const child of Object.values(x.children ?? {})) {
        recurse(child);
      }
    }
  }
}

/**
 * Notice after passing the filter. A filter can augment a notice with
 * dynamic values as it has access to the dynamic matching data.
 */
export class FilteredNotice {
  private readonly dynamicValues: { [key: string]: string } = {};

  public constructor(public readonly notice: Notice) {
  }

  public addDynamicValue(key: string, value: string) {
    this.dynamicValues[`{resolve:${key}}`] = value;
  }

  public format(): string {
    const componentsValue = normalizeComponents(this.notice.components).map(renderConjunction).join(', ');
    return this.resolveDynamicValues([
      `${this.notice.issueNumber}\t${this.notice.title}`,
      this.formatOverview(),
      `\tAffected versions: ${componentsValue}`,
      `\tMore information at: https://github.com/aws/aws-cdk/issues/${this.notice.issueNumber}`,
    ].join('\n\n') + '\n');
  }

  private formatOverview() {
    const wrap = (s: string) => s.replace(/(?![^\n]{1,60}$)([^\n]{1,60})\s/g, '$1\n');

    const heading = 'Overview: ';
    const separator = `\n\t${' '.repeat(heading.length)}`;
    const content = wrap(this.notice.overview)
      .split('\n')
      .join(separator);

    return '\t' + heading + content;
  }

  private resolveDynamicValues(input: string): string {
    const pattern = new RegExp(Object.keys(this.dynamicValues).join('|'), 'g');
    return input.replace(pattern, (matched) => this.dynamicValues[matched] ?? matched);
  }
}
