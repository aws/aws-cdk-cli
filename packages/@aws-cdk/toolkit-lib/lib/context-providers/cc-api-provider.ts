import type { CcApiContextQuery } from '@aws-cdk/cloud-assembly-schema';
import type { ResourceDescription } from '@aws-sdk/client-cloudcontrol';
import { ResourceNotFoundException } from '@aws-sdk/client-cloudcontrol';
import type { ICloudControlClient, SdkProvider } from '../api/aws-auth/private';
import { initContextProviderSdk } from '../api/aws-auth/private';
import type { ContextProviderPlugin } from '../api/plugin';
import { ContextProviderError, NoResultsFoundError } from '../toolkit/toolkit-error';
import { findJsonValue, getResultObj } from '../util';

export class CcApiContextProviderPlugin implements ContextProviderPlugin {
  constructor(private readonly aws: SdkProvider) {
  }

  /**
   * This returns a data object with the value from CloudControl API result.
   *
   * See the documentation in the Cloud Assembly Schema for the semantics of
   * each query parameter.
   */
  public async getValue(args: CcApiContextQuery) {
    // Validate input
    if (args.exactIdentifier && args.propertyMatch) {
      throw new ContextProviderError(`Provider protocol error: specify either exactIdentifier or propertyMatch, but not both (got ${JSON.stringify(args)})`);
    }
    if (args.ignoreErrorOnMissingContext && args.dummyValue === undefined) {
      throw new ContextProviderError(`Provider protocol error: if ignoreErrorOnMissingContext is set, a dummyValue must be supplied (got ${JSON.stringify(args)})`);
    }
    if (args.dummyValue !== undefined && (!Array.isArray(args.dummyValue) || !args.dummyValue.every(isObject))) {
      throw new ContextProviderError(`Provider protocol error: dummyValue must be an array of objects (got ${JSON.stringify(args.dummyValue)})`);
    }

    // Do the lookup
    const cloudControl = (await initContextProviderSdk(this.aws, args)).cloudControl();

    try {
      let resources: FoundResource[];
      if (args.exactIdentifier) {
        // use getResource to get the exact identifier
        resources = await this.getResource(cloudControl, args.typeName, args.exactIdentifier);
      } else if (args.propertyMatch) {
        // use listResource
        resources = await this.listResources(cloudControl, args.typeName, args.propertyMatch, args.expectedMatchCount);
      } else {
        throw new ContextProviderError(`Provider protocol error: neither exactIdentifier nor propertyMatch is specified in ${JSON.stringify(args)}.`);
      }

      return resources.map((r) => getResultObj(r.properties, r.identifier, args.propertiesToReturn));
    } catch (err) {
      if (ContextProviderError.isNoResultsFoundError(err) && args.ignoreErrorOnMissingContext) {
        // We've already type-checked dummyValue.
        return args.dummyValue;
      }
      throw err;
    }
  }

  /**
   * Calls getResource from CC API to get the resource.
   * See https://docs.aws.amazon.com/cli/latest/reference/cloudcontrol/get-resource.html
   *
   * Will always return exactly one resource, or fail.
   */
  private async getResource(
    cc: ICloudControlClient,
    typeName: string,
    exactIdentifier: string,
  ): Promise<FoundResource[]> {
    try {
      const result = await cc.getResource({
        TypeName: typeName,
        Identifier: exactIdentifier,
      });
      if (!result.ResourceDescription) {
        throw new ContextProviderError('Unexpected CloudControl API behavior: returned empty response');
      }

      return [foundResourceFromCcApi(result.ResourceDescription)];
    } catch (err: any) {
      if (err instanceof ResourceNotFoundException || (err as any).name === 'ResourceNotFoundException') {
        throw new NoResultsFoundError(`No resource of type ${typeName} with identifier: ${exactIdentifier}`);
      }
      if (!ContextProviderError.isContextProviderError(err)) {
        throw ContextProviderError.withCause(`Encountered CC API error while getting ${typeName} resource ${exactIdentifier}`, err);
      }
      throw err;
    }
  }

  /**
   * Calls listResources from CC API to get the resources and apply args.propertyMatch to find the resources.
   * See https://docs.aws.amazon.com/cli/latest/reference/cloudcontrol/list-resources.html
   *
   * Will return 0 or more resources.
   *
   * Does not currently paginate through more than one result page.
   */
  private async listResources(
    cc: ICloudControlClient,
    typeName: string,
    propertyMatch: Record<string, unknown>,
    expectedMatchCount?: CcApiContextQuery['expectedMatchCount'],
  ): Promise<FoundResource[]> {
    try {
      const found: FoundResource[] = [];
      let nextToken: string | undefined = undefined;

      do {
        const result = await cc.listResources({
          TypeName: typeName,
          MaxResults: 100,
          ...nextToken ? { NextToken: nextToken } : {},
        });

        found.push(
          ...(result.ResourceDescriptions ?? [])
            .map(foundResourceFromCcApi)
            .filter((r) => {
              return Object.entries(propertyMatch).every(([propPath, expected]) => {
                const actual = findJsonValue(r.properties, propPath);
                return propertyMatchesFilter(actual, expected);
              });
            }),
        );

        nextToken = result.NextToken;

        // This allows us to error out early, before we have consumed all pages.
        if ((expectedMatchCount === 'at-most-one' || expectedMatchCount === 'exactly-one') && found.length > 1) {
          const atLeast = nextToken ? 'at least ' : '';
          throw new ContextProviderError(`Found ${atLeast}${found.length} resources matching ${JSON.stringify(propertyMatch)}; expected ${expectedMatchCountText(expectedMatchCount)}. Please narrow the search criteria`);
        }
      } while (nextToken);

      if ((expectedMatchCount === 'at-least-one' || expectedMatchCount === 'exactly-one') && found.length === 0) {
        throw new NoResultsFoundError(`Could not find any resources matching ${JSON.stringify(propertyMatch)}; expected ${expectedMatchCountText(expectedMatchCount)}.`);
      }

      return found;
    } catch (err: any) {
      if (!ContextProviderError.isContextProviderError(err)) {
        throw ContextProviderError.withCause(`Encountered CC API error while listing ${typeName} resources matching ${JSON.stringify(propertyMatch)}`, err);
      }
      throw err;
    }
  }
}

/**
 * Convert a CC API response object into a nicer object (parse the JSON)
 */
function foundResourceFromCcApi(desc: ResourceDescription): FoundResource {
  return {
    identifier: desc.Identifier ?? '*MISSING*',
    properties: JSON.parse(desc.Properties ?? '{}'),
  };
}

/**
 * Whether the given property value matches the given filter
 *
 * For now we just check for strict equality, but we can implement pattern matching and fuzzy matching here later
 */
function propertyMatchesFilter(actual: unknown, expected: unknown) {
  return expected === actual;
}

function isObject(x: unknown): x is { [key: string]: unknown } {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function expectedMatchCountText(expectation: NonNullable<CcApiContextQuery['expectedMatchCount']>): string {
  switch (expectation) {
    case 'at-least-one':
      return 'at least one';
    case 'at-most-one':
      return 'at most one';
    case 'exactly-one':
      return 'exactly one';
    case 'any':
      return 'any number';
    default:
      return expectation;
  }
}

/**
 * A parsed version of the return value from CCAPI
 */
interface FoundResource {
  readonly identifier: string;
  readonly properties: Record<string, unknown>;
}
